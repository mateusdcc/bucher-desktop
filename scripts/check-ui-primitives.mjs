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
  logLevel: 'silent',
});
await writeFile(resolve(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="./ui-primitives-entry.css">
<script src="./ui-primitives-entry.js" type="module"></script>
</head><body><div id="app"></div></body></html>`);

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