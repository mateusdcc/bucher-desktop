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
  field: 'ds-field',
  fieldLabel: 'ds-field-label',
  input: 'ds-input',
  inputMono: 'ds-input--mono',
  textarea: 'ds-textarea',
  fit: 'ds-fit',
  select: 'ds-select',
  param: 'ds-param',
  paramName: 'ds-param-name',
  paramSlider: 'ds-param-slider',
  paramValue: 'ds-param-value',
  paramValueTex: 'ds-param-value--tex',
  paramReset: 'ds-param-reset',
  card: 'ds-card',
  cardInset: 'ds-card--inset',
  panelHeader: 'ds-panel-header',
  panelMeta: 'ds-panel-meta',
  panelTitle: 'ds-panel-title',
  panelSubtitle: 'ds-panel-subtitle',
  panelActions: 'ds-panel-actions',
  toolbar: 'ds-toolbar',
  tabs: 'ds-tabs',
  tab: 'ds-tab',
  badge: 'ds-badge',
  modal: 'ds-modal',
  modalHeading: 'ds-modal-heading',
  modalTitle: 'ds-modal-title',
  modalBody: 'ds-modal-body',
  modalActions: 'ds-modal-actions',
  drawer: 'ds-drawer',
  drawerScrim: 'ds-drawer-scrim',
  drawerHeading: 'ds-drawer-heading',
  drawerTitle: 'ds-drawer-title',
  drawerBody: 'ds-drawer-body',
  callout: 'ds-callout',
  calloutContent: 'ds-callout-content',
  calloutTitle: 'ds-callout-title',
  calloutActions: 'ds-callout-actions',
  empty: 'ds-empty',
  emptyTitle: 'ds-empty-title',
  emptyHint: 'ds-empty-hint',
  spinnerSm: 'ds-spinner--sm',
  progress: 'ds-progress',
  progressFill: 'ds-progress-fill',
  toast: 'ds-toast',
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