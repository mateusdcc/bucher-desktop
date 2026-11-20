/**
 * Feedback primitives: CalloutBanner, EmptyState, Spinner, ProgressBar,
 * Toast. One visual language for hints, validation errors, runtime
 * diagnostics, success states, loading, and empty screens.
 *
 * @module components/ui/feedback
 */
import { el, icon } from './dom.ts';
import { ds } from './classes.ts';
import type { CalloutTone } from './classes.ts';

const TONE_ICONS: Record<CalloutTone, string> = {
  info: 'info',
  success: 'circle-check',
  warning: 'alert-triangle',
  danger: 'circle-alert',
  hint: 'lightbulb',
};

export interface CalloutBannerProps {
  tone: CalloutTone;
  title?: string;
  /** Override the default tone icon. */
  icon?: string;
  children?: (Node | string | null | undefined)[];
  actions?: Node[];
  className?: string;
  testId?: string;
}

export function CalloutBanner(props: CalloutBannerProps): HTMLElement {
  const { tone, title, icon: glyph, children = [], actions = [], className = '', testId } = props;
  const node = el('div', `${ds.callout} ${ds.callout}--${tone} ${className}`.replace(/\s+/g, ' ').trim());
  node.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  if (testId) node.dataset.testid = testId;
  node.append(icon(glyph ?? TONE_ICONS[tone]));
  const content = el('div', ds.calloutContent);
  if (title) content.append(el('strong', ds.calloutTitle, title));
  content.append(...children.filter((child): child is Node | string => child !== null && child !== undefined));
  node.append(content);
  if (actions.length) node.append(el('div', ds.calloutActions, ...actions));
  return node;
}

export interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
  action?: Node;
  className?: string;
}

export function EmptyState(props: EmptyStateProps): HTMLElement {
  const { icon: glyph = 'inbox', title, hint, action, className = '' } = props;
  const node = el('div', `${ds.empty} ${className}`.trim());
  node.append(icon(glyph), el('p', ds.emptyTitle, title));
  if (hint) node.append(el('p', ds.emptyHint, hint));
  if (action) node.append(action);
  return node;
}

export interface SpinnerProps {
  size?: 'sm' | 'md';
  /** Accessible label; announces the spinner as a status when provided. */
  label?: string;
}

export function Spinner(props: SpinnerProps = {}): HTMLElement {
  const { size = 'md', label } = props;
  const node = el('span', `${ds.spinner} ${size === 'sm' ? ds.spinnerSm : ''}`.trim());
  if (label) {
    node.setAttribute('role', 'status');
    node.setAttribute('aria-label', label);
  } else {
    node.setAttribute('aria-hidden', 'true');
  }
  return node;
}

export interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  className?: string;
  testId?: string;
}

export interface ProgressBarHandle {
  root: HTMLElement;
  setValue(value: number): void;
}

export function ProgressBar(props: ProgressBarProps): ProgressBarHandle {
  const { value, max, label, className = '', testId } = props;
  const root = el('div', `${ds.progress} ${className}`.trim());
  if (testId) root.dataset.testid = testId;
  root.setAttribute('role', 'progressbar');
  root.setAttribute('aria-label', label);
  const fill = el('span', ds.progressFill);
  root.append(fill);
  function setValue(next: number): void {
    const ratio = max > 0 ? Math.min(1, Math.max(0, next / max)) : 0;
    fill.style.width = `${ratio * 100}%`;
    root.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');
  }
  setValue(value);
  return { root, setValue };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Transient bottom-right notification (replaces the legacy notice()). */
export function Toast(message: string, tone: 'success' | 'danger' = 'success'): void {
  const node = document.getElementById('notice');
  if (!node) return;
  node.className = `${ds.toast} ${ds.toast}--${tone}`;
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.textContent = ''; }, tone === 'danger' ? 9000 : 4600);
}