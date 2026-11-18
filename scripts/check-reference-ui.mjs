import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, ['build.mjs']);
const demo = 'demo/Buches';
const entries = await Promise.all((await readdir(demo, { recursive: true }))
  .filter(file => file.endsWith('.md'))
  .map(async file => ({ path: 'Buches/' + file, source: await readFile(resolve(demo, file), 'utf8') })));
const output = '.deinorganizer/e2e-staging/reference-reader';
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' });

const reader = page => page.locator('#reading-scroll');
const button = (host, name) => host.getByRole('button', { name, exact: true });
const scrollPosition = host => host.evaluate(node => node.scrollTop);

async function setup(seed = entries) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  await page.route('http://localhost/**', route => {
    const { pathname } = new URL(route.request().url());
    const file = resolve('dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    return existsSync(file) ? route.fulfill({ path: file }) : route.abort();
  });
  await page.addInitScript(entries => {
    window.__TAURI_INTERNALS__ = {
      async invoke(command) {
        if (command === 'load_library') return { basePath: '', entries };
        throw new Error('Unexpected IPC command ' + command);
      },
    };
  }, seed);
  await page.goto('http://localhost/');
  await page.getByRole('heading', { name: 'Proofs in Linear Algebra', level: 1 }).waitFor();
  return page;
}

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 90, animations: 'disabled' });
}

async function openPrerequisites(page) {
  const nav = page.getByRole('navigation', { name: 'Book navigation' });
  await button(nav, 'Expand Linear maps').click();
  await button(nav, 'Quotients').click();
  await reader(page).getByText('Prerequisites', { exact: true }).click();
  const link = button(reader(page), 'Linear map and kernel');
  await link.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  return link;
}

async function assertPassage(page, title) {
  const target = reader(page).getByRole('heading', { name: title, exact: true });
  const [box, viewport] = await Promise.all([target.boundingBox(), reader(page).boundingBox()]);
  assert.ok(box && viewport && box.y >= viewport.y && box.y < viewport.y + viewport.height);
}

async function checkLayout(page, layout, command) {
  const link = await openPrerequisites(page);
  await link.click();
  await assertPassage(page, 'Linear map and kernel');
  await shot(page, `${layout}-01-jumped`);
  await page.keyboard.press('Meta+p');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const query = palette.getByRole('combobox');
  await query.fill('jumped');
  assert.equal(await palette.getByRole('option').count(), 3);
  await query.fill(command);
  await shot(page, `${layout}-02-command`);
  const original = await reader(page).boundingBox();
  await query.press('Enter');
  const pane = page.getByRole('complementary', { name: 'Reference pane' });
  const destination = pane.getByRole('heading', { name: 'Linear map and kernel', exact: true });
  await destination.waitFor();
  await assertPassage(page, 'The first isomorphism theorem');
  assert.ok(await link.isVisible());
  assert.equal(await link.evaluate(node => node === document.activeElement), true);
  assert.equal(await button(page, 'Go back').count(), 0);
  const [main, side, anchor, paneScroll] = await Promise.all([
    reader(page).boundingBox(), pane.boundingBox(), destination.boundingBox(), pane.locator('.reference-scroll').boundingBox(),
  ]);
  assert.ok(anchor.y >= paneScroll.y && anchor.y < paneScroll.y + paneScroll.height);
  if (layout === 'vertical') assert.ok(main.x + main.width <= side.x + 1 && main.y === side.y);
  if (layout === 'horizontal') assert.ok(main.y + main.height <= side.y + 1 && main.x === side.x);
  if (layout === 'floating') {
    assert.ok(side.y > main.y && side.x > main.x && side.y + side.height < main.y + main.height);
    assert.equal(main.width, original.width);
  }
  await shot(page, `${layout}-03-detached`);
  await button(pane, 'Close reference pane').click();
  await pane.waitFor({ state: 'hidden' });
  await assertPassage(page, 'The first isomorphism theorem');
  await shot(page, `${layout}-04-closed`);
}

const scenarios = {
  async jumps(page) {
    const link = await openPrerequisites(page);
    const position = await scrollPosition(reader(page));
    await shot(page, 'jumps-01-exercise');
    await link.click();
    await page.getByText('1 jump', { exact: true }).waitFor();
    await assertPassage(page, 'Linear map and kernel');
    const border = page.locator('.reading-layout');
    const firstColor = await border.evaluate(node => getComputedStyle(node, '::after').boxShadow);
    assert.match(firstColor, / -8px 0px 0px 0px inset$/);
    await shot(page, 'jumps-02-kernel');
    await button(page.locator('.outline'), 'Subspace test').click();
    await page.getByText('2 jumps', { exact: true }).waitFor();
    await assertPassage(page, 'Subspace test');
    const colors = await border.evaluate(node => getComputedStyle(node, '::after').boxShadow);
    assert.ok(colors.startsWith(firstColor + ', '));
    assert.match(colors, / -16px 0px 0px 0px inset$/);
    assert.equal(colors.match(/inset/g).length, 2);
    await shot(page, 'jumps-03-subspace');
    await button(page, 'Go back').click();
    await assertPassage(page, 'Linear map and kernel');
    assert.equal(await border.evaluate(node => getComputedStyle(node, '::after').boxShadow), firstColor);
    await shot(page, 'jumps-04-kernel-return');
    await button(page, 'Go back').click();
    await link.waitFor();
    assert.ok(await link.evaluate(node => node === document.activeElement));
    assert.equal(await scrollPosition(reader(page)), position);
    assert.equal(await border.evaluate(node => getComputedStyle(node, '::after').boxShadow), 'none');
    await shot(page, 'jumps-05-exercise-return');
  },
  async samePage(page) {
    await openPrerequisites(page);
    const link = button(reader(page), 'Quotient space');
    await link.scrollIntoViewIfNeeded();
    const position = await scrollPosition(reader(page));
    await link.click();
    await page.getByText('1 jump', { exact: true }).waitFor();
    await assertPassage(page, 'Quotient space');
    await button(page, 'Go back').click();
    await link.waitFor();
    assert.equal(await scrollPosition(reader(page)), position);
  },
  async palette(page) {
    await shot(page, 'palette-01-library');
    await page.keyboard.press('Meta+p');
    const modal = page.getByRole('dialog', { name: 'Command palette' });
    const query = modal.getByRole('combobox', { name: 'Search commands' });
    await query.waitFor();
    assert.ok(await query.evaluate(node => node === document.activeElement));
    await shot(page, 'palette-02-open');
    await query.fill('open');
    await query.press('ArrowDown');
    const selected = modal.getByRole('option', { selected: true });
    assert.equal(await selected.textContent(), 'Open exercises');
    await shot(page, 'palette-03-filter');
    await query.press('Enter');
    await reader(page).getByRole('heading', { name: 'Exercises' }).waitFor();
    await modal.waitFor({ state: 'hidden' });
    await shot(page, 'palette-04-exercises');
    await page.keyboard.press('Control+p');
    await query.fill('no-such-command');
    await modal.getByRole('status').getByText('No matching commands.').waitFor();
    await query.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await button(page, 'Command palette').click();
    await modal.getByRole('option', { name: 'Search library' }).click();
    await page.getByRole('dialog', { name: 'Search library' }).waitFor();
  },
  async linkedNotes(page) {
    await openPrerequisites(page);
    const link = reader(page).getByRole('link', { name: 'Reference note' });
    await link.click();
    await page.getByText('1 jump', { exact: true }).waitFor();
    const anchor = reader(page).locator('[id="^individual-note"]');
    assert.ok((await anchor.boundingBox()).y >= (await reader(page).boundingBox()).y);
    await reader(page).getByRole('link', { name: 'Return to the kernel' }).click();
    await page.getByText('2 jumps', { exact: true }).waitFor();
    await assertPassage(page, 'Linear map and kernel');
    await page.keyboard.press('Meta+p');
    const query = page.getByRole('combobox', { name: 'Search commands' });
    await query.fill('split vertically');
    await query.press('Enter');
    const pane = page.getByRole('complementary', { name: 'Reference pane' });
    await pane.getByRole('heading', { name: 'Linear map and kernel' }).waitFor();
    await link.waitFor({ state: 'hidden' });
    await page.getByText('1 jump', { exact: true }).waitFor();
    await reader(page).getByRole('heading', { name: 'Reference note' }).waitFor();
    await button(page, 'Go back').click();
    await link.waitFor();
    assert.ok(await pane.isVisible());
  },
  vertical: page => checkLayout(page, 'vertical', 'split vertically'),
  horizontal: page => checkLayout(page, 'horizontal', 'split horizontally'),
  floating: page => checkLayout(page, 'floating', 'float jumped'),
};

try {
  await mkdir(output, { recursive: true });
  const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios);
  for (const name of names) {
    assert.ok(Object.hasOwn(scenarios, name), `Unknown UI test ${name}`);
    const notePath = 'Buches/Proofs in Linear Algebra/Reference note.md';
    const noteFixture = [...entries.map(entry => entry.path.endsWith('/Quotients.md') ? {
      ...entry, source: entry.source.replace('^quotient\n', '^quotient\n\n[Reference note](../../Reference%20note.md#^individual-note)\n'),
    } : entry), {
      path: notePath,
      source: '# Reference note\n\nA standalone Markdown note.\n\n^individual-note\n\n[[Linear maps#^kernel|Return to the kernel]]',
    }];
    const page = await setup(name === 'linkedNotes' ? noteFixture : entries);
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    try {
      await scenarios[name](page);
      assert.deepEqual(errors, []);
      console.log(`Passed ${name}`);
    } finally {
      await page.context().close();
    }
  }
} finally {
  await browser.close();
}
