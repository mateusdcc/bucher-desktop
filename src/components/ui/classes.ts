/**
 * Canonical design-system class names. Single source for both the vanilla
 * factories and React island JSX — styling lives only in the design-system
 * CSS, never in feature files.
 *
 * @module components/ui/classes
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md';
export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
export type CalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'hint';

export const ds = {
  button: 'ds-btn',
  iconButton: 'ds-icon-btn',
  spinner: 'ds-spinner',
  switch: 'ds-switch',
  switchKnob: 'ds-switch-knob',
  segmented: 'ds-segmented',
  segmentedItem: 'ds-segmented-item',
} as const;

const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'success'];
const BUTTON_SIZES: readonly ButtonSize[] = ['xs', 'sm', 'md'];

/** Compose the canonical button class list (pure — unit tested). */
export function buttonClasses(variant: ButtonVariant = 'ghost', size: ButtonSize = 'md', extra = ''): string {
  const safeVariant = BUTTON_VARIANTS.includes(variant) ? variant : 'ghost';
  const safeSize = BUTTON_SIZES.includes(size) ? size : 'md';
  return [ds.button, `${ds.button}--${safeVariant}`, `${ds.button}--${safeSize}`, extra]
    .filter(Boolean).join(' ');
}

/** Icon-button class list; square geometry comes from the size modifier. */
export function iconButtonClasses(size: ButtonSize = 'md', extra = ''): string {
  const safeSize = BUTTON_SIZES.includes(size) ? size : 'md';
  return [ds.iconButton, `${ds.iconButton}--${safeSize}`, extra].filter(Boolean).join(' ');
}