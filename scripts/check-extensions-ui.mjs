/**
 * End-to-end checks for the extension system. Builds the app, serves dist/
 * into Chromium with a mocked Tauri IPC layer (same pattern as
 * check-ai-ui.mjs), and exercises every built-in extension end to end:
 * rendering, interaction, persistence across reload, manager toggles, and
 * AI skill injection.
 *
 * Run: node scripts/check-extensions-ui.mjs [scenario …]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, ['build.mjs']);
const output = '.deinorganizer/e2e-staging/extensions';

const labIndex = '---\ntitle: Extension Lab\ndescription: Fixture book for extension checks.\n---\n\n# Extension Lab\n\nInteractive blocks under test.';
const diagramsChapter = `---
name: Diagrams
order: 1
---

# Diagrams

A flowchart with a stable id:

\`\`\`ext-mermaid
id: flow-1
title: Decision flow
diagram: |
  flowchart TD
    A["Start"] --> B{"ok?"}
    B -- yes --> C["Done"]
    B -- no --> A
\`\`\`

A malformed block must render a validation card, never crash:

\`\`\`ext-mermaid
id: broken-1
caption: missing diagram field
\`\`\`
`;

const plotsChapter = `---
name: Plots
order: 2
---

# Plots

A quadratic family with live sliders:

\`\`\`ext-math-plot
id: quadratic-1
title: Quadratic family
xRange: [-6, 6]
functions:
  - expr: a*x^2 + b*x + c
    label: f(x)
params:
  - name: a
    min: -3
    max: 3
    step: 0.1
    value: 1
  - name: b
    min: -5
    max: 5
    step: 0.1
    value: 0
  - name: c
    min: -5
    max: 5
    step: 0.1
    value: 0
\`\`\`

An expression referencing an undeclared symbol must fail gracefully:

\`\`\`ext-math-plot
id: bad-plot
functions:
  - expr: mystery*x
\`\`\`
`;

const steppersChapter = `---
name: Steppers
order: 3
---

# Steppers

An algorithm trace:

\`\`\`ext-state-stepper
id: sort-trace
title: Bubble sort pass
steps:
  - title: Start
    explanation: Compare the first pair.
    arrays:
      - name: a
        values: [5, 2, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 0 }
  - title: Swap
    explanation: 5 > 2, swap them.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 1 }
  - title: Advance
    explanation: Move the window right.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [1, 2]
        pointers: { i: 1, j: 2 }
    variables: { swaps: 1 }
  - title: Done
    explanation: The pass ends with 8 at the right edge.
    arrays:
      - name: a
        values: [2, 5, 1, 8]
        highlight: [2, 3]
        pointers: { i: 2, j: 3 }
    variables: { swaps: 2 }
\`\`\`

A state machine:

\`\`\`ext-state-stepper
id: states-1
title: Connection states
steps:
  - title: Closed
    nodes:
      - { id: closed, label: CLOSED, active: true }
      - { id: listen, label: LISTEN }
    edges:
      - { from: closed, to: listen, label: open }
  - title: Listening
    nodes:
      - { id: closed, label: CLOSED }
      - { id: listen, label: LISTEN, active: true }
    edges:
      - { from: closed, to: listen, label: open, active: true }
\`\`\`
`;

const codeLabChapter = `---
name: Code Lab
order: 4
---

# Code Lab

Implement binary search:

\`\`\`ext-code-lab
id: lab-binary
title: Binary search
description: |
  Return the index of \`target\` in the sorted array, or \`-1\`.
starter: |
  function binarySearch(a, target) {
    // your code here
  }
tests:
  - name: finds the middle
    fn: binarySearch
    args: [[1, 3, 5, 7, 9], 5]
    expected: 2
  - name: missing value
    fn: binarySearch
    args: [[1, 3, 5], 4]
    expected: -1
  - name: empty array
    fn: binarySearch
    args: [[], 1]
    expected: -1
  - name: single element hit
    fn: binarySearch
    args: [[42], 42]
    expected: 0
    hidden: true
\`\`\`

An infinite loop must be killed by the timeout:

\`\`\`ext-code-lab
id: lab-loop
title: Runaway loop
timeoutMs: 1000
starter: |
  function spin() {
    while (true) {}
  }
tests:
  - name: terminates
    fn: spin
    args: []
    expected: null
\`\`\`
`;

const fixtureEntries = [
  { path: 'Buches/Extension Lab/_index.md', source: labIndex },
  { path: 'Buches/Extension Lab/concepts/Diagrams.md', source: diagramsChapter },
  { path: 'Buches/Extension Lab/concepts/Plots.md', source: plotsChapter },
  { path: 'Buches/Extension Lab/concepts/Steppers.md', source: steppersChapter },
  { path: 'Buches/Extension Lab/concepts/Code Lab.md', source: codeLabChapter },
];

const browser = await chromium.launch(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' });

async function setup(entries = fixtureEntries) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  await page.route('http://localhost/**', route => {
    const { pathname } = new URL(route.request().url());
    const file = resolve('dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    return existsSync(file) ? route.fulfill({ path: file }) : route.abort();
  });
  await page.addInitScript(seed => {
    const read = () => JSON.parse(localStorage.getItem('fixture-library') ?? JSON.stringify(seed));
    const write = entries => localStorage.setItem('fixture-library', JSON.stringify(entries));
    window.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        const entries = read();
        if (command === 'load_library') return { basePath: '/fixture', entries };
        if (command === 'save_markdown') {
          const current = entries.find(entry => entry.path === args.path);
          if ((current?.source ?? null) !== args.expected) throw new Error('The file changed on disk.');
          if (current) current.source = args.text;
          else entries.push({ path: args.path, source: args.text });
          write(entries);
          return;
        }
        if (command === 'discard_solution') {
          write(entries.filter(entry => !(entry.path === args.path && entry.source === args.expected)));
          return;
        }
        if (command === 'ai_ollama_status') return { installed: true, connected: true, models: ['fixture:latest'] };
        if (command === 'chatgpt_status') return { state: 'signed-out' };
        if (command === 'ai_prepare_import' || command === 'ai_propose_patch' || command === 'ai_explain'
          || command === 'ai_generate_solution' || command === 'ai_review_solution') {
          window.fixtureSkillRequests = window.fixtureSkillRequests ?? [];
          window.fixtureSkillRequests.push({ command, skills: args.skills ?? null });
          throw new Error('Fixture does not generate.');
        }
        throw new Error('Unexpected IPC command ' + command);
      },
    };
  }, entries);
  await page.goto('http://localhost/');
  await page.getByRole('heading', { name: 'Extension Lab', level: 1 }).waitFor();
  return page;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
async function openChapter(page, name) {
  await page.locator('.tree-link', { hasText: name }).first().click();
  await page.locator('article h1.page-title', { hasText: name }).waitFor();
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 90, animations: 'disabled' });
}
async function openExtensionsManager(page) {
  await button(page, 'Settings').click();
  await button(page, 'Extensions').click();
  await page.locator('.extension-manager-card').first().waitFor();
}
const storedProgress = page => page.evaluate(() => {
  const entries = JSON.parse(localStorage.getItem('fixture-library'));
  return entries.find(entry => entry.path.endsWith('_progress.md'))?.source ?? '';
});

const scenarios = {
  async mermaid(page) {
    await openChapter(page, 'Diagrams');
    const frame = page.locator('.extension-frame[data-extension="ext-mermaid"][data-block-key="id:flow-1"]');
    await frame.locator('.mermaid-stage svg').waitFor({ timeout: 20000 });
    assert.match(await frame.locator('.mermaid-zoom-label').textContent(), /^\d+%$/);
    assert.ok(await frame.locator('.mermaid-stage svg').innerHTML().then(html => html.includes('Start')));
    await shot(page, 'mermaid-01-rendered');

    // Validation fallback for the malformed block.
    const fallback = page.locator('.extension-fallback', { hasText: 'invalid block data' });
    await fallback.waitFor();
    assert.ok(await fallback.textContent().then(text => text.includes('diagram')));

    // Zoom controls + persistence across reload.
    await button(page, 'Reset view').click();
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '100%');
    await button(page, 'Zoom in').click();
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '125%');
    await page.waitForTimeout(650);
    assert.match(await storedProgress(page), /id:flow-1/);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Diagrams' }).waitFor();
    await frame.locator('.mermaid-stage svg').waitFor({ timeout: 20000 });
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '125%');
    await button(page, 'Reset view').click();
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '100%');

    // Pan with the pointer.
    const box = await frame.locator('.mermaid-viewport').boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    const transform = await frame.locator('.mermaid-stage').evaluate(node => node.style.transform);
    assert.match(transform, /translate\(60px, 20px\)/);
    await shot(page, 'mermaid-02-panned');

    // Collapse / expand and source inspection.
    await frame.locator('.extension-collapse').click();
    assert.equal(await frame.locator('.extension-frame-body').isHidden(), true);
    await frame.locator('.extension-collapse').click();
    await frame.getByRole('button', { name: 'View source and data' }).click();
    await page.getByRole('dialog', { name: 'Extension source' }).waitFor();
    assert.ok(await page.getByRole('dialog').textContent().then(text => text.includes('flowchart TD')));
    await page.keyboard.press('Escape');

    // Manager toggle removes rendering and skill injection; re-enable restores.
    await openExtensionsManager(page);
    const toggle = page.getByRole('switch', { name: 'Disable Mermaid Diagram' });
    await toggle.click();
    await page.getByRole('switch', { name: 'Enable Mermaid Diagram' }).waitFor();
    await page.locator('.extension-manager-card', { hasText: 'Mermaid Diagram' }).getByRole('button', { name: 'View AI skill' }).click();
    await page.getByRole('dialog', { name: 'AI skill · Mermaid Diagram' }).waitFor();
    assert.ok(await page.getByRole('dialog').textContent().then(text => text.includes('sequenceDiagram')));
    await page.keyboard.press('Escape');
    await button(page, 'View composed AI prompt').click();
    const composed = await page.getByRole('dialog').textContent();
    assert.ok(!composed.includes('ext-mermaid'), 'disabled extension must leave the composed prompt');
    assert.ok(composed.includes('ext-math-plot'), 'enabled extensions stay in the composed prompt');
    await page.keyboard.press('Escape');
    await button(page, 'Back to reader').click();
    await page.locator('.extension-disabled-card', { hasText: 'Mermaid Diagram' }).first().waitFor();
    assert.equal(await page.locator('.extension-frame[data-extension="ext-mermaid"] .mermaid-stage svg').count(), 0);
    await shot(page, 'mermaid-03-disabled');
    await page.locator('.extension-disabled-card').first().getByRole('button', { name: 'Enable extension' }).click();
    await frame.locator('.mermaid-stage svg').waitFor({ timeout: 20000 });
    await shot(page, 'mermaid-04-reenabled');
  },
  async mathPlot(page) {
    await openChapter(page, 'Plots');
    const frame = page.locator('.extension-frame[data-extension="ext-math-plot"][data-block-key="id:quadratic-1"]');
    await frame.locator('canvas').waitFor();
    await page.waitForTimeout(300);
    const before = await frame.locator('canvas').evaluate(node => node.toDataURL());
    assert.ok(before.length > 5000, 'canvas should contain a rendered plot');
    await shot(page, 'plot-01-default');

    // Move slider a and confirm the curve redraws and the value label updates.
    const slider = frame.getByLabel('Parameter a');
    await slider.evaluate(node => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(node, '2.5');
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await frame.locator('.plot-param-value').first().textContent(), '2.5');
    const after = await frame.locator('canvas').evaluate(node => node.toDataURL());
    assert.notEqual(before, after);
    await shot(page, 'plot-02-slider');

    // Persistence across reload.
    await page.waitForTimeout(650);
    assert.match(await storedProgress(page), /quadratic-1/);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Plots' }).waitFor();
    await frame.locator('canvas').waitFor();
    assert.equal(await frame.getByLabel('Parameter a').inputValue(), '2.5');

    // Hover readout.
    const box = await frame.locator('canvas').boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await frame.locator('.plot-readout').waitFor();
    assert.match(await frame.locator('.plot-readout').textContent(), /x = /);

    // Undeclared symbol → error fallback card, not a crash.
    await page.locator('.extension-fallback', { hasText: 'could not render' }).waitFor();
    assert.ok(await page.locator('.extension-fallback', { hasText: 'could not render' }).textContent()
      .then(text => text.includes('mystery')));
    await shot(page, 'plot-03-error-fallback');
  },
  async stateStepper(page) {
    await openChapter(page, 'Steppers');
    const frame = page.locator('.extension-frame[data-extension="ext-state-stepper"][data-block-key="id:sort-trace"]');
    await frame.locator('.stepper-cell').first().waitFor();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 1 / 4');
    assert.equal(await frame.locator('.stepper-cell').first().textContent(), '5');
    assert.equal(await frame.locator('.stepper-cell.highlighted').count(), 2);
    assert.equal(await frame.locator('.stepper-pointer').count(), 2);
    await shot(page, 'stepper-01-step1');

    // Next advances the snapshot.
    await frame.getByRole('button', { name: 'Next step' }).click();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 2 / 4');
    assert.equal(await frame.locator('.stepper-cell').first().textContent(), '2');
    assert.match(await frame.locator('.stepper-variable').textContent(), /1/);

    // Position persists across reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Steppers' }).waitFor();
    await frame.locator('.stepper-cell').first().waitFor();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 2 / 4');

    // Prev and bounds.
    await frame.getByRole('button', { name: 'Previous step' }).click();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 1 / 4');
    assert.equal(await frame.getByRole('button', { name: 'Previous step' }).isDisabled(), true);
    for (let i = 0; i < 3; i += 1) await frame.getByRole('button', { name: 'Next step' }).click();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 4 / 4');
    assert.equal(await frame.getByRole('button', { name: 'Next step' }).isDisabled(), true);

    // Auto-play restarts from the end and advances; pause stops it.
    await frame.getByLabel('Auto-play speed').selectOption('3');
    await frame.getByRole('button', { name: 'Auto-play' }).click();
    await frame.getByRole('button', { name: 'Pause' }).waitFor();
    await page.waitForTimeout(550);
    const played = await frame.locator('.stepper-counter').textContent();
    assert.notEqual(played, 'Step 1 / 4');
    await frame.getByRole('button', { name: 'Pause' }).click();
    const paused = await frame.locator('.stepper-counter').textContent();
    await page.waitForTimeout(450);
    assert.equal(await frame.locator('.stepper-counter').textContent(), paused);
    await shot(page, 'stepper-02-autoplay');

    // State machine block renders nodes and transitions.
    const graph = page.locator('.extension-frame[data-block-key="id:states-1"]');
    await graph.locator('.stepper-node').first().waitFor();
    assert.equal(await graph.locator('.stepper-node.active').count(), 1);
    assert.equal(await graph.locator('.stepper-node-label.active').textContent(), 'CLOSED');
    await graph.getByRole('button', { name: 'Next step' }).click();
    assert.equal(await graph.locator('.stepper-node-label.active').textContent(), 'LISTEN');
    await shot(page, 'stepper-03-graph');
  },
  async codeLab(page) {
    await openChapter(page, 'Code Lab');
    const frame = page.locator('.extension-frame[data-extension="ext-code-lab"][data-block-key="id:lab-binary"]');
    await frame.locator('.cm-content').waitFor();
    assert.match(await frame.locator('.cm-content').textContent(), /function binarySearch/);
    assert.equal(await frame.locator('.extension-badge').textContent(), 'Unsolved');
    await shot(page, 'codelab-01-starter');

    // Running the empty starter fails the tests and marks progress.
    await frame.getByRole('button', { name: 'Run tests' }).click();
    await frame.locator('.codelab-test').first().waitFor();
    assert.equal(await frame.locator('.codelab-summary').textContent(), '0 / 4 tests passed');
    assert.equal(await frame.locator('.extension-badge').textContent(), 'In Progress');
    const hiddenRow = frame.locator('.codelab-test', { hasText: 'Hidden test 1' });
    assert.equal(await hiddenRow.count(), 1);
    assert.ok(!(await hiddenRow.textContent()).includes('single element'));
    await shot(page, 'codelab-02-failing');

    // Write a correct solution and run again.
    const solution = 'function binarySearch(a, target) {\n  let lo = 0, hi = a.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (a[mid] === target) return mid;\n    if (a[mid] < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}';
    await frame.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(solution);
    await frame.getByRole('button', { name: 'Run tests' }).click();
    await frame.locator('.codelab-test.pass').first().waitFor();
    assert.equal(await frame.locator('.codelab-summary').textContent(), '4 / 4 tests passed');
    await frame.locator('.extension-badge[data-status="passed"]').waitFor();
    // Completion marked the book exercise solved (exerciseTools shows "Solved").
    await page.getByRole('button', { name: 'Solved', exact: true }).first().waitFor();
    assert.match(await storedProgress(page), /solved/);
    await shot(page, 'codelab-03-passed');

    // Code, results, and status survive a reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Code Lab' }).waitFor();
    await frame.locator('.cm-content').waitFor();
    assert.match(await frame.locator('.cm-content').textContent(), /while \(lo <= hi\)/);
    assert.equal(await frame.locator('.codelab-summary').textContent(), '4 / 4 tests passed');
    assert.equal(await frame.locator('.extension-badge').textContent(), 'Passed');

    // The infinite-loop block is terminated by the timeout; the app stays live.
    const loop = page.locator('.extension-frame[data-block-key="id:lab-loop"]');
    await loop.getByRole('button', { name: 'Run tests' }).click();
    await loop.locator('.codelab-test-detail', { hasText: 'timed out' }).waitFor({ timeout: 8000 });
    assert.equal(await loop.locator('.extension-badge').textContent(), 'In Progress');
    await shot(page, 'codelab-04-timeout');
    await frame.getByRole('button', { name: 'Reset code' }).click();
    assert.match(await frame.locator('.cm-content').textContent(), /your code here/);
  },
};

try {
  await mkdir(output, { recursive: true });
  const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios);
  for (const name of names) {
    assert.ok(Object.hasOwn(scenarios, name), `Unknown UI test ${name}`);
    const page = await setup();
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning' || message.text().includes('[ext-debug]')) console.log('BROWSER:', message.text());
    });
    try {
      await scenarios[name](page);
      assert.deepEqual(errors, []);
      console.log(`Passed ${name}`);
    } catch (error) {
      console.log('PAGEERRORS:', errors.map(e => e.message));
      console.log('NOTICE:', await page.locator('#notice').textContent().catch(() => 'n/a'));
      console.log('ARTICLE-AT-FAILURE:', await page.locator('article').evaluate(n => [...n.querySelectorAll('.bucher-extension')].map(p => p.getAttribute('data-extension') + '|' + (p.getAttribute('data-source') || '').split('\n')[0] + '|children:' + p.children.length + '|' + (p.firstElementChild?.className ?? 'EMPTY')).join(' ;; ')).catch(() => 'n/a'));
      console.log('DIALOGS-OPEN:', await page.evaluate(() => [...document.querySelectorAll('dialog')].map(d => d.open + ':' + (d.getAttribute('aria-labelledby') ? document.getElementById(d.getAttribute('aria-labelledby'))?.textContent : d.textContent.slice(0, 40))).join(' ;; ')));
      console.log('CARD-VISIBILITY:', await page.evaluate(() => [...document.querySelectorAll('.extension-disabled-card')].map(c => { const r = c.getBoundingClientRect(); const s = getComputedStyle(c); return `${r.width}x${r.height}@${r.top} display:${s.display} vis:${s.visibility}`; }).join(' ;; ')));
      throw error;
    } finally {
      await page.context().close();
    }
  }
} finally {
  await browser.close();
}
