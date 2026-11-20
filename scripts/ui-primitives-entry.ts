/**
 * Test-only entry: mounts every design-system primitive with assertion hooks.
 * Built and driven by scripts/check-ui-primitives.mjs (not shipped in the app).
 */
import '../src/components/ui/tokens.css';
import '../src/components/ui/controls.css';
import {
  Button, IconButton, ToggleSwitch, SegmentedControl, setErrorHandler, setButtonLoading,
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