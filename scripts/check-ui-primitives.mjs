/**
 * End-to-end checks for the design-system primitives. Builds a test-only
 * entry that mounts every primitive, serves it into Chromium, and drives
 * the real DOM: variants, async lifecycle, error reporting, loading state,
 * pressed states, switch semantics, segmented selection, and form submit.
 *
 * Run: node scripts/check-ui-primitives.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const out = '.deinorganizer/e2e-staging/ui-primitives';
await mkdir(out, { recursive: true });
await build({
  entryPoints: ['scripts/ui-primitives-entry.ts'],
  bundle: true,
  format: 'esm',
  outdir: out,
  jsx: 'automatic',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file', '.css': 'css' },
  logLevel: 'silent',
});
await writeFile(resolve(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="./ui-primitives-entry.css">
<script src="./ui-primitives-entry.js" type="module"></script>
</head><body><div id="app"></div><div id="notice" role="status"></div></body></html>`);

const browser = await chromium.launch({
  ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }),
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await page.route('http://localhost/**', route => {
  const { pathname } = new URL(route.request().url());
  const file = resolve(out, pathname === '/' ? 'index.html' : pathname.slice(1));
  return existsSync(file) ? route.fulfill({ path: file }) : route.abort();
});
await page.goto('http://localhost/');
await page.locator('#variants .ds-btn').first().waitFor();

// 1 — variants and sizes render with canonical classes
for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'success']) {
  assert.equal(await page.locator(`#variants .ds-btn--${variant}`).count(), 1, `variant ${variant}`);
}
for (const size of ['xs', 'sm', 'md']) {
  assert.equal(await page.locator(`#sizes .ds-btn--${size}`).count(), 1, `size ${size}`);
}
assert.equal(await page.locator('#variants .ds-btn svg').count(), 5, 'left icons render');
assert.equal(await page.locator('#sizes .ds-btn svg').count(), 3, 'right icons render');

// 2 — async action: pending disable + spinner, then recovery
const asyncBtn = page.getByTestId('async-btn');
await asyncBtn.click();
assert.equal(await asyncBtn.isDisabled(), true, 'async pending disables');
assert.equal(await asyncBtn.getAttribute('data-loading'), 'true');
assert.equal(await asyncBtn.locator('.ds-spinner').count(), 1, 'spinner while pending');
await page.evaluate(() => window.__resolveAsync());
await page.waitForFunction(() => !document.querySelector('[data-testid="async-btn"]').disabled);
assert.equal(await asyncBtn.locator('.ds-spinner').count(), 0, 'spinner removed after resolve');

// 3 — async errors reach the global handler and re-enable the button
await page.getByTestId('error-btn').click();
await page.waitForFunction(() => window.__errors.length === 1);
assert.match(await page.evaluate(() => String(window.__errors[0])), /boom/);
assert.equal(await page.getByTestId('error-btn').isDisabled(), false);

// 4 — loading prop and imperative setter
const loadingBtn = page.getByTestId('loading-btn');
assert.equal(await loadingBtn.isDisabled(), true);
assert.equal(await loadingBtn.locator('.ds-spinner').count(), 1);
await page.evaluate(() => window.__setLoading(false));
assert.equal(await loadingBtn.isDisabled(), false);
assert.equal(await loadingBtn.locator('.ds-spinner').count(), 0);
await page.evaluate(() => window.__setLoading(true));
assert.equal(await loadingBtn.isDisabled(), true);

// 5 — icon button pressed state + accessible name
const iconToggle = page.getByTestId('icon-toggle');
assert.equal(await iconToggle.getAttribute('aria-label'), 'Cloze quiz');
assert.equal(await iconToggle.getAttribute('aria-pressed'), 'false');
await iconToggle.click();
assert.equal(await iconToggle.getAttribute('aria-pressed'), 'true');
await iconToggle.click();
assert.equal(await iconToggle.getAttribute('aria-pressed'), 'false');

// 6 — switch semantics (click + keyboard)
const sw = page.getByTestId('demo-switch');
assert.equal(await sw.getAttribute('role'), 'switch');
assert.equal(await sw.getAttribute('aria-checked'), 'false');
await sw.click();
assert.equal(await sw.getAttribute('aria-checked'), 'true');
assert.equal(await page.evaluate(() => window.__switchValue), true);
await sw.press('Space');
assert.equal(await sw.getAttribute('aria-checked'), 'false');
assert.equal(await page.evaluate(() => window.__switchValue), false);

// 7 — segmented control selection + imperative setValue
const seg = page.getByTestId('demo-segmented');
const codeItem = seg.getByRole('button', { name: 'Code' });
const outputItem = seg.getByRole('button', { name: 'Output' });
const previewItem = seg.getByRole('button', { name: 'Preview' });
assert.equal(await codeItem.getAttribute('aria-pressed'), 'true');
await outputItem.click();
assert.equal(await page.evaluate(() => window.__segValue), 'output');
assert.equal(await outputItem.getAttribute('aria-pressed'), 'true');
assert.equal(await codeItem.getAttribute('aria-pressed'), 'false');
await page.evaluate(() => window.__segSet('preview'));
assert.equal(await previewItem.getAttribute('aria-pressed'), 'true');
assert.equal(await outputItem.getAttribute('aria-pressed'), 'false');
assert.equal(await seg.locator('svg').count(), 3, 'segment icons render');

// 8 — submit button drives its form
await page.getByTestId('submit-btn').click();
assert.equal(await page.evaluate(() => window.__submits), 1);

// 8b — input: label association, typing, onInput
const demoInput = page.getByTestId('demo-input');
await page.locator('#input .ds-field-label').click();
assert.equal(await demoInput.evaluate(node => document.activeElement === node), true, 'label focuses input');
await demoInput.fill('Linear Algebra');
assert.equal(await page.evaluate(() => window.__inputValue), 'Linear Algebra');

// 8c — auto-grow textarea grows with content; source textarea is monospace
const demoTextarea = page.getByTestId('demo-textarea');
const shortHeight = await demoTextarea.evaluate(node => node.getBoundingClientRect().height);
await demoTextarea.fill('A very long question that wraps across several lines because the field auto-grows with its content instead of scrolling. '.repeat(3));
const tallHeight = await demoTextarea.evaluate(node => node.getBoundingClientRect().height);
assert.ok(tallHeight > shortHeight, 'auto-grow textarea grows');
assert.equal(await page.evaluate(() => window.__textareaValue.includes('auto-grows')), true);
const sourceFont = await page.locator('#textarea .ds-textarea').nth(1).evaluate(node => getComputedStyle(node).fontFamily);
assert.match(sourceFont, /mono/i, 'source textarea uses the mono stack');

// 8d — select change + typed value
await page.getByTestId('demo-select').selectOption('chatgpt');
assert.equal(await page.evaluate(() => window.__selectValue), 'chatgpt');

// 8e — parameter slider: keyboard stepping, readout, reset, imperative API
const paramH = page.getByTestId('param-h');
const hSlider = paramH.locator('.ds-param-slider');
const hReadout = paramH.locator('.ds-param-value');
const hReset = paramH.locator('.ds-param-reset');
assert.equal(await hReadout.textContent(), '0');
assert.equal(await hReset.isDisabled(), true, 'reset disabled at default');
await hSlider.focus();
await hSlider.press('ArrowRight');
await hSlider.press('ArrowRight');
assert.equal(await page.evaluate(() => window.__paramValue), 0.2);
assert.equal(await hReadout.textContent(), '0.2');
assert.equal(await hReset.isDisabled(), false, 'reset enabled away from default');
await hReset.click();
assert.equal(await page.evaluate(() => window.__paramValue), 0);
assert.equal(await hReadout.textContent(), '0');
await page.evaluate(() => window.__paramSet(2.5));
assert.equal(await hReadout.textContent(), '2.5');
assert.equal(await hSlider.inputValue(), '2.5');
await page.evaluate(() => window.__paramDisable(true));
assert.equal(await hSlider.isDisabled(), true);
await page.evaluate(() => window.__paramDisable(false));
assert.equal(await hSlider.isDisabled(), false);

// 8f — live TeX readout renders KaTeX and updates with the value
const paramA = page.getByTestId('param-a');
assert.equal(await paramA.locator('.ds-param-value .katex').count(), 1, 'KaTeX readout renders');
assert.match(await paramA.locator('.ds-param-value').textContent(), /a=1\.00/);
await paramA.locator('.ds-param-slider').focus();
await paramA.locator('.ds-param-slider').press('ArrowRight');
assert.match(await paramA.locator('.ds-param-value').textContent(), /a=1\.05/);
assert.equal(await page.getByTestId('param-h').locator('.ds-param-slider').isDisabled(), false);
const lockedSlider = page.locator('#params .ds-param').nth(2).locator('.ds-param-slider');
assert.equal(await lockedSlider.isDisabled(), true, 'disabled slider');
assert.equal(await lockedSlider.getAttribute('aria-label'), 'Locked parameter');

// 8g — card, panel header, collapse chevron
const demoCard = page.getByTestId('demo-card');
assert.equal(await demoCard.locator('.ds-panel-header .ds-badge--success').textContent(), 'warm');
assert.equal(await demoCard.locator('.ds-panel-subtitle').textContent(), 'v1.0.0 · visualization');
const chevron = demoCard.locator('.ds-panel-header .ds-icon-btn').first();
assert.equal(await chevron.getAttribute('aria-expanded'), 'true');
await chevron.click();
assert.equal(await chevron.getAttribute('aria-expanded'), 'false');
assert.equal(await page.evaluate(() => window.__collapsed), true);
await chevron.click();
assert.equal(await page.evaluate(() => window.__collapsed), false);

// 8h — badges: all six variants present
for (const variant of ['neutral', 'info', 'success', 'warning', 'danger', 'accent']) {
  assert.equal(await page.locator(`#badges .ds-badge--${variant}`).count(), 1, `badge ${variant}`);
}

// 8i — tabs: click + arrow-key navigation + aria semantics
const demoTabs = page.getByTestId('demo-tabs');
assert.equal(await demoTabs.getAttribute('role'), 'tablist');
const solutionTab = demoTabs.getByRole('tab', { name: 'Solution', exact: true });
const aiTab = demoTabs.getByRole('tab', { name: 'AI solution' });
assert.equal(await solutionTab.getAttribute('aria-selected'), 'true');
assert.equal(await solutionTab.evaluate(node => node.tabIndex), 0);
assert.equal(await aiTab.evaluate(node => node.tabIndex), -1);
await aiTab.click();
assert.equal(await page.evaluate(() => window.__tabValue), 'ai');
assert.equal(await aiTab.getAttribute('aria-selected'), 'true');
await aiTab.press('ArrowRight');
assert.equal(await page.evaluate(() => window.__tabValue), 'compare');
await demoTabs.getByRole('tab', { name: 'Compare' }).press('Home');
assert.equal(await page.evaluate(() => window.__tabValue), 'solution');

// 8j — callouts: tones, roles, actions
assert.equal(await page.locator('#callouts .ds-callout').count(), 5);
assert.equal(await page.getByTestId('callout-success').getAttribute('role'), 'status');
assert.equal(await page.locator('#callouts .ds-callout--danger').getAttribute('role'), 'alert');
assert.equal(await page.locator('#callouts .ds-callout--danger .ds-btn').count(), 1, 'callout action slot');

// 8k — empty state, progress bar, spinner
assert.equal(await page.locator('#misc .ds-empty-title').textContent(), 'No exercises yet');
const demoProgress = page.getByTestId('demo-progress');
assert.equal(await demoProgress.getAttribute('role'), 'progressbar');
assert.equal(await demoProgress.getAttribute('aria-valuenow'), '38');
assert.equal(await page.locator('#misc .ds-spinner[role="status"]').count(), 1);

// 8l — modal: open, focus trap, Esc, close callback
await page.getByTestId('open-modal').click();
const demoModal = page.getByTestId('demo-modal');
await demoModal.waitFor();
assert.equal(await demoModal.evaluate(node => node.open), true);
assert.equal(await demoModal.locator('.ds-modal-title').textContent(), 'New book');
assert.equal(await demoModal.locator('.ds-modal-actions .ds-btn').count(), 2);
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('[data-testid="demo-modal"]'));
assert.equal(await page.evaluate(() => window.__modalClosed), 1);

// 8m — drawer: open, scrim click closes, callback
await page.getByTestId('open-drawer').click();
const demoDrawer = page.getByTestId('demo-drawer');
await demoDrawer.waitFor();
assert.equal(await demoDrawer.getAttribute('role'), 'dialog');
await page.locator('.ds-drawer-scrim').click({ position: { x: 10, y: 10 } });
await page.waitForFunction(() => !document.querySelector('[data-testid="demo-drawer"]'));
assert.equal(await page.evaluate(() => window.__drawerClosed), 1);

// 8n — toast renders into #notice with semantic tone
await page.getByTestId('show-toast').click();
assert.equal(await page.locator('#notice').textContent(), 'Patch applied.');
assert.equal(await page.locator('#notice').evaluate(node => node.classList.contains('ds-toast--success')), true);

// 9 — token-driven theming: light parity flips surfaces.
// Controls animate background/color over 120ms; let transitions settle.
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.waitForTimeout(300);
const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
assert.notEqual(darkBg, lightBg, 'light theme changes surfaces');
assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
const lightPrimary = await page.evaluate(() => getComputedStyle(document.querySelector('#variants .ds-btn--primary')).backgroundColor);
assert.equal(lightPrimary, 'rgb(227, 244, 233)', 'primary surface uses the light token');
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(300);

assert.deepEqual(pageErrors, [], 'no page errors');
await page.screenshot({ path: resolve(out, 'primitives-dark.jpg'), type: 'jpeg', quality: 80 });
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(out, 'primitives-light.jpg'), type: 'jpeg', quality: 80 });

await browser.close();
console.log('Passed uiPrimitives');