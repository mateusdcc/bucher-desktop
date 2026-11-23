import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, ['build.mjs']);

/**
 * Build a minimal, spec-valid multi-page PDF 1.4 buffer containing real text
 * streams so PDF.js parses it end-to-end in the browser without mocking.
 */
function buildTestPdf(pageTexts) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects = [];
  const addObj = body => {
    objects.push(body);
    return objects.length;
  };
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const pagesPlaceholderIdx = addObj(''); // filled once pageIds are known
  for (const lines of pageTexts) {
    const ops = ['BT', '/F1 14 Tf', '50 750 Td'];
    lines.forEach((line, idx) => {
      if (idx > 0) ops.push('0 -22 Td');
      ops.push(`(${esc(line)}) Tj`);
    });
    ops.push('ET');
    const stream = ops.join('\n');
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(`<< /Type /Page /Parent ${pagesPlaceholderIdx} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[pagesPlaceholderIdx - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesPlaceholderIdx} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

const pdfBuffer = buildTestPdf([
  [
    'Chapter 1',
    'Descriptive Statistics with Python',
    'In Python, we compute the sample mean with def sample_mean(xs): return sum(xs) / len(xs).',
    'Exercise: Write a Python function sample_mean(xs) to average a list of numbers.',
  ],
  [
    'Chapter 2',
    'Probability Distributions and Regression',
    'The normal distribution models symmetric data around a mean with standard deviation.',
    'Plot f(x) and compute variance using Python statistics and regression formulas.',
  ],
]);

const demo = 'demo/Buches';
const entries = await Promise.all((await readdir(demo, { recursive: true }))
  .filter(file => file.endsWith('.md'))
  .map(async file => ({ path: 'Buches/' + file, source: await readFile(resolve(demo, file), 'utf8') })));

const browser = await chromium.launch(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' });
const output = '.deinorganizer/e2e-staging/pdf-import';

try {
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await page.route('http://localhost/**', route => {
    const { pathname } = new URL(route.request().url());
    const file = resolve('dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    return existsSync(file) ? route.fulfill({ path: file }) : route.abort();
  });

  await page.addInitScript(seed => {
    window.fixtureChapterRequests = [];
    window.fixturePublishedDraft = null;
    const read = () => JSON.parse(localStorage.getItem('fixture-library') ?? JSON.stringify(seed));
    const write = items => localStorage.setItem('fixture-library', JSON.stringify(items));
    window.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        const items = read();
        if (command === 'load_library') return { basePath: '/tmp/bucher', entries: items };
        if (command === 'save_markdown') {
          const current = items.find(entry => entry.path === args.path);
          if ((current?.source ?? null) !== args.expected) throw new Error('Stale write');
          if (current) current.source = args.text;
          else items.push({ path: args.path, source: args.text });
          write(items);
          return;
        }
        if (command === 'ai_ollama_status') {
          return { installed: true, connected: true, models: ['fixture:latest'] };
        }
        if (command === 'ai_prepare_chapter') {
          window.fixtureChapterRequests.push({
            chapterTitle: args.chapterTitle,
            skills: args.skills || '',
            sourceText: args.sourceText,
            previousChapters: args.previousChapters,
          });
          if (args.chapterIndex === 1) {
            return {
              title: 'Descriptive Statistics with Python',
              description: 'Compute averages and dispersion in Python.',
              depends_on: [],
              cards: [
                { front: 'What is the sample mean formula?', back: '$\\bar{x} = \\frac{1}{n}\\sum_{i=1}^n x_i$' },
              ],
              markdown: [
                '# Descriptive Statistics with Python',
                '',
                '> [!definition] Sample mean',
                '> The sample mean of $x_1, \\dots, x_n$ is $\\bar{x} = \\frac{1}{n}\\sum x_i$.',
                '',
                '^sample-mean-def',
                '',
                '> [!exercise] Implement sample_mean in Python',
                '> Write a Python function returning the arithmetic mean of a non-empty list.',
                '>',
                '> ```ext-code-lab',
                '> id: py-sample-mean',
                '> title: Sample Mean (Python)',
                '> language: python',
                '> tolerance: 0.001',
                '> starter: |',
                '>   def sample_mean(xs):',
                '>       return 0',
                '> tests:',
                '>   - name: simple list',
                '>     fn: sample_mean',
                '>     args: [[2, 4, 6, 8]]',
                '>     expected: 5.0',
                '>   - name: floats',
                '>     fn: sample_mean',
                '>     args: [[1.5, 2.5, 3.5]]',
                '>     expected: 2.5',
                '> ```',
              ].join('\n'),
            };
          }
          return {
            title: 'Probability Distributions and Regression',
            description: 'Modeling symmetric variation.',
            depends_on: ['Descriptive Statistics with Python'],
            cards: [
              { front: 'What characterizes a normal distribution?', back: 'Its mean $\\mu$ and standard deviation $\\sigma$.' },
            ],
            markdown: '# Probability Distributions and Regression\n\nNormal curves are centered at $\\mu$.',
          };
        }
        if (command === 'ai_prepare_book_intro') {
          return {
            description: 'Interactive statistics taught with runnable Python labs.',
            introduction: 'Welcome to **Statistics with Python**, converted directly from PDF with Code Lab exercises.',
          };
        }
        if (command === 'ai_import_book') {
          const { draft } = args;
          window.fixturePublishedDraft = draft;
          const indexPath = `Buches/${draft.title}/_index.md`;
          items.push({
            path: indexPath,
            source: `---\ntitle: ${JSON.stringify(draft.title)}\ndescription: ${JSON.stringify(draft.description || '')}\n---\n\n${draft.introduction || ''}`,
          });
          draft.chapters.forEach((chapter, idx) => {
            const order = idx + 1;
            const deps = (chapter.depends_on || [])
              .map(title => draft.chapters.findIndex(c => c.title === title))
              .filter(depIdx => depIdx >= 0 && depIdx < idx)
              .map(depIdx => `  - "[[Buches/${draft.title}/concepts/chapter-${depIdx + 1}]]"`);
            const depYaml = deps.length ? `depends_on:\n${deps.join('\n')}` : 'depends_on: []';
            items.push({
              path: `Buches/${draft.title}/concepts/chapter-${order}.md`,
              source: `---\nname: ${JSON.stringify(chapter.title)}\norder: ${order}\n${depYaml}\n---\n\n${chapter.markdown}`,
            });
          });
          if (draft.cards?.length) {
            items.push({
              path: `Buches/${draft.title}/_cards.md`,
              source: '---\ntags:\n  - flashcards\n---\n\n' + draft.cards.map(c => `${c.front} :: ${c.back}`).join('\n\n'),
            });
          }
          write(items);
          return indexPath;
        }
        throw new Error('Unexpected command ' + command);
      },
    };
  }, entries);

  await page.goto('http://localhost/');
  await page.locator('.tree-link').first().waitFor();

  // Select local model in Settings -> AI
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.locator('.ollama-settings summary').click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.getByLabel('Local model').selectOption('fixture:latest');
  await page.getByRole('button', { name: 'Back to reader', exact: true }).click();

  // Open Import with AI and switch to PDF Book mode
  await page.getByRole('button', { name: 'Import with AI', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Book', exact: true }).click();

  // Upload real PDF file
  await page.locator('.pdf-file-input').setInputFiles({
    name: 'Statistics with Python.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
  });

  // Wait for PDF parsing & chapter detection
  await page.locator('.pdf-chapter-row').first().waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.pdf-chapter-row').count(), 2);
  assert.equal(await page.locator('.pdf-config').getByLabel('Book title', { exact: true }).inputValue(), 'Statistics with Python');

  // Verify Code Lab is highlighted as Recommended for this Python stats PDF
  const codeLabCard = page.locator('.import-ext-card', { hasText: 'Code Lab' });
  assert.ok(await codeLabCard.locator('.import-ext-rec-badge').isVisible());

  // Select ONLY Code Lab in the extension skill picker
  await page.locator('.import-extensions').getByRole('button', { name: 'None', exact: true }).click();
  await page.getByLabel('Expose Code Lab skill', { exact: true }).check();
  await page.getByText('1 of 12 extensions exposed').waitFor();

  // Preview exposed skills dialog verifies only Code Lab Python skill is exposed
  await page.getByRole('button', { name: 'Preview skills', exact: true }).click();
  const skillDialog = page.getByRole('dialog', { name: 'Exposed extension skills' });
  await skillDialog.waitFor();
  const skillText = await skillDialog.locator('.extension-source').textContent();
  assert.match(skillText, /ext-code-lab/);
  assert.match(skillText, /language: python/);
  assert.doesNotMatch(skillText, /ext-mermaid/);
  await page.keyboard.press('Escape');

  await page.screenshot({ path: `${output}/01-pdf-setup.jpg`, type: 'jpeg', quality: 90 });

  // Run chapter-by-chapter generation
  await page.getByRole('button', { name: 'Generate book from PDF', exact: true }).click();

  // Wait for Review draft screen with validation badges and flashcard count
  await page.getByRole('heading', { name: 'Review draft' }).waitFor({ timeout: 15000 });
  await page.getByText('1 interactive block valid').waitFor();
  await page.getByText('1 prerequisite link').waitFor();
  await page.getByText('2 flashcards').waitFor();

  // Verify the backend requests received ONLY Code Lab's skill (with Python instructions)
  const requests = await page.evaluate(() => window.fixtureChapterRequests);
  assert.equal(requests.length, 2);
  for (const req of requests) {
    assert.match(req.skills, /ext-code-lab/);
    assert.match(req.skills, /language: python/);
    assert.doesNotMatch(req.skills, /ext-mermaid/);
    assert.doesNotMatch(req.skills, /ext-sql-lab/);
  }
  assert.deepEqual(requests[1].previousChapters, ['Descriptive Statistics with Python']);
  await page.screenshot({ path: `${output}/02-pdf-draft-review.jpg`, type: 'jpeg', quality: 90 });

  // Publish the book and open Chapter 1
  await page.getByRole('button', { name: 'Import book', exact: true }).click();
  await page.getByRole('heading', { name: 'Statistics with Python', level: 1 }).waitFor();
  await page.locator('.contents').getByRole('button', { name: 'Descriptive Statistics with Python' }).click();

  // Verify the Python Code Lab exercise renders and ACTUALLY EXECUTES Python via Pyodide WASM!
  const frame = page.locator('.extension-frame[data-extension="ext-code-lab"]');
  await frame.waitFor();
  await frame.locator('.codelab-lang-chip', { hasText: 'Python' }).waitFor();
  const editor = frame.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('def sample_mean(xs):\n    return sum(xs) / len(xs)\n');
  await frame.getByRole('button', { name: 'Run tests', exact: true }).click();
  await frame.getByText('2 / 2 tests passed').waitFor({ timeout: 35000 });
  await page.screenshot({ path: `${output}/03-python-codelab-passed.jpg`, type: 'jpeg', quality: 90 });

  assert.deepEqual(pageErrors, []);
  console.log('Passed full PDF book import + per-import Code Lab Python skill + Pyodide execution E2E!');
} finally {
  await browser.close();
}
