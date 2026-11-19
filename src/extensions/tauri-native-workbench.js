/**
 * ext-tauri-native-workbench — native desktop system / git / pipeline sandbox.
 *
 * The desktop-only superpower: books embed real native exercises executed by
 * sandboxed Rust commands (src-tauri/src/workbench.rs) inside an isolated
 * per-block workspace under $APPDATA/workspaces/. Readers run allowlisted
 * programs (git, cat, grep, wc, …) in a terminal, chain pipelines, redirect
 * output to workspace files, and pass automated native-state verification.
 * A system-info scene shows real host facts via sysinfo.
 *
 * Outside Tauri the declared `disable-on-web` capabilities gate the block
 * with a diagnostic card instead of crashing (host capability audit).
 *
 * @module extensions/tauri-native-workbench
 */
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { el, iconButton } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 * @typedef {{ stdout: string, stderr: string, code: number }} RunOutput
 * @typedef {{ path: string, size: number }} FileEntry
 */

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/, 'Use a lowercase slug (a-z, 0-9, -).');
const pathStr = z.string().min(1).max(200).refine(
  value => !value.startsWith('/') && !value.split('/').some(part => part === '..' || part.startsWith('.')),
  'Paths are workspace-relative, without dot-files or "..".',
);

const checkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('branch-exists'), name: slug }),
  z.object({ type: z.literal('current-branch'), name: slug }),
  z.object({ type: z.literal('log-contains'), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal('file-exists'), path: pathStr }),
  z.object({ type: z.literal('file-equals'), path: pathStr, content: z.string().max(8000) }),
  z.object({
    type: z.literal('pipeline-output'),
    stages: z.array(z.array(z.string().min(1).max(200)).min(1).max(10)).min(1).max(8),
    expected: z.string().max(2000),
  }),
]);

const schema = z.object({
  ...blockMeta,
  kind: z.enum(['git', 'pipeline', 'files', 'system']),
  mode: z.enum(['explore', 'challenge']).default('challenge'),
  description: z.string().max(4000).optional(),
  setup: z.object({
    files: z.array(z.object({ path: pathStr, content: z.string().max(8000) })).max(20).optional(),
    gitInit: z.boolean().optional().describe('git kind only: init a repo on branch main and commit the setup files.'),
  }).optional(),
  checks: z.array(checkSchema).max(8).optional(),
}).superRefine((data, ctx) => {
  if (data.kind === 'system') {
    if (data.mode !== 'explore') {
      ctx.addIssue({ code: 'custom', path: ['mode'], message: 'system kind is explore-only.' });
    }
    return;
  }
  if (data.mode === 'challenge' && !(data.checks && data.checks.length)) {
    ctx.addIssue({ code: 'custom', path: ['checks'], message: 'Challenge mode requires at least one verification check.' });
  }
  if (data.setup?.gitInit && data.kind !== 'git') {
    ctx.addIssue({ code: 'custom', path: ['setup', 'gitInit'], message: 'gitInit is only valid for git kind.' });
  }
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

const ALLOWED = ['git', 'ls', 'cat', 'wc', 'grep', 'sort', 'uniq', 'head', 'tail', 'echo'];

/** @type {BucherExtension} */
export const nativeWorkbenchExtension = {
  id: 'ext-tauri-native-workbench',
  name: 'Native Workbench',
  version: '1.0.0',
  description: 'Desktop-only sandboxed native exercises: real git branching, shell-style pipelines, and workspace files run by Rust commands — with automated native-state verification.',
  category: 'exercise',
  icon: 'hard-drive',
  skill: {
    instructions: `Use ext-tauri-native-workbench ONLY in the desktop app for exercises that need real native powers: git workflows (branch/commit/merge/rebase), file manipulation, and text pipelines. It cannot run on the web (the block shows a capability card there). Rules:
- kind git: setup { gitInit: true, files: [{path, content}] } creates a repo on branch main with the files committed. The reader types commands in a terminal: git checkout -b feature, git add <file>, git commit -m "message", git merge, git rebase, git log, git status, git diff. File creation uses echo: echo hello > hello.txt.
- kind pipeline: setup files seed data; the reader chains allowlisted programs with | and redirects with > (e.g. cat log.txt | grep ERROR | wc -l > count.txt). Programs: git ls cat wc grep sort uniq head tail echo. No other programs, no shell metacharacters beyond | and >.
- kind files: plain workspace file exercises (read/list/verify contents).
- kind system: explore-only scene showing real host facts (OS, CPU, memory) — a "native desktop" demonstration, no checks.
- checks (challenge mode): automated native verification — branch-exists {name}, current-branch {name}, log-contains {text}, file-exists {path}, file-equals {path, content}, pipeline-output {stages: [["cat","log.txt"],["grep","ERROR"],["wc","l"]], expected}. Design 2–5 checks that fully capture the task. file-equals content must match exactly (echo adds a trailing newline).
- description: Markdown task with the exact goal. Set a stable lowercase-slug id and title; place in chapters (embed in a > [!exercise] callout).`,
    syntaxSpec: `Fence info string: ext-tauri-native-workbench. YAML fields:
- kind: git | pipeline | files | system. mode: explore | challenge (default challenge; system is explore).
- description: Markdown. setup: { files: [{path, content}], gitInit?: bool (git kind) }.
- checks: [{ type: branch-exists|current-branch, name } | { type: log-contains, text } | { type: file-exists|file-equals, path, content? } | { type: pipeline-output, stages: [[program, args…]], expected }].
- Terminal grammar: program args… [| program args…]* [> output-file]. Quotes group arguments ("commit message").`,
    fewShotExamples: [
      {
        title: 'Git: create a feature branch and commit',
        yaml: `id: native-git-feature
title: "Git: feature branch workflow"
kind: git
description: |
  Create a branch named \`feature\`, add a file \`hello.txt\` containing
  exactly \`hello\` (one line), and commit it with a message containing
  "add greeting". Use the terminal below; verify when done.
setup:
  gitInit: true
  files:
    - { path: README.md, content: "# Demo project\\n" }
checks:
  - { type: branch-exists, name: feature }
  - { type: current-branch, name: feature }
  - { type: file-equals, path: hello.txt, content: "hello\\n" }
  - { type: log-contains, text: add greeting }`,
      },
      {
        title: 'Pipeline: count error lines',
        yaml: `id: native-pipeline-errors
title: "Pipeline: count the errors"
kind: pipeline
description: |
  \`server.log\` contains mixed log lines. Build a pipeline that counts the
  lines containing \`ERROR\` and save the number to \`count.txt\`.
setup:
  files:
    - path: server.log
      content: |
        INFO started
        ERROR disk full
        INFO retrying
        ERROR timeout
        INFO done
checks:
  - type: pipeline-output
    stages:
      - [cat, server.log]
      - [grep, ERROR]
      - [wc, "-l"]
    expected: "2"
  - { type: file-equals, path: count.txt, content: "2\\n" }`,
      },
    ],
  },
  dependencies: {
    webPackages: [
      { name: '@tauri-apps/api', version: '^2.12.5', purpose: 'Typed IPC bridge to the sandboxed Rust workbench commands.', lazyLoad: false },
    ],
    tauriDependencies: [
      { type: 'ipc-command', name: 'workbench_init', fallbackBehavior: 'disable-on-web', purpose: 'Create the isolated per-block workspace under app data.' },
      { type: 'ipc-command', name: 'workbench_run', fallbackBehavior: 'disable-on-web', purpose: 'Run allowlisted programs in the workspace with timeout and sanitized env.' },
      { type: 'ipc-command', name: 'workbench_pipeline', fallbackBehavior: 'disable-on-web', purpose: 'Chain allowlisted programs stdout→stdin without a shell.' },
      { type: 'ipc-command', name: 'workbench_write', fallbackBehavior: 'degrade-gracefully', purpose: 'Seed workspace files (setup).' },
      { type: 'ipc-command', name: 'workbench_read', fallbackBehavior: 'degrade-gracefully', purpose: 'Read workspace files for verification and inspection.' },
      { type: 'ipc-command', name: 'workbench_list', fallbackBehavior: 'degrade-gracefully', purpose: 'List workspace files.' },
      { type: 'ipc-command', name: 'native_system_info', fallbackBehavior: 'degrade-gracefully', purpose: 'Real host facts (sysinfo) for the system scene.' },
      { type: 'rust-crate', name: 'sysinfo', fallbackBehavior: 'degrade-gracefully', purpose: 'Cross-platform system introspection compiled into the app.' },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountWorkbench(host, props);
  },
};

/**
 * Tokenize a command stage, honoring single/double quotes.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(text))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

/**
 * Parse a terminal line into pipeline stages plus an optional output file.
 * Exported for unit tests.
 * @param {string} line
 * @returns {{ stages: string[][], outputFile: string | null } | { error: string }}
 */
export function parseCommand(line) {
  const parts = line.split('>');
  if (parts.length > 2) return { error: 'Only one ">" redirection is supported.' };
  const outputFile = parts.length === 2 ? parts[1].trim() : null;
  if (parts.length === 2 && !outputFile) return { error: 'Provide a file name after ">".' };
  const stages = parts[0].split('|').map(stage => tokenize(stage.trim())).filter(stage => stage.length);
  if (!stages.length) return { error: 'Type a command first.' };
  for (const stage of stages) {
    if (!ALLOWED.includes(stage[0])) {
      return { error: `"${stage[0]}" is not allowed. Programs: ${ALLOWED.join(', ')}.` };
    }
  }
  return { stages, outputFile };
}

/**
 * @param {unknown} id
 * @returns {string}
 */
function workspaceIdFor(id) {
  const cleaned = String(id ?? 'block').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'block';
  return `wb-${cleaned}`;
}

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountWorkbench(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  const workspaceId = workspaceIdFor(saved.workspaceId ?? data.id);
  let destroyed = false;
  /** @type {{ cmd: string, stdout: string, stderr: string, code: number }[]} */
  const history = Array.isArray(saved.history) ? /** @type {any[]} */ (saved.history) : [];
  /** @type {{ label: string, pass: boolean, detail: string }[] | null} */
  let checkResults = Array.isArray(saved.checkResults) ? /** @type {any[]} */ (saved.checkResults) : null;
  let status = typeof saved.status === 'string' ? saved.status : 'unsolved';
  const mountedStatus = status;
  let firedComplete = false;

  const root = el('div', 'workbench-extension');
  host.append(root);
  if (data.description) {
    root.append(el('div', 'workbench-description markdown', props.renderMarkdown(data.description)));
  }

  function persist() {
    props.onSaveState({ workspaceId, history: history.slice(-50), checkResults, status });
    if (status === 'passed' && mountedStatus !== 'passed' && !firedComplete) {
      firedComplete = true;
      props.onComplete();
    }
  }

  // ----- System-info scene -----
  if (data.kind === 'system') {
    const cards = el('div', 'workbench-sysinfo');
    root.append(cards);
    (async () => {
      try {
        const info = /** @type {Record<string, string | number>} */ (await invoke('native_system_info'));
        if (destroyed) return;
        const rows = [
          ['Operating system', `${info.os} ${info.osVersion}`],
          ['Kernel', info.kernel],
          ['Hostname', info.hostname],
          ['CPU', `${info.cpuBrand} (${info.cpuCount} cores)`],
          ['Memory', `${info.usedMemoryMb} MB used / ${info.totalMemoryMb} MB total`],
        ];
        for (const [label, value] of rows) {
          cards.append(el('div', 'workbench-syscard',
            el('span', 'workbench-syslabel muted', label),
            el('strong', 'workbench-sysvalue', String(value))));
        }
      } catch (error) {
        if (!destroyed) props.onError(error);
      }
    })();
    return { destroy() { destroyed = true; } };
  }

  // ----- Terminal + files + checks -----
  const log = el('div', 'workbench-log');
  const input = /** @type {HTMLInputElement} */ (el('input', 'workbench-input'));
  input.type = 'text';
  input.placeholder = data.kind === 'git'
    ? 'git checkout -b feature   ·   echo hello > hello.txt   ·   git commit -m "message"'
    : 'cat server.log | grep ERROR | wc -l > count.txt';
  input.setAttribute('aria-label', 'Workbench command');
  input.spellcheck = false;
  const runButton = el('button', 'accent-button', 'Run');
  runButton.type = 'button';
  const terminal = el('div', 'workbench-terminal',
    el('div', 'workbench-terminal-head muted', `native sandbox · ${ALLOWED.join(' ')}`),
    log, el('div', 'workbench-inputrow', input, runButton));
  const fileList = el('div', 'workbench-files');
  const fileView = el('pre', 'workbench-fileview');
  fileView.hidden = true;
  const checksPanel = el('div', 'workbench-checks');
  const verifyButton = el('button', '', 'Verify native state');
  verifyButton.type = 'button';
  const resetButton = iconButton('Reset workspace', 'rotate-ccw', () => setupWorkspace(true));
  root.append(terminal, el('div', 'workbench-side', fileList, fileView), checksPanel,
    el('div', 'workbench-actions', data.mode === 'challenge' ? verifyButton : null, resetButton));

  /**
   * @param {{ cmd: string, stdout: string, stderr: string, code: number }} entry
   * @param {boolean} [record]
   */
  function appendLog(entry, record = true) {
    if (record) history.push(entry);
    const block = el('div', 'workbench-entry',
      el('div', 'workbench-cmd', `$ ${entry.cmd}`),
      entry.stdout ? el('pre', 'workbench-stdout', entry.stdout) : null,
      entry.stderr ? el('pre', 'workbench-stderr', entry.stderr) : null,
      entry.code !== 0 ? el('span', 'workbench-code muted', `exit ${entry.code}`) : null);
    log.append(block);
    log.scrollTop = log.scrollHeight;
  }

  for (const entry of history) appendLog(entry, false);

  async function refreshFiles() {
    try {
      const files = /** @type {FileEntry[]} */ (await invoke('workbench_list', { workspaceId }));
      if (destroyed) return;
      fileList.replaceChildren(el('div', 'workbench-files-head muted', 'workspace files'));
      for (const file of files) {
        const item = el('button', 'workbench-file', `${file.path} (${file.size} B)`);
        item.type = 'button';
        item.addEventListener('click', async () => {
          try {
            const content = /** @type {string} */ (await invoke('workbench_read', { workspaceId, path: file.path }));
            if (destroyed) return;
            fileView.textContent = `${file.path}\n${'─'.repeat(24)}\n${content}`;
            fileView.hidden = false;
          } catch (error) {
            props.onError(error);
          }
        });
        fileList.append(item);
      }
      if (!files.length) fileList.append(el('p', 'muted workbench-empty', '(empty)'));
    } catch {
      // Workspace listing is best-effort between commands.
    }
  }

  /** @param {boolean} [force] */
  async function setupWorkspace(force) {
    try {
      if (force) await invoke('workbench_reset', { workspaceId });
      await invoke('workbench_init', { workspaceId });
      for (const file of data.setup?.files ?? []) {
        await invoke('workbench_write', { workspaceId, path: file.path, content: file.content });
      }
      if (data.setup?.gitInit) {
        await invoke('workbench_run', { workspaceId, program: 'git', args: ['init', '-b', 'main'], outputFile: null });
        await invoke('workbench_run', { workspaceId, program: 'git', args: ['add', '.'], outputFile: null });
        await invoke('workbench_run', { workspaceId, program: 'git', args: ['commit', '-m', 'initial setup'], outputFile: null });
      }
      if (!destroyed) await refreshFiles();
    } catch (error) {
      if (!destroyed) props.onError(error);
    }
  }

  async function runCommand() {
    const line = input.value.trim();
    if (!line || props.readOnly) return;
    const parsed = parseCommand(line);
    if ('error' in parsed) {
      appendLog({ cmd: line, stdout: '', stderr: parsed.error, code: 1 });
      persist();
      return;
    }
    input.value = '';
    runButton.disabled = true;
    try {
      const output = /** @type {RunOutput} */ (parsed.stages.length === 1
        ? await invoke('workbench_run', {
          workspaceId, program: parsed.stages[0][0], args: parsed.stages[0].slice(1), outputFile: parsed.outputFile,
        })
        : await invoke('workbench_pipeline', {
          workspaceId, stages: parsed.stages, outputFile: parsed.outputFile,
        }));
      if (destroyed) return;
      appendLog({ cmd: line, ...output });
      await refreshFiles();
      persist();
    } catch (error) {
      if (!destroyed) {
        appendLog({ cmd: line, stdout: '', stderr: error instanceof Error ? error.message : String(error), code: 1 });
        persist();
      }
    } finally {
      if (!destroyed) runButton.disabled = false;
    }
  }

  runButton.addEventListener('click', runCommand);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runCommand();
    }
  });

  /**
   * @param {{ type: string, [key: string]: unknown }} check
   * @returns {Promise<{ label: string, pass: boolean, detail: string }>}
   */
  async function runCheck(check) {
    /** @param {string[]} args */
    const git = async args => /** @type {RunOutput} */ (await invoke('workbench_run', { workspaceId, program: 'git', args, outputFile: null }));
    switch (check.type) {
      case 'branch-exists': {
        const out = await git(['branch', '--list']);
        const pass = out.stdout.split('\n').some(line => line.replace('*', '').trim() === check.name);
        return { label: `branch "${check.name}" exists`, pass, detail: pass ? 'found' : 'not found' };
      }
      case 'current-branch': {
        const out = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
        const pass = out.stdout.trim() === check.name;
        return { label: `on branch "${check.name}"`, pass, detail: `currently on "${out.stdout.trim()}"` };
      }
      case 'log-contains': {
        const out = await git(['log', '--oneline']);
        const pass = out.stdout.includes(String(check.text));
        return { label: `history contains "${check.text}"`, pass, detail: pass ? 'found' : 'not in history' };
      }
      case 'file-exists': {
        try {
          await invoke('workbench_read', { workspaceId, path: check.path });
          return { label: `${check.path} exists`, pass: true, detail: 'found' };
        } catch {
          return { label: `${check.path} exists`, pass: false, detail: 'missing' };
        }
      }
      case 'file-equals': {
        try {
          const content = /** @type {string} */ (await invoke('workbench_read', { workspaceId, path: check.path }));
          const pass = content === check.content;
          return { label: `${check.path} matches`, pass, detail: pass ? 'exact match' : `got ${JSON.stringify(content.slice(0, 80))}` };
        } catch {
          return { label: `${check.path} matches`, pass: false, detail: 'missing' };
        }
      }
      case 'pipeline-output': {
        const out = /** @type {RunOutput} */ (await invoke('workbench_pipeline', { workspaceId, stages: check.stages, outputFile: null }));
        const pass = out.stdout.trim() === String(check.expected).trim();
        return {
          label: `pipeline → ${JSON.stringify(check.expected)}`,
          pass,
          detail: pass ? 'matches' : `got ${JSON.stringify(out.stdout.trim().slice(0, 80))}`,
        };
      }
      default:
        return { label: 'unknown check', pass: false, detail: 'unsupported check type' };
    }
  }

  function renderChecks() {
    checksPanel.replaceChildren();
    if (!checkResults) return;
    for (const result of checkResults) {
      checksPanel.append(el('div', `workbench-check ${result.pass ? 'pass' : 'fail'}`,
        el('span', 'workbench-check-mark', result.pass ? '✓' : '✗'),
        el('span', 'workbench-check-label', result.label),
        el('span', 'workbench-check-detail muted', result.detail)));
    }
  }

  verifyButton.addEventListener('click', async () => {
    if (props.readOnly || !data.checks) return;
    verifyButton.disabled = true;
    try {
      const results = [];
      for (const check of data.checks) {
        results.push(await runCheck(/** @type {any} */ (check)));
      }
      if (destroyed) return;
      checkResults = results;
      status = results.every(result => result.pass) ? 'passed' : 'in-progress';
      renderChecks();
      persist();
    } catch (error) {
      if (!destroyed) props.onError(error);
    } finally {
      if (!destroyed) verifyButton.disabled = false;
    }
  });

  if (props.readOnly) {
    input.disabled = true;
    runButton.disabled = true;
    verifyButton.disabled = true;
  }
  renderChecks();
  setupWorkspace(false);

  return {
    destroy() {
      destroyed = true;
    },
  };
}
