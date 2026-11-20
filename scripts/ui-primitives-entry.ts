/**
 * Test-only entry: mounts every design-system primitive with assertion hooks.
 * Built and driven by scripts/check-ui-primitives.mjs (not shipped in the app).
 */
import '../src/components/ui/tokens.css';
import '../src/components/ui/controls.css';
import '../src/components/ui/inputs.css';
import '../src/components/ui/containers.css';
import '../src/components/ui/feedback.css';
import '../src/components/ui/workbench.css';
import 'katex/dist/katex.css';
import {
  el,
  Button, IconButton, ToggleSwitch, SegmentedControl, setErrorHandler, setButtonLoading,
  Input, Textarea, Select, ParameterSlider,
  Card, PanelHeader, Toolbar, Tabs, Badge, Modal, Drawer, CalloutBanner, EmptyState, Spinner, ProgressBar, Toast,
  ConsoleOutput, InteractiveWorkbench, SplitPane, PlaybackControls,
} from '../src/components/ui/index.ts';

declare global {
  interface Window {
    __errors: unknown[];
    __resolveAsync: () => void;
    __setLoading: (value: boolean) => void;
    __switchValue: boolean;
    __segValue: string;
    __segSet: (value: 'code' | 'output' | 'preview') => void;
    __submits: number;
    __inputValue: string;
    __textareaValue: string;
    __selectValue: string;
    __paramValue: number;
    __paramSet: (value: number) => void;
    __paramDisable: (value: boolean) => void;
    __tabValue: string;
    __modalClosed: number;
    __drawerClosed: number;
    __collapsed: boolean;
    __wbReset: number;
    __wbHint: number;
    __wbRun: number;
    __consoleAppend: (kind: 'cmd' | 'stdout' | 'stderr' | 'info', text: string, meta?: string) => void;
    __consoleClear: () => void;
    __consoleOpen: (open: boolean) => void;
    __playing: boolean;
    __playToggle: () => void;
    __stepBack: () => void;
    __stepForward: () => void;
    __speed: number;
    __playSetPlaying: (value: boolean) => void;
    __playSetIndex: (index: number, count: number) => void;
    __playSetReadout: (text: string) => void;
  }
}

document.body.style.background = 'var(--bg-app)';
document.body.style.color = 'var(--text-secondary)';
document.body.style.fontFamily = 'var(--font-ui)';
document.body.style.margin = '0';
const root = document.getElementById('app')!;
root.style.padding = '24px';
root.style.display = 'flex';
root.style.flexDirection = 'column';
root.style.gap = '20px';

window.__errors = [];
setErrorHandler(error => window.__errors.push(error));

function section(id: string, title: string): HTMLElement {
  const box = document.createElement('section');
  box.id = id;
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.fontSize = '13px';
  heading.style.margin = '0 0 8px';
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.gap = '8px';
  row.style.alignItems = 'center';
  box.append(heading, row);
  root.append(box);
  return row;
}

// 1 — variants and sizes
const variants = section('variants', 'Variants');
for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'success'] as const) {
  variants.append(Button({ label: variant, variant, leftIcon: 'check' }));
}
const sizes = section('sizes', 'Sizes');
for (const size of ['xs', 'sm', 'md'] as const) {
  sizes.append(Button({ label: size, size, variant: 'secondary', rightIcon: 'arrow-right' }));
}

// 2 — async lifecycle
const asyncRow = section('async', 'Async action');
let resolveAsync: () => void = () => {};
asyncRow.append(Button({
  label: 'Async action', variant: 'primary', testId: 'async-btn',
  onClick: () => new Promise<void>(resolve => { resolveAsync = resolve; }),
}));
window.__resolveAsync = () => resolveAsync();

// 3 — error reporting
const errorRow = section('errors', 'Error handling');
errorRow.append(Button({
  label: 'Fails', variant: 'danger', testId: 'error-btn',
  onClick: async () => { throw new Error('boom'); },
}));

// 4 — loading prop + imperative setter
const loadingRow = section('loading', 'Loading state');
const loadingBtn = Button({ label: 'Loading', variant: 'primary', loading: true, testId: 'loading-btn' });
loadingRow.append(loadingBtn);
window.__setLoading = value => setButtonLoading(loadingBtn, value);

// 5 — icon button pressed state
const iconRow = section('icons', 'Icon buttons');
let pressed = false;
const toggle = IconButton({
  icon: 'brain', label: 'Cloze quiz', pressed, testId: 'icon-toggle',
  onClick: () => {
    pressed = !pressed;
    toggle.setAttribute('aria-pressed', String(pressed));
  },
});
iconRow.append(toggle, IconButton({ icon: 'x', label: 'Close', size: 'sm' }), IconButton({ icon: 'plus', label: 'Add', size: 'xs' }));

// 6 — switch
const switchRow = section('switch', 'Toggle switch');
const sw = ToggleSwitch({
  checked: false, label: 'Enable ext-mermaid', testId: 'demo-switch',
  onChange: value => { window.__switchValue = value; },
});
switchRow.append(sw.root);

// 7 — segmented control
const segRow = section('segmented', 'Segmented control');
const seg = SegmentedControl({
  options: [
    { value: 'code', label: 'Code', icon: 'code' },
    { value: 'output', label: 'Output', icon: 'terminal' },
    { value: 'preview', label: 'Preview', icon: 'eye' },
  ],
  value: 'code', ariaLabel: 'View mode', testId: 'demo-segmented',
  onChange: value => { window.__segValue = value; },
});
segRow.append(seg.root);
window.__segSet = value => seg.setValue(value);

// 8 — submit button in a form
const formRow = section('form', 'Form submit');
window.__submits = 0;
const form = document.createElement('form');
form.addEventListener('submit', event => {
  event.preventDefault();
  window.__submits += 1;
});
form.append(Button({ label: 'Save changes', variant: 'primary', type: 'submit', leftIcon: 'check', testId: 'submit-btn' }));
formRow.append(form);

// 9 — input with label + onInput
const inputRow = section('input', 'Input');
const nameInput = Input({
  label: 'Book title', placeholder: 'Enter a title', testId: 'demo-input',
  onInput: value => { window.__inputValue = value; },
});
inputRow.append(nameInput.root);

// 10 — auto-grow textarea + source textarea
const textareaRow = section('textarea', 'Textarea');
const question = Textarea({
  label: 'Question', autoGrow: true, rows: 1, testId: 'demo-textarea',
  onInput: value => { window.__textareaValue = value; },
});
const source = Textarea({ label: 'Source', source: true, rows: 3, value: '# Title\n\nBody text.', ariaLabel: 'Markdown source' });
textareaRow.append(question.root, source.root);

// 11 — select
const selectRow = section('select', 'Select');
const provider = Select({
  label: 'AI provider', value: 'ollama', testId: 'demo-select',
  options: [{ value: 'ollama', label: 'Ollama' }, { value: 'chatgpt', label: 'ChatGPT' }],
  onChange: value => { window.__selectValue = value; },
});
selectRow.append(provider.root);

// 12 — parameter sliders: plain, with reset, with live TeX
const paramRow = section('params', 'ParameterSlider');
paramRow.style.display = 'grid';
paramRow.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
paramRow.style.gap = '10px 24px';
const h = ParameterSlider({
  name: 'h', value: 0, min: -4, max: 4, step: 0.1, defaultValue: 0, testId: 'param-h',
  onInput: value => { window.__paramValue = value; },
});
const a = ParameterSlider({
  name: 'a', value: 1, min: -3, max: 3, step: 0.05, defaultValue: 1,
  tex: value => `a = ${value.toFixed(2)}`, testId: 'param-a',
  onInput: () => {},
});
const locked = ParameterSlider({
  name: 'k', value: 2, min: 0, max: 5, step: 1, disabled: true, ariaLabel: 'Locked parameter',
  onInput: () => {},
});
paramRow.append(h.root, a.root, locked.root);
window.__paramSet = value => h.setValue(value);
window.__paramDisable = value => h.setDisabled(value);

// 13 — card + panel header with badge and actions
const cardRow = section('cards', 'Card & PanelHeader');
cardRow.style.display = 'grid';
cardRow.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
cardRow.style.gap = '12px';
window.__collapsed = false;
const demoCard = Card({
  padding: 'none', testId: 'demo-card',
  children: [
    PanelHeader({
      icon: 'puzzle', title: 'ext-mermaid', subtitle: 'v1.0.0 · visualization',
      badge: { variant: 'success', children: 'warm' },
      collapsible: { expanded: true, onToggle: expanded => { window.__collapsed = !expanded; } },
      actions: [IconButton({ icon: 'rotate-ccw', label: 'Reset state', size: 'sm' })],
    }),
    el('div', '', 'Card body content.'),
  ],
});
const insetCard = Card({ inset: true, padding: 'sm', children: ['Inset surface for consoles and code.'] });
cardRow.append(demoCard, insetCard);

// 14 — toolbar + badges
const badgeRow = section('badges', 'Toolbar & Badge');
const badgeToolbar = Toolbar({
  children: [
    Button({ label: 'Run', variant: 'primary', size: 'sm', leftIcon: 'play' }),
    Button({ label: 'Reset', size: 'sm', leftIcon: 'rotate-ccw' }),
    Badge({ variant: 'neutral', children: 'Unsolved', testId: 'badge-unsolved' }),
    Badge({ variant: 'warning', children: 'In Progress' }),
    Badge({ variant: 'success', children: 'Passed', icon: 'check' }),
    Badge({ variant: 'info', children: 'lazy-loaded' }),
    Badge({ variant: 'danger', children: 'error' }),
    Badge({ variant: 'accent', children: 'exercise' }),
  ],
});
badgeRow.append(badgeToolbar);

// 15 — tabs with keyboard navigation
const tabRow = section('tabs', 'Tabs');
const demoTabs = Tabs({
  tabs: [
    { value: 'solution', label: 'Solution', icon: 'file-text' },
    { value: 'ai', label: 'AI solution', icon: 'sparkles' },
    { value: 'compare', label: 'Compare', icon: 'columns-2' },
  ],
  value: 'solution', ariaLabel: 'Solution attempts', testId: 'demo-tabs',
  onChange: value => { window.__tabValue = value; },
});
tabRow.append(demoTabs.root);

// 16 — callout banners (all tones)
const calloutRow = section('callouts', 'CalloutBanner');
calloutRow.style.display = 'grid';
calloutRow.style.gap = '8px';
calloutRow.append(
  CalloutBanner({ tone: 'success', title: 'All tests passed', children: ['3 of 3 assertions satisfied.'], testId: 'callout-success' }),
  CalloutBanner({ tone: 'danger', title: 'Query failed', children: ['relation "orders" does not exist'], actions: [Button({ label: 'Retry', size: 'xs', leftIcon: 'refresh-cw' })] }),
  CalloutBanner({ tone: 'warning', children: ['Native capability unavailable — running in degraded mode.'] }),
  CalloutBanner({ tone: 'info', children: ['The engine loads lazily on first use.'] }),
  CalloutBanner({ tone: 'hint', title: 'Hint 1', children: ['Try grouping by region first.'] }),
);

// 17 — empty state + progress + spinner
const miscRow = section('misc', 'EmptyState, ProgressBar, Spinner');
miscRow.style.display = 'grid';
miscRow.style.gap = '12px';
const progress = ProgressBar({ value: 3, max: 8, label: 'Exercises solved', testId: 'demo-progress' });
miscRow.append(
  EmptyState({ icon: 'clipboard-list', title: 'No exercises yet', hint: 'Add an exercise block to this chapter to start practicing.', action: Button({ label: 'Add exercise', size: 'sm', leftIcon: 'plus' }) }),
  progress.root,
  Spinner({ label: 'Loading engine' }),
);

// 18 — modal + drawer launchers (overlays are opened by the E2E driver)
const overlayRow = section('overlays', 'Modal & Drawer');
overlayRow.append(
  Button({
    label: 'Open modal', variant: 'secondary', testId: 'open-modal',
    onClick: () => {
      const modal = Modal({
        title: 'New book', size: 'sm', testId: 'demo-modal',
        onClose: () => { window.__modalClosed += 1; },
      });
      modal.body.append(Input({ label: 'Book title', placeholder: 'Enter a title' }).root);
      modal.setActions([
        Button({ label: 'Cancel', onClick: () => modal.close() }),
        Button({ label: 'Create book', variant: 'primary', onClick: () => modal.close() }),
      ]);
    },
  }),
  Button({
    label: 'Open drawer', variant: 'secondary', testId: 'open-drawer',
    onClick: () => {
      const drawer = Drawer({
        title: 'Inspector', side: 'right', testId: 'demo-drawer',
        onClose: () => { window.__drawerClosed += 1; },
      });
      drawer.body.append(CalloutBanner({ tone: 'info', children: ['Drawer content.'] }));
    },
  }),
  Button({ label: 'Show toast', variant: 'secondary', testId: 'show-toast', onClick: () => Toast('Patch applied.') }),
);
window.__modalClosed = 0;
window.__drawerClosed = 0;

// 19 — InteractiveWorkbench with console + footer
const wbRow = section('workbench', 'InteractiveWorkbench');
wbRow.style.display = 'block';
window.__wbReset = 0;
window.__wbHint = 0;
window.__wbRun = 0;
const wbConsole = ConsoleOutput({ title: 'Terminal', collapsible: true, maxHeight: 140, testId: 'wb-console' });
wbConsole.append({ kind: 'cmd', text: 'git status', meta: 'exit 0' });
wbConsole.append({ kind: 'stdout', text: 'On branch main\nnothing to commit' });
const workbench = InteractiveWorkbench({
  description: el('p', '', 'A standardized interactive shell.'),
  toolbar: [Badge({ variant: 'info', children: 'DuckDB 1.32' })],
  status: Badge({ variant: 'warning', children: 'In Progress', testId: 'wb-status' }),
  stage: Card({ inset: true, padding: 'sm', children: ['Stage: editor / canvas goes here.'] }),
  console: wbConsole,
  footer: {
    reset: () => { window.__wbReset += 1; },
    hint: () => { window.__wbHint += 1; },
    run: { label: 'Run query', onClick: async () => { window.__wbRun += 1; } },
  },
  testId: 'demo-workbench',
});
wbRow.append(workbench.root);
window.__consoleAppend = (kind, text, meta) => wbConsole.append({ kind, text, meta });
window.__consoleClear = () => wbConsole.clear();
window.__consoleOpen = open => workbench.setConsoleOpen(open);

// 20 — PlaybackControls
const playRow = section('playback', 'PlaybackControls');
window.__playing = false;
window.__speed = 1;
let playIndex = 0;
const playback = PlaybackControls({
  playing: false,
  onTogglePlay: () => { window.__playing = !window.__playing; playback.setPlaying(window.__playing); },
  onStepBack: () => { playIndex = Math.max(0, playIndex - 1); playback.setIndex(playIndex, 12); },
  onStepForward: () => { playIndex = Math.min(11, playIndex + 1); playback.setIndex(playIndex, 12); },
  index: 0, count: 12,
  onScrub: index => { playIndex = index; playback.setIndex(index, 12); },
  speed: 1,
  onSpeedChange: speed => { window.__speed = speed; },
  readout: 'step 1',
  ariaLabel: 'Algorithm player',
  testId: 'demo-playback',
});
playRow.append(playback.root);
window.__playToggle = () => { window.__playing = !window.__playing; playback.setPlaying(window.__playing); };
window.__stepBack = () => { playIndex = Math.max(0, playIndex - 1); playback.setIndex(playIndex, 12); };
window.__stepForward = () => { playIndex = Math.min(11, playIndex + 1); playback.setIndex(playIndex, 12); };
window.__playSetPlaying = value => playback.setPlaying(value);
window.__playSetIndex = (index, count) => playback.setIndex(index, count);
window.__playSetReadout = text => playback.setReadout(text);

// 21 — SplitPane (horizontal + vertical)
const splitRow = section('split', 'SplitPane');
splitRow.style.display = 'grid';
splitRow.style.gap = '12px';
const hSplit = SplitPane({
  direction: 'horizontal', initial: 220, min: 120, max: 400, storageKey: 'demo-hsplit', name: 'Resize demo split',
  first: Card({ inset: true, padding: 'sm', children: ['First pane'] }),
  second: Card({ padding: 'sm', children: ['Second pane'] }),
});
hSplit.style.height = '120px';
hSplit.dataset.testid = 'demo-hsplit';
const vSplit = SplitPane({
  direction: 'vertical', initial: 60, min: 30, max: 160, storageKey: 'demo-vsplit', name: 'Resize demo vertical split',
  first: Card({ inset: true, padding: 'sm', children: ['Top pane'] }),
  second: Card({ padding: 'sm', children: ['Bottom pane'] }),
});
vSplit.style.height = '160px';
vSplit.dataset.testid = 'demo-vsplit';
splitRow.append(hSplit, vSplit);