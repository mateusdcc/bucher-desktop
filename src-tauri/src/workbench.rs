//! Sandboxed native workspace for ext-tauri-native-workbench.
//!
//! Every operation is confined to `$APPDATA/workspaces/<id>/`:
//! - workspace ids are lowercase slugs; relative paths reject `..`, absolute
//!   paths, dot-components (`.git` tampering), and symlinks (library.rs pattern);
//! - only allowlisted programs run, with argv passed directly (no shell, so no
//!   metacharacter injection), a sanitized environment (env_clear + explicit
//!   vars, global git config disabled), and a hard timeout with kill-on-drop;
//! - git is restricted to safe subcommands; repo-redirecting/executing flags
//!   (`--git-dir`, `-c`, `--upload-pack`, …) are blocked;
//! - pipelines chain allowlisted programs stdout→stdin in-process.
//!
//! This is what lets a book embed real git/files/pipeline exercises that a
//! plain web app cannot run, without handing the reader arbitrary execution.

use serde::Serialize;
use std::{
    io,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

const MAX_FILE_BYTES: usize = 64 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const RUN_TIMEOUT: Duration = Duration::from_secs(10);

const ALLOWED_PROGRAMS: &[&str] = &[
    "git", "ls", "cat", "wc", "grep", "sort", "uniq", "head", "tail", "echo",
];
const GIT_SUBCOMMANDS: &[&str] = &[
    "init", "add", "commit", "branch", "checkout", "switch", "merge", "rebase",
    "log", "status", "diff", "tag", "rev-parse",
];
const GIT_BLOCKED_FLAGS: &[&str] = &[
    "--git-dir", "--work-tree", "--exec-path", "-C", "-c", "--config-env",
    "--upload-pack", "--receive-pack", "--output", "-o", "--pager", "--paginate",
    "--open-files-in-pager",
];

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub kernel: String,
    pub hostname: String,
    pub cpu_brand: String,
    pub cpu_count: usize,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

fn validate_id(id: &str) -> io::Result<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(invalid("Workspace ids are lowercase slugs (a-z, 0-9, -)."))
    }
}

/// Resolve a workspace-relative path, refusing traversal, absolute paths,
/// dot-components (protects `.git`), and symlinks at every existing prefix.
fn safe_join(root: &Path, rel: &str) -> io::Result<PathBuf> {
    if rel.is_empty() || rel.len() > 256 {
        return Err(invalid("Provide a workspace-relative file path."));
    }
    let path = Path::new(rel);
    if !path.components().all(|part| matches!(part, Component::Normal(name) if !name.to_string_lossy().starts_with('.'))) {
        return Err(invalid("Paths must stay inside the workspace: no absolute paths, '..', or dot-files."));
    }
    let mut absolute = root.to_path_buf();
    for part in path {
        absolute.push(part);
        match std::fs::symlink_metadata(&absolute) {
            Ok(meta) if meta.is_symlink() => {
                return Err(invalid("Symbolic links are not allowed in workspaces."));
            }
            Ok(_) => {}
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
    }
    Ok(absolute)
}

fn validate_args(program: &str, args: &[String]) -> io::Result<()> {
    if !ALLOWED_PROGRAMS.contains(&program) {
        return Err(invalid(format!(
            "Program \"{program}\" is not allowed. Allowed: {}.",
            ALLOWED_PROGRAMS.join(", ")
        )));
    }
    for arg in args {
        if arg.starts_with('/') || arg.split('/').any(|part| part == "..") {
            return Err(invalid("Arguments must use workspace-relative paths only."));
        }
    }
    if program == "git" {
        let Some(sub) = args.first() else {
            return Err(invalid("git needs a subcommand."));
        };
        if !GIT_SUBCOMMANDS.contains(&sub.as_str()) {
            return Err(invalid(format!(
                "git {sub} is not allowed. Allowed: {}.",
                GIT_SUBCOMMANDS.join(", ")
            )));
        }
        for arg in &args[1..] {
            let flag = arg.split('=').next().unwrap_or(arg);
            if GIT_BLOCKED_FLAGS.contains(&flag) {
                return Err(invalid(format!("git flag \"{flag}\" is blocked in the sandbox.")));
            }
        }
    }
    if program == "grep" && args.iter().any(|a| a == "-f" || a == "--file" || a.starts_with("--file=")) {
        return Err(invalid("grep pattern files (-f) are not allowed."));
    }
    Ok(())
}

/// Sanitized environment: no inherited variables (blocks GIT_DIR, LD_PRELOAD,
/// …), global/system git config disabled, identity provided for commits.
fn sandbox_env(workspace: &Path) -> Vec<(String, String)> {
    vec![
        ("PATH".into(), std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/local/bin".into())),
        ("HOME".into(), workspace.to_string_lossy().into_owned()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_PAGER".into(), "cat".into()),
        ("PAGER".into(), "cat".into()),
        ("TERM".into(), "dumb".into()),
        ("LC_ALL".into(), "C".into()),
        ("GIT_AUTHOR_NAME".into(), "Bücher Learner".into()),
        ("GIT_AUTHOR_EMAIL".into(), "learner@bucher.local".into()),
        ("GIT_COMMITTER_NAME".into(), "Bücher Learner".into()),
        ("GIT_COMMITTER_EMAIL".into(), "learner@bucher.local".into()),
    ]
}

fn truncate(text: String) -> String {
    if text.len() <= MAX_OUTPUT_BYTES {
        return text;
    }
    let mut cut = MAX_OUTPUT_BYTES;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n…[output truncated]", &text[..cut])
}

async fn run_program(
    workspace: &Path,
    program: &str,
    args: &[String],
    stdin_data: Option<Vec<u8>>,
    timeout: Duration,
) -> io::Result<RunOutput> {
    validate_args(program, args)?;
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .current_dir(workspace)
        .env_clear()
        .envs(sandbox_env(workspace))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|err| invalid(format!("Could not start {program}: {err}")))?;
    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            // EPIPE just means the program stopped reading early.
            let _ = stdin.write_all(&data).await;
            drop(stdin);
        }
    }
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| invalid(format!("{program} exceeded {}s and was terminated.", timeout.as_secs())))?
        .map_err(|err| invalid(format!("{program} failed: {err}")))?;
    Ok(RunOutput {
        stdout: truncate(String::from_utf8_lossy(&output.stdout).into_owned()),
        stderr: truncate(String::from_utf8_lossy(&output.stderr).into_owned()),
        code: output.status.code().unwrap_or(-1),
    })
}

async fn run_pipeline(
    workspace: &Path,
    stages: &[Vec<String>],
    timeout: Duration,
) -> io::Result<RunOutput> {
    if stages.is_empty() || stages.len() > 8 {
        return Err(invalid("A pipeline needs 1–8 stages."));
    }
    let mut carry: Option<Vec<u8>> = None;
    let mut last = RunOutput::default();
    let mut stderr_all = String::new();
    for stage in stages {
        let Some((program, args)) = stage.split_first() else {
            return Err(invalid("Empty pipeline stage."));
        };
        // Shell pipelines continue past non-zero exits (no pipefail); grep
        // finding nothing is a legitimate result, so keep chaining.
        last = run_program(workspace, program, args, carry, timeout).await?;
        if !last.stderr.is_empty() {
            if !stderr_all.is_empty() {
                stderr_all.push('\n');
            }
            stderr_all.push_str(&last.stderr);
        }
        carry = Some(last.stdout.clone().into_bytes());
    }
    last.stderr = stderr_all;
    Ok(last)
}

fn write_output_file(workspace: &Path, rel: &str, content: &str) -> io::Result<()> {
    if content.len() > MAX_FILE_BYTES {
        return Err(invalid("Output is larger than the 64 KiB workspace file limit."));
    }
    let path = safe_join(workspace, rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)
}

fn workspace_root(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_id(id).map_err(|err| err.to_string())?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("workspaces")
        .join(id);
    Ok(root)
}

/// Real host facts — the "this is a native desktop app" demonstration.
#[tauri::command]
pub async fn native_system_info() -> Result<SystemInfo, String> {
    let mut sys = sysinfo::System::new_all().map_err(|err| err.to_string())?;
    sys.refresh_memory();
    sys.refresh_cpu_all();
    Ok(SystemInfo {
        os: sysinfo::System::name().unwrap_or_else(|_| "unknown".into()),
        os_version: sysinfo::System::os_version().unwrap_or_else(|_| "unknown".into()),
        kernel: sysinfo::System::kernel_version().unwrap_or_else(|_| "unknown".into()),
        hostname: sysinfo::System::host_name().unwrap_or_else(|_| "unknown".into()),
        cpu_brand: sys.cpus().first().map(|cpu| cpu.brand().to_string()).unwrap_or_else(|| "unknown".into()),
        cpu_count: sys.cpus().len(),
        total_memory_mb: sys.total_memory() / (1024 * 1024),
        used_memory_mb: sys.used_memory() / (1024 * 1024),
    })
}

#[tauri::command]
pub async fn workbench_init(app: AppHandle, workspace_id: String) -> Result<String, String> {
    let root = workspace_root(&app, &workspace_id)?;
    std::fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn workbench_reset(app: AppHandle, workspace_id: String) -> Result<(), String> {
    let root = workspace_root(&app, &workspace_id)?;
    if root.exists() {
        std::fs::remove_dir_all(&root).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn workbench_write(
    app: AppHandle,
    workspace_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let root = workspace_root(&app, &workspace_id)?;
    if content.len() > MAX_FILE_BYTES {
        return Err("File content exceeds the 64 KiB workspace limit.".into());
    }
    let target = safe_join(&root, &path).map_err(|err| err.to_string())?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(target, content).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn workbench_read(app: AppHandle, workspace_id: String, path: String) -> Result<String, String> {
    let root = workspace_root(&app, &workspace_id)?;
    let target = safe_join(&root, &path).map_err(|err| err.to_string())?;
    let meta = std::fs::metadata(&target).map_err(|err| err.to_string())?;
    if meta.len() > MAX_FILE_BYTES as u64 {
        return Err("File exceeds the 64 KiB workspace limit.".into());
    }
    std::fs::read_to_string(target).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn workbench_list(app: AppHandle, workspace_id: String) -> Result<Vec<FileEntry>, String> {
    let root = workspace_root(&app, &workspace_id)?;
    let mut files = Vec::new();
    fn visit(root: &Path, folder: &Path, files: &mut Vec<FileEntry>) -> io::Result<()> {
        for entry in std::fs::read_dir(folder)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_dir() {
                visit(root, &entry.path(), files)?;
            } else if kind.is_file() {
                let full = entry.path();
                let rel = full.strip_prefix(root).unwrap_or(&full);
                files.push(FileEntry {
                    path: rel.to_string_lossy().into_owned(),
                    size: entry.metadata()?.len(),
                });
            }
        }
        Ok(())
    }
    if root.exists() {
        visit(&root, &root, &mut files).map_err(|err| err.to_string())?;
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[tauri::command]
pub async fn workbench_run(
    app: AppHandle,
    workspace_id: String,
    program: String,
    args: Vec<String>,
    output_file: Option<String>,
) -> Result<RunOutput, String> {
    let root = workspace_root(&app, &workspace_id)?;
    std::fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    let output = run_program(&root, &program, &args, None, RUN_TIMEOUT)
        .await
        .map_err(|err| err.to_string())?;
    if let Some(rel) = output_file {
        write_output_file(&root, &rel, &output.stdout).map_err(|err| err.to_string())?;
    }
    Ok(output)
}

#[tauri::command]
pub async fn workbench_pipeline(
    app: AppHandle,
    workspace_id: String,
    stages: Vec<Vec<String>>,
    output_file: Option<String>,
) -> Result<RunOutput, String> {
    let root = workspace_root(&app, &workspace_id)?;
    std::fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    let output = run_pipeline(&root, &stages, RUN_TIMEOUT)
        .await
        .map_err(|err| err.to_string())?;
    if let Some(rel) = output_file {
        write_output_file(&root, &rel, &output.stdout).map_err(|err| err.to_string())?;
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn path_guards_reject_escape_and_dotfiles() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(safe_join(root, "notes/a.txt").is_ok());
        for bad in ["../escape", "/etc/passwd", "a/../../b", ".git/config", "a/.hidden", ""] {
            assert!(safe_join(root, bad).is_err(), "should reject {bad}");
        }
        std::fs::create_dir_all(root.join("sub")).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc", root.join("sub/link")).unwrap();
            assert!(safe_join(root, "sub/link/passwd").is_err());
        }
    }

    #[test]
    fn program_and_git_allowlists() {
        assert!(validate_args("echo", &args(&["hi"])).is_ok());
        assert!(validate_args("rm", &args(&["-rf", "."])).is_err());
        assert!(validate_args("git", &args(&["status"])).is_ok());
        assert!(validate_args("git", &args(&["shell"])).is_err());
        assert!(validate_args("git", &args(&["log", "--git-dir=/tmp"])).is_err());
        assert!(validate_args("git", &args(&["-c", "core.pager=sh"])).is_err());
        assert!(validate_args("git", &args(&["log", "--upload-pack=x"])).is_err());
        assert!(validate_args("cat", &args(&["/etc/passwd"])).is_err());
        assert!(validate_args("cat", &args(&["../../etc/passwd"])).is_err());
        assert!(validate_args("grep", &args(&["-f", "patterns.txt", "x"])).is_err());
    }

    #[tokio::test]
    async fn echo_and_pipeline_run_for_real() {
        let dir = tempfile::tempdir().unwrap();
        let out = run_program(dir.path(), "echo", &args(&["hello", "native"]), None, RUN_TIMEOUT)
            .await
            .unwrap();
        assert_eq!(out.stdout, "hello native\n");
        assert_eq!(out.code, 0);

        std::fs::write(dir.path().join("data.txt"), "alpha\nbeta\ngamma\n").unwrap();
        let piped = run_pipeline(
            dir.path(),
            &[
                args(&["cat", "data.txt"]),
                args(&["grep", "a"]),
                args(&["wc", "-l"]),
            ],
            RUN_TIMEOUT,
        )
        .await
        .unwrap();
        // alpha, beta, gamma all contain 'a' → 3 lines.
        assert_eq!(piped.stdout.trim(), "3");
    }

    #[tokio::test]
    async fn timeout_kills_hanging_program() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("f.txt"), "x\n").unwrap();
        let result = run_program(
            dir.path(),
            "tail",
            &args(&["-f", "f.txt"]),
            None,
            Duration::from_millis(400),
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("terminated"));
    }

    #[tokio::test]
    async fn real_git_branching_flow() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let git = |a: &[&str]| {
            let owned: Vec<String> = a.iter().map(|s| s.to_string()).collect();
            async move { run_program(root, "git", &owned, None, RUN_TIMEOUT).await.unwrap() }
        };
        let init = git(&["init", "-b", "main"]).await;
        assert_eq!(init.code, 0, "git init failed: {}", init.stderr);
        std::fs::write(root.join("README.md"), "# demo\n").unwrap();
        assert_eq!(git(&["add", "README.md"]).await.code, 0);
        let commit = git(&["commit", "-m", "initial commit"]).await;
        assert_eq!(commit.code, 0, "commit failed: {}", commit.stderr);
        assert_eq!(git(&["checkout", "-b", "feature"]).await.code, 0);
        let branch = git(&["branch", "--list"]).await;
        assert!(branch.stdout.contains("feature"));
        let log = git(&["log", "--oneline"]).await;
        assert!(log.stdout.contains("initial commit"));
        let head = git(&["rev-parse", "--abbrev-ref", "HEAD"]).await;
        assert_eq!(head.stdout.trim(), "feature");
        // Blocked escapes still fail inside a real repo.
        assert!(run_program(root, "git", &args(&["log", "--git-dir=/tmp"]), None, RUN_TIMEOUT).await.is_err());
    }

    #[test]
    fn output_files_stay_inside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        write_output_file(dir.path(), "out/result.txt", "ok\n").unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("out/result.txt")).unwrap(), "ok\n");
        assert!(write_output_file(dir.path(), "../escape.txt", "x").is_err());
        assert!(write_output_file(dir.path(), "big.txt", &"x".repeat(MAX_FILE_BYTES + 1)).is_err());
    }

    #[test]
    fn workspace_ids_are_slugs() {
        assert!(validate_id("git-demo-1").is_ok());
        for bad in ["", "../x", "Upper", "-lead", "a b", &"x".repeat(65)] {
            assert!(validate_id(bad).is_err(), "should reject {bad}");
        }
    }
}
