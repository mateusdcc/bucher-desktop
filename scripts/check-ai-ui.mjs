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
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' });
const output = '.deinorganizer/e2e-staging/ai-workflow';
const bookTitle = 'Proofs in Linear Algebra';

async function setup() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  await page.route('http://localhost/**', route => {
    const { pathname } = new URL(route.request().url());
    const file = resolve('dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    return existsSync(file) ? route.fulfill({ path: file }) : route.abort();
  });
  await page.addInitScript(seed => {
    window.fixtureOnline = true;
    const read = () => JSON.parse(localStorage.getItem('fixture-library') ?? JSON.stringify(seed));
    const write = entries => localStorage.setItem('fixture-library', JSON.stringify(entries));
    window.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        const entries = read();
        if (command === 'load_library') return { basePath: '/Users/reader/Library/Application Support/com.mateusdcc.bucher', entries };
        if (command === 'save_markdown') {
          const current = entries.find(entry => entry.path === args.path);
          if ((current?.source ?? null) !== args.expected) throw new Error('The file changed on disk. Reopen it before editing.');
          if (current) current.source = args.text;
          else entries.push({ path: args.path, source: args.text });
          write(entries);
          return;
        }
        if (command === 'discard_solution') {
          write(entries.filter(entry => !(entry.path === args.path && entry.source === args.expected)));
          return;
        }
        if (command === 'ai_ollama_status') return window.fixtureOnline
          ? { installed: true, connected: true, models: ['qwen3:4b', 'gemma4:12b'] }
          : { installed: true, connected: false, models: [], error: 'Start Ollama and try again.' };
        if (command === 'chatgpt_status') {
          return JSON.parse(localStorage.getItem('fixture-chatgpt') || '{"state":"unregistered"}');
        }
        if (command === 'chatgpt_login') {
          const result = await new Promise(resolve => { window.fixtureFinishLogin = resolve; });
          localStorage.setItem('fixture-chatgpt', JSON.stringify(result));
          return result;
        }
        if (command === 'chatgpt_models') return [
          { slug: 'fixture-chatgpt-model', display_name: 'Example ChatGPT model' },
          { slug: 'another-model', display_name: 'Another ChatGPT model' },
        ];
        if (command === 'chatgpt_logout') {
          localStorage.setItem('fixture-chatgpt', '{"state":"signed-out","email":"reader@example.com"}');
          return;
        }
        if (command === 'chatgpt_usage') {
          window.fixtureUsageOpened = true;
          return;
        }
        if (command.startsWith('ai_') && command !== 'ai_import_book') {
          if (args.provider === 'chatgpt' && args.model === 'fixture-chatgpt-model') {
            window.fixtureChatGptRequests = (window.fixtureChatGptRequests ?? 0) + 1;
            window.fixtureReasoningEffort = args.reasoningEffort;
            if (window.fixtureUsageLimit) throw new Error('ChatGPT usage limit reached. Open Manage usage to see your plan and app limits.');
          } else if (args.provider !== 'ollama' || args.model !== 'qwen3:4b') {
            throw new Error('Wrong provider or model selected');
          }
        }
        if (command === 'ai_explain') {
          if (!args.context.includes('abelian group')) throw new Error('Missing chapter context');
          return '### Two structures, one space\n\nThe **additive group** lets you add vectors. Scalar multiplication describes how elements of the field stretch those vectors. Distributivity connects the two operations.';
        }
        if (command === 'ai_generate_solution') {
          if (!args.exercise.includes('using only the axioms')) throw new Error('Missing exercise context');
          return '### Apply distributivity\n\nSince $0 = 0 + 0$, scalar distributivity gives $0v = 0v + 0v$. Add the additive inverse of $0v$ to each side to obtain $0_V = 0v$.';
        }
        if (command === 'ai_review_solution') {
          if (!args.attempt.includes('scalar distributivity') || !args.rubric.includes('Correctness')) throw new Error('Missing attempt or rubric');
          return '### Correctness · 10/10\n\nThe proof applies scalar distributivity and cancels with an additive inverse. The steps establish the claim.';
        }
        if (command === 'ai_propose_patch') return {
          original: args.markdown,
          replacement: args.markdown.replace('Over a field', 'For any field').replace(
            'It satisfies', 'The vector space axioms then require',
          ).replace('a(v+w)=av+aw$.', 'a(v+w)=av+aw$.\n> These axioms say how vector addition and scalar multiplication work together.'),
        };
        if (command === 'ai_prepare_import') return {
          title: args.title,
          introduction: 'A short guide to adding even numbers.',
          chapters: [{ title: 'Even integers', markdown: 'An integer is even if it equals $2k$ for some integer $k$.' }],
        };
        if (command === 'ai_import_book') {
          const { draft } = args;
          const path = 'Buches/' + draft.title + '/_index.md';
          if (entries.some(entry => entry.path === path)) throw new Error('Book already exists');
          entries.push({ path, source: '---\ntitle: ' + JSON.stringify(draft.title) + '\n---\n\n' + draft.introduction });
          for (const [index, chapter] of draft.chapters.entries()) entries.push({
            path: 'Buches/' + draft.title + '/concepts/chapter-' + (index + 1) + '.md',
            source: '---\nname: ' + JSON.stringify(chapter.title) + '\norder: ' + (index + 1) + '\n---\n\n' + chapter.markdown,
          });
          write(entries);
          return path;
        }
        throw new Error('Unexpected IPC command ' + command);
      },
    };
  }, entries);
  await page.goto('http://localhost/');
  // The app opens the first book alphabetically; navigate to the target book.
  await page.locator('.tree-link').first().waitFor();
  const heading = page.getByRole('heading', { name: bookTitle, level: 1 });
  if (!(await heading.isVisible().catch(() => false))) {
    await page.locator('.tree-link', { hasText: bookTitle }).first().click();
  }
  await heading.waitFor();
  return page;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
async function selectFixtureModel(page) {
  await button(page, 'Settings').click();
  await button(page, 'AI').click();
  await page.locator('.ollama-settings summary').click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.getByLabel('Local model').selectOption('qwen3:4b');
  await button(page, 'Back to reader').click();
}
async function draftPatch(page, promptFrame) {
  await button(page, 'Propose a patch').click();
  const chapter = page.locator('article').getByRole('heading', { name: 'Vector spaces', exact: true });
  const chapterBox = await chapter.boundingBox();
  const railBox = await page.locator('.reader-rail').boundingBox();
  assert.ok(chapterBox && railBox && chapterBox.x + chapterBox.width <= railBox.x);
  assert.ok(chapterBox.y >= 0 && chapterBox.y < page.viewportSize().height);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByLabel('What should change?', { exact: true }).fill('Clarify the first sentence of the definition.');
  if (promptFrame) await shot(page, promptFrame);
  await button(page, 'Generate patch').click();
  await button(page, 'Apply patch').waitFor();
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 90, animations: 'disabled' });
}

const scenarios = {
  async chatgpt(page) {
    await button(page, 'Settings').click();
    await button(page, 'AI').click();
    const provider = page.getByLabel('AI provider');
    assert.equal(await provider.inputValue(), 'ollama');
    await provider.selectOption('chatgpt');
    await page.getByText('Signed out', { exact: true }).waitFor();
    await shot(page, 'chatgpt-01-settings');
    await button(page, 'Continue with ChatGPT').click();
    await page.getByRole('status').filter({ hasText: 'Finish signing in with ChatGPT in your browser.' }).waitFor();
    assert.ok(await button(page, 'Continue with ChatGPT').isDisabled());
    await shot(page, 'chatgpt-02-browser-pending');
    await page.evaluate(() => window.fixtureFinishLogin({ state: 'connected', email: 'reader@example.com' }));
    await page.getByRole('dialog', { name: 'You’re using your ChatGPT plan' }).waitFor();
    await shot(page, 'chatgpt-03-plan-confirmed');
    await button(page, 'Got it').click();
    const model = page.getByLabel('ChatGPT model');
    const reasoning = page.getByLabel('Reasoning level');
    await model.selectOption('fixture-chatgpt-model');
    await page.getByText('Signed in · reader@example.com', { exact: true }).waitFor();
    assert.equal(await reasoning.inputValue(), '');
    await shot(page, 'chatgpt-04-model');
    await reasoning.selectOption('high');
    await model.selectOption('another-model');
    assert.equal(await reasoning.inputValue(), '');
    await model.selectOption('fixture-chatgpt-model');
    assert.equal(await reasoning.inputValue(), 'high');
    await shot(page, 'chatgpt-04-reasoning');
    await page.reload();
    await button(page, 'Settings').click();
    await button(page, 'AI').click();
    await page.getByLabel('ChatGPT model').locator('option[value=fixture-chatgpt-model]').waitFor({ state: 'attached' });
    assert.equal(await provider.inputValue(), 'chatgpt');
    assert.equal(await model.inputValue(), 'fixture-chatgpt-model');
    assert.equal(await reasoning.inputValue(), 'high');
    await button(page, 'Back to reader').click();
    await button(page, 'Start reading').click();
    const explain = async () => {
      await button(page, 'Explain Vector space with AI').click();
      await page.getByText('Using ChatGPT plan', { exact: true }).waitFor();
      await page.getByLabel('Question', { exact: true }).fill('How do addition and scalar multiplication work together?');
      await button(page, 'Explain').click();
    };
    await explain();
    await page.getByRole('heading', { name: 'Two structures, one space' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureChatGptRequests), 1);
    assert.equal(await page.evaluate(() => window.fixtureReasoningEffort), 'high');
    await shot(page, 'chatgpt-05-explained');
    await page.evaluate(() => { window.fixtureUsageLimit = true; });
    await explain();
    await page.getByRole('status').filter({ hasText: 'ChatGPT usage limit reached' }).waitFor();
    await shot(page, 'chatgpt-06-limited');
    await button(page, 'Manage usage').click();
    assert.equal(await page.evaluate(() => window.fixtureUsageOpened), true);
    await button(page, 'Settings').click();
    await button(page, 'AI').click();
    await button(page, 'Sign out').click();
    await page.getByText('Signed out · reader@example.com', { exact: true }).waitFor();
    assert.equal(await model.isVisible(), false);
    assert.equal(await reasoning.isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('bucher/chatgpt-model')), null);
    await shot(page, 'chatgpt-07-signed-out');
  },
  async chatgptWithoutConsent(page) {
    await button(page, 'Settings').click();
    await button(page, 'AI').click();
    await page.getByLabel('AI provider').selectOption('chatgpt');
    await page.getByText('Signed out', { exact: true }).waitFor();
    await shot(page, 'chatgpt-consent-01-settings');
    await button(page, 'Continue with ChatGPT').click();
    await page.evaluate(() => window.fixtureFinishLogin({ state: 'plan-disabled', email: 'reader@example.com' }));
    await page.getByText('Plan usage is off · reader@example.com', { exact: true }).waitFor();
    assert.ok(await button(page, 'Enable plan usage').isVisible());
    assert.equal(await page.getByLabel('ChatGPT model').isVisible(), false);
    assert.equal(await page.getByLabel('Reasoning level').isVisible(), false);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await shot(page, 'chatgpt-consent-02-disabled');
  },
  async settings(page) {
    await shot(page, 'settings-01-library');
    await button(page, 'Settings').click();
    const panel = page.locator('.settings');
    await panel.getByText('/Users/reader/Library/Application Support/com.mateusdcc.bucher/Buches', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await shot(page, 'settings-02-page');
    await button(page, 'Back to reader').click();
    await panel.waitFor({ state: 'hidden' });
  },
  async model(page) {
    await button(page, 'Settings').click();
    await shot(page, 'model-01-settings');
    await button(page, 'AI').click();
    await page.locator('.ollama-settings summary').waitFor();
    assert.equal(await page.locator('.ollama-settings').evaluate(node => node.open), false);
    assert.equal(await page.getByLabel('Local model').isVisible(), false);
    await shot(page, 'model-01-collapsed');
    await page.locator('.ollama-settings summary').click();
    await page.getByText('Connected', { exact: true }).waitFor();
    const select = page.getByLabel('Local model');
    assert.deepEqual(await select.locator('option').allTextContents(), ['Choose a model', 'qwen3:4b', 'gemma4:12b']);
    await select.selectOption('qwen3:4b');
    await shot(page, 'model-02-connected');
    await page.evaluate(() => { window.fixtureOnline = false; });
    await button(page, 'Check connection').click();
    await page.getByText('Unavailable', { exact: true }).waitFor();
    assert.ok(await select.isDisabled());
    await shot(page, 'model-03-unavailable');
    await page.reload();
    await button(page, 'Settings').click();
    await button(page, 'AI').click();
    await page.locator('.ollama-settings summary').click();
    await page.getByText('Connected', { exact: true }).waitFor();
    assert.equal(await select.inputValue(), 'qwen3:4b');
  },
  async solution(page) {
    await button(page, 'Start reading').click();
    await button(page, 'Reveal solution').click();
    await shot(page, 'solution-01-proof');
    await button(page, 'New attempt').click();
    const source = page.getByLabel('Solution source');
    await source.waitFor();
    await shot(page, 'solution-02-editor');
    await source.fill('By **distributivity**, multiplication by zero gives the same term twice.');
    await source.press('End');
    await button(page, 'Insert Typst').click();
    await page.keyboard.insertText('0 v = (0 + 0) v = 0 v + 0 v');
    await source.press('ArrowDown');
    await source.press('ArrowDown');
    await page.locator('.solution-source .typst-math').waitFor();
    assert.match(await page.locator('.solution-source .typst-math annotation').textContent(), /0 v =/);
    assert.equal(await page.locator('.solution-source strong').textContent(), 'distributivity');
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-library')), null);
    await shot(page, 'solution-03-preview');
    await button(page, 'Save solution').click();
    await page.locator('.solution-panel .proof .typst-math').waitFor();
    await shot(page, 'solution-04-saved');
    await page.reload();
    await button(page, 'Reveal solution').click();
    await button(page, 'Solution 2').click();
    await page.locator('.solution-panel .proof .typst-math').waitFor();
    await button(page, 'Edit').click();
    await page.locator('.solution-rendered-block').filter({ has: page.locator('.typst-math') }).click();
    await source.getByText('```typst', { exact: true }).waitFor();
  },
  async explanation(page) {
    await selectFixtureModel(page);
    await button(page, 'Start reading').click();
    await shot(page, 'explain-01-chapter');
    await button(page, 'Explain Vector space with AI').click();
    const explanation = page.locator('.callout .ai-explanation');
    assert.equal(await explanation.evaluate(panel => panel.closest('.callout').querySelector('.callout-title').textContent), 'Vector space');
    const question = page.getByLabel('Question', { exact: true });
    const singleLineHeight = (await question.boundingBox()).height;
    assert.ok(singleLineHeight < 40);
    assert.equal(await question.evaluate(input => getComputedStyle(input).resize), 'none');
    await question.fill('How do addition and scalar multiplication work together?');
    await shot(page, 'explain-02-question');
    await question.fill('How do addition and scalar multiplication work together?\nHow does this relate to the distributive laws?');
    assert.ok((await question.boundingBox()).height > singleLineHeight);
    await shot(page, 'explain-02-multiline');
    await question.fill('How do addition and scalar multiplication work together?');
    assert.equal((await question.boundingBox()).height, singleLineHeight);
    await button(page, 'Explain').click();
    await explanation.getByRole('heading', { name: 'Two structures, one space' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    const alignedToPassage = () => explanation.evaluate(panel => {
      const passage = panel.closest('.callout').getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      return Math.abs(box.left - passage.left) < 1 && Math.abs(box.right - passage.right) < 1;
    });
    assert.ok(await alignedToPassage());
    await shot(page, 'explain-03-response');
    await page.setViewportSize({ width: 735, height: 625 });
    assert.ok(await alignedToPassage());
  },
  async generated(page) {
    await selectFixtureModel(page);
    await button(page, 'Start reading').click();
    await button(page, 'Reveal solution').click();
    await shot(page, 'generate-01-proof');
    await button(page, 'Generate solution with AI').click();
    await page.getByLabel('Instructions (optional)', { exact: true }).fill('Use the additive inverse explicitly.');
    await button(page, 'Generate solution').click();
    await page.locator('.solution-panel .exercise-ai-panel').getByRole('heading', { name: 'Apply distributivity' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-library')), null);
    await shot(page, 'generate-02-draft');
    await button(page, 'Save as AI solution').click();
    await page.locator('.solution-panel').getByRole('heading', { name: 'Apply distributivity' }).waitFor();
    await shot(page, 'generate-03-saved');
    const rightPanel = page.locator('#reader-side');
    const proof = page.locator('.solution-panel .proof');
    const originalPanel = await rightPanel.boundingBox();
    const originalProof = await proof.boundingBox();
    await button(page, 'Review attempt with AI').click();
    const rail = page.getByRole('complementary', { name: 'Reader tools' });
    await rail.getByRole('heading', { name: 'Correctness · 10/10' }).waitFor();
    await rail.getByText('The zero scalar acts as zero · AI solution 2', { exact: true }).waitFor();
    const proofBox = await proof.boundingBox();
    const railBox = await rail.boundingBox();
    assert.ok(proofBox && railBox && proofBox.x + proofBox.width <= railBox.x);
    assert.ok(proofBox.y < page.viewportSize().height && proofBox.y + proofBox.height > 0);
    assert.deepEqual(await rightPanel.boundingBox(), originalPanel);
    assert.equal(proofBox.x, originalProof.x);
    assert.equal(proofBox.width, originalProof.width);
    await shot(page, 'generate-04-review');
    const readerGrip = page.getByRole('separator', { name: 'Resize reader tools' });
    await readerGrip.press('ArrowLeft');
    const newReaderWidth = originalPanel.width + 16;
    assert.equal((await rightPanel.boundingBox()).width, newReaderWidth);
    await shot(page, 'generate-05-resized');
    await button(page, 'Dismiss review attempt with ai').click();
    await rail.waitFor({ state: 'hidden' });
    await page.locator('.solution-panel').getByRole('heading', { name: 'Apply distributivity' }).waitFor();
    assert.equal((await rightPanel.boundingBox()).width, newReaderWidth);

    const libraryPanel = page.locator('#library-sidebar');
    const libraryWidth = (await libraryPanel.boundingBox()).width;
    await shot(page, 'panels-01-before-library-drag');
    const grip = await page.getByRole('separator', { name: 'Resize library' }).boundingBox();
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 24, y, { steps: 4 });
    await page.mouse.up();
    assert.equal((await libraryPanel.boundingBox()).width, libraryWidth + 24);
    await shot(page, 'panels-02-library-resized');
    await page.reload();
    await page.getByRole('heading', { name: 'Vector spaces', level: 1 }).waitFor();
    assert.equal((await libraryPanel.boundingBox()).width, libraryWidth + 24);
    assert.equal((await rightPanel.boundingBox()).width, newReaderWidth);
    await shot(page, 'panels-03-reopened');
  },
  async first(page) {
    await selectFixtureModel(page);
    await page.evaluate(entries => {
      const chapter = entries.find(entry => entry.path.endsWith('/Vector spaces.md'));
      chapter.source = chapter.source.slice(0, chapter.source.indexOf('\n---\n<!-- buches-math'));
      localStorage.setItem('fixture-library', JSON.stringify(entries));
    }, entries);
    await page.reload();
    await button(page, 'Start reading').click();
    await shot(page, 'first-01-empty');
    await button(page, 'Write a solution').click();
    await page.getByLabel('Solution source').fill('My first solution.');
    assert.equal(await button(page, 'Hide solution').count(), 0);
    await shot(page, 'first-02-write');
    await button(page, 'Discard draft').click();
    await button(page, 'Generate solution with AI').click();
    await button(page, 'Generate solution').click();
    await button(page, 'Save as AI solution').click();
    await page.locator('.solution-panel').getByRole('heading', { name: 'Apply distributivity' }).waitFor();
    const entriesAfterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-library')));
    assert.match(entriesAfterSave.find(entry => entry.path.endsWith('/Vector spaces.md')).source, /buches-primary-ai/);
  },
  async import(page) {
    await selectFixtureModel(page);
    await shot(page, 'import-01-library');
    await button(page, 'Import with AI').click();
    await page.getByLabel('Book title', { exact: true }).fill('Even Numbers');
    const source = page.getByLabel('Source Markdown');
    assert.equal(await source.evaluate(input => getComputedStyle(input).resize), 'none');
    await source.fill('# Even Numbers\n\n## Even integers\nAn even integer equals 2k.');
    await button(page, 'Prepare draft').click();
    await page.locator('.import-draft').getByRole('heading', { name: 'Even integers' }).waitFor();
    assert.equal(await page.locator('.import-draft textarea, .import-draft input').count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await button(page, 'Edit chapter title').click();
    const chapterTitle = page.getByLabel('Chapter title', { exact: true });
    assert.equal(await chapterTitle.inputValue(), 'Even integers');
    await chapterTitle.fill('Definition of even');
    await button(page, 'Done editing chapter title').click();
    await shot(page, 'import-02-draft');
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-library')), null);
    await button(page, 'Import book').click();
    await page.getByRole('heading', { name: 'Even Numbers', level: 1 }).waitFor();
    await page.locator('.contents').getByRole('button', { name: 'Definition of even' }).waitFor();
    await shot(page, 'import-03-published');
  },
  async patch(page) {
    await selectFixtureModel(page);
    await button(page, 'Start reading').click();
    await shot(page, 'patch-01-chapter');
    await draftPatch(page, 'patch-02-instructions');
    const diff = page.getByRole('region', { name: 'Review patch' });
    await diff.getByText('+2 added', { exact: true }).waitFor();
    await diff.getByText('−1 removed', { exact: true }).waitFor();
    assert.match(await diff.locator('.diff-row.removed').textContent(), /Over a field/);
    assert.match(await diff.locator('.diff-row.added').first().textContent(), /For any field/);
    await shot(page, 'patch-03-diff');
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-library')), null);
    await button(page, 'Discard').click();
    await diff.waitFor({ state: 'hidden' });
    await page.locator('article').getByText(/Over a field/).waitFor();
    await shot(page, 'patch-05-discarded');
    await draftPatch(page);
    await button(page, 'Apply patch').click();
    await diff.waitFor({ state: 'hidden' });
    await page.locator('article').getByText(/For any field/).waitFor();
    await shot(page, 'patch-04-applied');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-library')));
    const source = stored.find(entry => entry.path.endsWith('/Vector spaces.md')).source;
    assert.ok(source.startsWith('---\nname: Vector spaces\n'));
    assert.match(source, /\^zero-scalar/);
    await page.reload();
    await page.getByText(/For any field/).waitFor();
    await page.setViewportSize({ width: 735, height: 625 });
    await button(page, 'Propose a patch').click();
    await page.getByLabel('What should change?').waitFor();
    assert.ok(await page.locator('.reading-scroll').evaluate(node => node.scrollWidth === node.clientWidth));
  },
  async stale(page) {
    await selectFixtureModel(page);
    await button(page, 'Start reading').click();
    await shot(page, 'stale-01-chapter');
    await draftPatch(page);
    await shot(page, 'stale-02-diff');
    await page.evaluate(entries => {
      entries.find(entry => entry.path.endsWith('/Vector spaces.md')).source += '\nOriginal text was edited externally.\n';
      localStorage.setItem('fixture-library', JSON.stringify(entries));
    }, entries);
    await button(page, 'Apply patch').click();
    await page.getByRole('status').filter({ hasText: 'The file changed on disk.' }).waitFor();
    await shot(page, 'stale-03-conflict');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByText('Original text was edited externally.').waitFor();
    assert.equal(await page.getByText(/For any field/).count(), 0);
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
