import assert from 'node:assert/strict';
import test from 'node:test';
import { buttonClasses, iconButtonClasses, ds } from '../src/components/ui/classes.ts';
import { formatParamValue } from '../src/components/ui/parameter-slider.ts';

test('button class composition covers variants, sizes, and extras', () => {
  assert.equal(buttonClasses(), 'ds-btn ds-btn--ghost ds-btn--md');
  assert.equal(buttonClasses('primary', 'sm'), 'ds-btn ds-btn--primary ds-btn--sm');
  assert.equal(buttonClasses('danger', 'xs', 'workbench-run'), 'ds-btn ds-btn--danger ds-btn--xs workbench-run');
  assert.equal(buttonClasses('success'), 'ds-btn ds-btn--success ds-btn--md');
  assert.equal(buttonClasses('secondary'), 'ds-btn ds-btn--secondary ds-btn--md');
});

test('button class composition falls back safely on unknown values', () => {
  assert.equal(buttonClasses(/** @type {any} */ ('bogus'), /** @type {any} */ ('huge')), 'ds-btn ds-btn--ghost ds-btn--md');
});

test('icon button class composition', () => {
  assert.equal(iconButtonClasses(), 'ds-icon-btn ds-icon-btn--md');
  assert.equal(iconButtonClasses('xs', 'tree-chevron'), 'ds-icon-btn ds-icon-btn--xs tree-chevron');
  assert.equal(iconButtonClasses(/** @type {any} */ ('nope')), 'ds-icon-btn ds-icon-btn--md');
});

test('ds class map is the single naming source', () => {
  assert.equal(ds.button, 'ds-btn');
  assert.equal(ds.switch, 'ds-switch');
  assert.equal(ds.segmented, 'ds-segmented');
  assert.ok(buttonClasses('primary').startsWith(ds.button));
});

test('parameter readout formatting trims float noise and trailing zeros', () => {
  assert.equal(formatParamValue(2), '2');
  assert.equal(formatParamValue(2.5), '2.5');
  assert.equal(formatParamValue(0.1 + 0.2), '0.3');
  assert.equal(formatParamValue(-1.25), '-1.25');
  assert.equal(formatParamValue(1 / 3), '0.333333');
  assert.equal(formatParamValue(1 / 3, 2), '0.33');
  assert.equal(formatParamValue(Number.NaN), 'NaN');
});