/**
 * Button and IconButton primitives — the only sanctioned way to render
 * buttons in the app and in extensions.
 *
 * @module components/ui/buttons
 */
import { asyncAction, el, icon } from './dom.ts';
import { buttonClasses, ds, iconButtonClasses } from './classes.ts';
import type { ButtonSize, ButtonVariant } from './classes.ts';

export interface ButtonProps {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** lucide glyph name rendered before the label. */
  leftIcon?: string;
  /** lucide glyph name rendered after the label. */
  rightIcon?: string;
  /** Shows a spinner and disables the button while true. */
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (event: MouseEvent) => void | Promise<void>;
  className?: string;
  title?: string;
  ariaLabel?: string;
  /** Sets data-testid for E2E hooks. */
  testId?: string;
}

function spinner(): HTMLElement {
  const node = el('span', ds.spinner);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/** Apply/refresh the loading state without rebuilding the button. */
export function setButtonLoading(node: HTMLButtonElement, loading: boolean): void {
  node.dataset.loading = String(loading);
  node.disabled = loading || node.dataset.disabled === 'true';
  const existing = node.querySelector(`:scope > .${ds.spinner}`);
  if (loading && !existing) node.prepend(spinner());
  if (!loading && existing) existing.remove();
}

export function Button(props: ButtonProps): HTMLButtonElement {
  const {
    label = '', variant = 'ghost', size = 'md', leftIcon, rightIcon,
    loading = false, disabled = false, type = 'button', onClick, className = '', title, ariaLabel, testId,
  } = props;
  const node = el('button', buttonClasses(variant, size, className));
  node.type = type;
  if (testId) node.dataset.testid = testId;
  if (title) node.title = title;
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  if (leftIcon) node.append(icon(leftIcon));
  if (label) node.append(el('span', 'ds-btn-label', label));
  if (rightIcon) node.append(icon(rightIcon));
  if (disabled) node.dataset.disabled = 'true';
  node.disabled = disabled;
  if (loading) setButtonLoading(node, true);
  if (onClick) asyncAction(node, onClick);
  return node;
}

export interface IconButtonProps {
  /** lucide glyph name. */
  icon: string;
  /** Accessible name — also used as the tooltip. */
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void | Promise<void>;
  className?: string;
  testId?: string;
}

export function IconButton(props: IconButtonProps): HTMLButtonElement {
  const { icon: glyph, label, size = 'md', variant = 'ghost', pressed, disabled = false, onClick, className = '', testId } = props;
  const node = el('button', iconButtonClasses(size, className));
  node.type = 'button';
  if (testId) node.dataset.testid = testId;
  node.title = label;
  node.setAttribute('aria-label', label);
  if (variant !== 'ghost') node.classList.add(`${ds.button}--${variant}`);
  if (pressed !== undefined) node.setAttribute('aria-pressed', String(pressed));
  node.disabled = disabled;
  node.append(icon(glyph));
  if (onClick) asyncAction(node, onClick);
  return node;
}