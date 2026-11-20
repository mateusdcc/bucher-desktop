/**
 * ToggleSwitch and SegmentedControl primitives.
 *
 * @module components/ui/toggle
 */
import { el, icon } from './dom.ts';
import { ds } from './classes.ts';
import type { ButtonSize } from './classes.ts';

export interface ToggleSwitchProps {
  checked: boolean;
  /** Accessible name, e.g. "Enable ext-mermaid". */
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}

export interface ToggleSwitchHandle {
  root: HTMLButtonElement;
  setChecked(checked: boolean): void;
}

export function ToggleSwitch(props: ToggleSwitchProps): ToggleSwitchHandle {
  const { checked, label, onChange, disabled = false, testId } = props;
  const root = el('button', ds.switch, el('span', ds.switchKnob));
  root.type = 'button';
  if (testId) root.dataset.testid = testId;
  root.setAttribute('role', 'switch');
  root.disabled = disabled;
  let current = checked;
  function sync(): void {
    root.setAttribute('aria-checked', String(current));
    root.setAttribute('aria-label', label);
    root.title = label;
  }
  sync();
  root.addEventListener('click', () => {
    current = !current;
    sync();
    onChange(current);
  });
  return {
    root,
    setChecked(value: boolean) {
      current = value;
      sync();
    },
  };
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional lucide glyph. */
  icon?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: ButtonSize;
  testId?: string;
}

export interface SegmentedControlHandle<T extends string> {
  root: HTMLElement;
  setValue(value: T): void;
}

/** Mode switcher (Visualize/Exercise, Code/Output, Preview/Source, settings tabs). */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>): SegmentedControlHandle<T> {
  const { options, value, onChange, ariaLabel, size = 'md', testId } = props;
  const root = el('div', `${ds.segmented} ${ds.segmented}--${size}`);
  if (testId) root.dataset.testid = testId;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', ariaLabel);
  let current = value;
  const items = new Map<T, HTMLButtonElement>();
  function sync(): void {
    for (const [optionValue, item] of items) item.setAttribute('aria-pressed', String(optionValue === current));
  }
  for (const option of options) {
    const item = el('button', ds.segmentedItem);
    item.type = 'button';
    if (option.icon) item.append(icon(option.icon));
    item.append(el('span', '', option.label));
    item.addEventListener('click', () => {
      if (current === option.value) return;
      current = option.value;
      sync();
      onChange(current);
    });
    items.set(option.value, item);
    root.append(item);
  }
  sync();
  return {
    root,
    setValue(next: T) {
      current = next;
      sync();
    },
  };
}