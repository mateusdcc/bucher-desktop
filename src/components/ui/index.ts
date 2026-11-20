/**
 * Bücher Design System — barrel export.
 * Vanilla DOM primitives for the app shell and extensions; React islands
 * consume the same factories through `./react.tsx` wrappers and the `ds`
 * class map. All styling lives in the design-system CSS files.
 *
 * @module components/ui
 */
export { el, icon, setErrorHandler, reportError } from './dom.ts';
export { ds, buttonClasses, iconButtonClasses } from './classes.ts';
export type { ButtonVariant, ButtonSize, BadgeVariant, CalloutTone } from './classes.ts';
export { Button, IconButton, setButtonLoading } from './buttons.ts';
export type { ButtonProps, IconButtonProps } from './buttons.ts';
export { ToggleSwitch, SegmentedControl } from './toggle.ts';
export type { ToggleSwitchProps, ToggleSwitchHandle, SegmentedControlProps, SegmentedControlHandle, SegmentedOption } from './toggle.ts';
export { Input, Textarea, Select } from './inputs.ts';
export type { InputProps, InputHandle, TextareaProps, TextareaHandle, SelectProps, SelectHandle, SelectOption } from './inputs.ts';
export { ParameterSlider, formatParamValue } from './parameter-slider.ts';
export type { ParameterSliderProps, ParameterSliderHandle } from './parameter-slider.ts';