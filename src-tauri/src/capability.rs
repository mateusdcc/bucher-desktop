use serde::Serialize;

/// Runtime health report for a declared extension dependency.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub name: String,
    pub kind: String,
    pub available: bool,
    pub detail: String,
}

/// IPC commands registered by this build (kept in sync with main.rs).
const KNOWN_COMMANDS: &[&str] = &[
    "load_library",
    "import_books",
    "save_markdown",
    "discard_solution",
    "chatgpt_login",
    "chatgpt_status",
    "chatgpt_logout",
    "chatgpt_models",
    "chatgpt_usage",
    "ai_list_models",
    "ai_ollama_status",
    "ai_explain",
    "ai_generate_solution",
    "ai_review_solution",
    "ai_propose_patch",
    "ai_prepare_import",
    "ai_import_book",
    "check_capability",
    "native_system_info",
    "workbench_init",
    "workbench_reset",
    "workbench_write",
    "workbench_read",
    "workbench_list",
    "workbench_run",
    "workbench_pipeline",
];

/// Tauri plugins initialized by this build.
const KNOWN_PLUGINS: &[&str] = &["opener", "dialog"];

/// Rust crates compiled into this build that extensions may declare.
const KNOWN_CRATES: &[&str] = &["tokio", "tempfile", "serde", "serde_json", "reqwest", "uuid", "sysinfo"];

/// Health-check a declared native dependency. Extensions call this through the
/// frontend bridge at registration/mount time and apply their declared
/// fallback behavior when a capability is missing.
#[tauri::command]
pub fn check_capability(name: String) -> CapabilityStatus {
    let trimmed = name.trim();
    if KNOWN_COMMANDS.contains(&trimmed) {
        return CapabilityStatus {
            name: trimmed.to_string(),
            kind: "ipc-command".into(),
            available: true,
            detail: "Registered in this build's invoke handler.".into(),
        };
    }
    if KNOWN_PLUGINS.contains(&trimmed) {
        return CapabilityStatus {
            name: trimmed.to_string(),
            kind: "tauri-plugin".into(),
            available: true,
            detail: "Plugin initialized by this build.".into(),
        };
    }
    if KNOWN_CRATES.contains(&trimmed) {
        return CapabilityStatus {
            name: trimmed.to_string(),
            kind: "rust-crate".into(),
            available: true,
            detail: "Crate compiled into this build.".into(),
        };
    }
    CapabilityStatus {
        name: trimmed.to_string(),
        kind: "unknown".into(),
        available: false,
        detail: "No command, plugin, or crate with this name is registered in this build.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_registered_and_missing_capabilities() {
        let command = check_capability("load_library".into());
        assert!(command.available);
        assert_eq!(command.kind, "ipc-command");
        let plugin = check_capability("opener".into());
        assert!(plugin.available);
        assert_eq!(plugin.kind, "tauri-plugin");
        let crate_dep = check_capability("tokio".into());
        assert!(crate_dep.available);
        assert_eq!(crate_dep.kind, "rust-crate");
        let missing = check_capability("run_arbitrary_shell".into());
        assert!(!missing.available);
        assert_eq!(missing.kind, "unknown");
        let blank = check_capability("   ".into());
        assert!(!blank.available);
    }
}
