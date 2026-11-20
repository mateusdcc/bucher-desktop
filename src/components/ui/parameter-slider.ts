/**
 * ParameterSlider — the signature design-system widget. One implementation
 * for every parameter control: math plotters, Desmos lab, 3D spatial lab,
 * algorithm steppers, and settings. Label + live readout + range + reset.
 *
 * @module components/ui/parameter-slider
 */
import katex from 'katex';
import { el, icon } from './dom.ts';
import { ds } from './classes.ts';

/** Default monospace readout: fixed precision without float noise or trailing zeros. */
export function formatParamValue(value: number, precision = 6): string {
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toFixed(precision)).toString();
}

export interface ParameterSliderProps {
  /** Parameter name, rendered in the italic reader font (e.g. `h`, `α`). */
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Enables the reset-to-default button when provided. */
  defaultValue?: number;
  /** Custom readout formatting (defaults to trimmed fixed precision). */
  format?: (value: number) => string;
  /** Live LaTeX readout: receives the value, returns TeX source (rendered with KaTeX). */
  tex?: (value: number) => string;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  onInput: (value: number) => void;
}

export interface ParameterSliderHandle {
  root: HTMLElement;
  setValue(value: number): void;
  setDisabled(disabled: boolean): void;
}

export function ParameterSlider(props: ParameterSliderProps): ParameterSliderHandle {
  const {
    name, value, min, max, step, defaultValue, format, tex,
    disabled = false, ariaLabel, testId, onInput,
  } = props;
  const root = el('div', ds.param);
  if (testId) root.dataset.testid = testId;
  const label = el('span', ds.paramName, name);
  label.title = name;
  const slider = el('input', ds.paramSlider);
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.disabled = disabled;
  slider.setAttribute('aria-label', ariaLabel ?? name);
  const readout = el('span', ds.paramValue);
  let reset: HTMLButtonElement | null = null;
  if (defaultValue !== undefined) {
    reset = el('button', `${ds.paramReset} ${ds.iconButton} ${ds.iconButton}--xs`);
    reset.type = 'button';
    reset.title = `Reset ${name} to ${formatParamValue(defaultValue)}`;
    reset.setAttribute('aria-label', reset.title);
    reset.append(icon('rotate-ccw'));
    reset.addEventListener('click', () => {
      apply(defaultValue);
      onInput(defaultValue);
    });
  }
  root.append(label, slider, readout);
  if (reset) root.append(reset);

  function drawReadout(current: number): void {
    if (tex) {
      readout.innerHTML = katex.renderToString(tex(current), { throwOnError: false });
      readout.classList.add(ds.paramValueTex);
    } else {
      readout.textContent = format ? format(current) : formatParamValue(current);
    }
  }

  function syncReset(current: number): void {
    if (reset && defaultValue !== undefined) reset.disabled = disabled || current === defaultValue;
  }

  function apply(next: number): void {
    slider.value = String(next);
    drawReadout(next);
    syncReset(next);
  }

  slider.addEventListener('input', () => {
    const next = Number(slider.value);
    drawReadout(next);
    syncReset(next);
    onInput(next);
  });

  apply(value);
  return {
    root,
    setValue: apply,
    setDisabled(next: boolean) {
      slider.disabled = next;
      syncReset(Number(slider.value));
    },
  };
}