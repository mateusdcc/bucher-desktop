/**
 * Form input primitives: Input, Textarea, Select. One visual language for
 * every form in the app (settings, AI flows, dialogs, extension controls).
 *
 * @module components/ui/inputs
 */
import { el } from './dom.ts';
import { ds } from './classes.ts';
import type { ButtonSize } from './classes.ts';

export interface InputProps {
  label?: string;
  value?: string;
  placeholder?: string;
  type?: 'text' | 'search' | 'number';
  /** Monospace styling for code/source values. */
  mono?: boolean;
  required?: boolean;
  maxLength?: number;
  disabled?: boolean;
  ariaLabel?: string;
  size?: ButtonSize;
  name?: string;
  testId?: string;
  onInput?: (value: string) => void;
  onEnter?: () => void;
}

export interface InputHandle {
  root: HTMLElement;
  input: HTMLInputElement;
  setValue(value: string): void;
}

/** Wrap a control in a label row when a visible label is provided. */
function field(label: string | undefined, control: HTMLElement, extraClass = ''): HTMLElement {
  if (!label) return control;
  return el('label', `${ds.field} ${extraClass}`.trim(), el('span', ds.fieldLabel, label), control);
}

export function Input(props: InputProps): InputHandle {
  const {
    label, value = '', placeholder, type = 'text', mono = false, required = false,
    maxLength, disabled = false, ariaLabel, size = 'md', name, testId, onInput, onEnter,
  } = props;
  const input = el('input', `${ds.input} ${mono ? ds.inputMono : ''} ${ds.input}--${size}`.replace(/\s+/g, ' ').trim());
  input.type = type;
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  if (required) input.required = true;
  if (maxLength !== undefined) input.maxLength = maxLength;
  if (name) input.name = name;
  if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
  if (testId) input.dataset.testid = testId;
  input.disabled = disabled;
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  if (onEnter) input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    }
  });
  return { root: field(label, input), input, setValue: next => { input.value = next; } };
}

export interface TextareaProps extends Omit<InputProps, 'type' | 'onEnter'> {
  rows?: number;
  /** Auto-grow with content (the AI question field behavior). */
  autoGrow?: boolean;
  /** Monospace source editing (Markdown editors). */
  source?: boolean;
}

export interface TextareaHandle {
  root: HTMLElement;
  input: HTMLTextAreaElement;
  setValue(value: string): void;
}

export function Textarea(props: TextareaProps): TextareaHandle {
  const {
    label, value = '', placeholder, mono = false, required = false, maxLength,
    disabled = false, ariaLabel, name, testId, onInput, rows = 3, autoGrow = false, source = false,
  } = props;
  const textarea = el('textarea', `${ds.textarea} ${mono || source ? ds.inputMono : ''}`.replace(/\s+/g, ' ').trim());
  textarea.value = value;
  textarea.rows = rows;
  if (placeholder) textarea.placeholder = placeholder;
  if (required) textarea.required = true;
  if (maxLength !== undefined) textarea.maxLength = maxLength;
  if (name) textarea.name = name;
  if (ariaLabel) textarea.setAttribute('aria-label', ariaLabel);
  if (testId) textarea.dataset.testid = testId;
  textarea.disabled = disabled;
  if (source) textarea.spellcheck = false;
  let control: HTMLElement = textarea;
  if (autoGrow) {
    const fit = el('span', ds.fit, textarea);
    const syncHeight = (): void => { fit.dataset.value = textarea.value; };
    textarea.addEventListener('input', syncHeight);
    syncHeight();
    control = fit;
  }
  if (onInput) textarea.addEventListener('input', () => onInput(textarea.value));
  return { root: field(label, control), input: textarea, setValue: next => { textarea.value = next; } };
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  label?: string;
  value?: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
  size?: ButtonSize;
  name?: string;
  testId?: string;
}

export interface SelectHandle<T extends string> {
  root: HTMLElement;
  select: HTMLSelectElement;
  setValue(value: T): void;
}

export function Select<T extends string>(props: SelectProps<T>): SelectHandle<T> {
  const { label, value, options, onChange, ariaLabel, disabled = false, size = 'md', name, testId } = props;
  const select = el('select', `${ds.select} ${ds.select}--${size}`);
  if (ariaLabel) select.setAttribute('aria-label', ariaLabel);
  if (name) select.name = name;
  if (testId) select.dataset.testid = testId;
  select.disabled = disabled;
  for (const option of options) {
    const node = el('option', '', option.label);
    node.value = option.value;
    select.append(node);
  }
  if (value !== undefined) select.value = value;
  select.addEventListener('change', () => onChange(select.value as T));
  return { root: field(label, select), select, setValue: next => { select.value = next; } };
}