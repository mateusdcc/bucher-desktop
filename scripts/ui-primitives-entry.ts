/**
 * Test-only entry: mounts every design-system primitive with assertion hooks.
 * Built and driven by scripts/check-ui-primitives.mjs (not shipped in the app).
 */
import '../src/components/ui/tokens.css';
import '../src/components/ui/controls.css';
import '../src/components/ui/inputs.css';
import 'katex/dist/katex.css';
import {
  Button, IconButton, ToggleSwitch, SegmentedControl, setErrorHandler, setButtonLoading,
  Input, Textarea, Select, ParameterSlider,
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