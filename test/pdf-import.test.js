const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ExtensionRegistry } = require('../src/extensions/registry');
const { codeLabExtension } = require('../src/extensions/code-lab/code-lab');
const { mermaidExtension } = require('../src/extensions/mermaid');
const { mathPlotExtension } = require('../src/extensions/math-plot');
const { sqlDuckdbLabExtension } = require('../src/extensions/sql-duckdb-lab');
const { composeSkills, skillArgs, validateExtensionBlocks } = require('../src/extensions/skills');
const {
  autoSegmentPdf,
  chunkChapterText,
  cleanExtractedPages,
  extractRangeText,
  sanitizeBookTitle,
  segmentByPageChunks,
  segmentFromOutline,
} = require('../src/pdf/pdf-segment');
const { recommendExtensions } = require('../src/pdf/recommend');

test('per-import skill selection exposes only chosen extensions including Python Code Lab', () => {
  const reg = new ExtensionRegistry({ storage: null });
  reg.register(codeLabExtension);
  reg.register(mermaidExtension);
  reg.register(mathPlotExtension);

  // Even if globally disabled, selecting an extension explicitly on import exposes its skill.
  reg.setEnabled('ext-code-lab', false);

  const skills = composeSkills(reg, { extensionIds: ['ext-code-lab'], importMode: true });
  assert.match(skills, /ext-code-lab/);
  assert.match(skills, /language: python/);
  assert.match(skills, /sample_variance/);
  assert.match(skills, /reader explicitly selected/i);
  assert.doesNotMatch(skills, /ext-mermaid/);
  assert.doesNotMatch(skills, /ext-math-plot/);

  // Selecting none omits skills completely.
  assert.deepEqual(skillArgs(reg, { extensionIds: [] }), {});

  // Code Lab schema accepts Python with float tolerance and keeps JS default.
  const py = codeLabExtension.validate({
    id: 'mean-py',
    language: 'python',
    tolerance: 0.001,
    starter: 'def mean(xs):\n    pass',
    tests: [{ name: 'basic', fn: 'mean', args: [[1, 2, 3]], expected: 2 }],
  });
  assert.equal(py.ok, true);
  if (py.ok) {
    assert.equal(py.data.language, 'python');
    assert.equal(py.data.tolerance, 0.001);
  }
  const jsDefault = codeLabExtension.validate({
    id: 'add-js',
    starter: 'function add(a, b) { return a + b; }',
    tests: [{ name: 'sum', fn: 'add', args: [1, 2], expected: 3 }],
  });
  assert.equal(jsDefault.ok, true);
  if (jsDefault.ok) assert.equal(jsDefault.data.language, 'javascript');
});

test('validateExtensionBlocks verifies standalone and callout-nested extension fences', () => {
  const reg = new ExtensionRegistry({ storage: null });
  reg.register(codeLabExtension);

  const md = [
    '# Descriptive Statistics',
    '',
    '> [!exercise] Sample Variance',
    '> Implement unbiased sample variance in Python.',
    '>',
    '> ```ext-code-lab',
    '> id: var-py',
    '> title: Sample variance',
    '> language: python',
    '> starter: |',
    '>   def sample_var(xs):',
    '>       pass',
    '> tests:',
    '>   - name: simple',
    '>     fn: sample_var',
    '>     args: [[1, 2, 3]]',
    '>     expected: 1.0',
    '> ```',
    '',
    '```ext-code-lab',
    'id: broken-lab',
    'language: python',
    'tests: []',
    '```',
  ].join('\n');

  const report = validateExtensionBlocks(md, reg);
  assert.equal(report.total, 2);
  assert.equal(report.valid, 1);
  assert.equal(report.invalid.length, 1);
  assert.equal(report.invalid[0].extensionId, 'ext-code-lab');
  assert.ok(report.invalid[0].issues.some(msg => /tests/i.test(msg)));
});

test('cleanExtractedPages strips running headers, page numbers, and rejoins hyphenated words', () => {
  const rawPages = Array.from({ length: 8 }, (_, idx) => ({
    pageNumber: idx + 1,
    lines: [
      'Statistics with Python — Draft',
      `Page ${idx + 1} intro on statis-`,
      'tics and regression models.',
      String(idx + 1),
    ],
  }));
  const cleaned = cleanExtractedPages(rawPages);
  assert.equal(cleaned.length, 8);
  assert.doesNotMatch(cleaned[0].text, /Statistics with Python — Draft/);
  assert.match(cleaned[0].text, /statistics and regression models\./);
  assert.doesNotMatch(cleaned[0].text, /\n1$/);
});

test('autoSegmentPdf uses PDF outline, promotes Part chapters, and defaults back matter off', () => {
  const pages = Array.from({ length: 120 }, (_, i) => ({
    pageNumber: i + 1,
    text: `Content for page ${i + 1}`,
    lines: [`Content for page ${i + 1}`],
    charCount: 300,
  }));
  const outline = [
    { title: 'Preface', pageNumber: 3, level: 0 },
    { title: 'Part I: Foundations', pageNumber: 10, level: 0 },
    { title: 'Chapter 1: Descriptive Statistics', pageNumber: 10, level: 1 },
    { title: 'Chapter 2: Probability', pageNumber: 40, level: 1 },
    { title: 'Part II: Modeling', pageNumber: 75, level: 0 },
    { title: 'Chapter 3: Linear Regression', pageNumber: 75, level: 1 },
    { title: 'Index', pageNumber: 112, level: 0 },
  ];
  const result = autoSegmentPdf(pages, outline);
  assert.equal(result.strategy, 'outline');
  const titles = result.sections.map(s => s.title);
  assert.ok(titles.includes('Chapter 1: Descriptive Statistics'));
  assert.ok(titles.includes('Chapter 2: Probability'));
  assert.ok(titles.includes('Chapter 3: Linear Regression'));
  assert.ok(!titles.includes('Part I: Foundations'));
  const indexSection = result.sections.find(s => s.title === 'Index');
  assert.equal(indexSection.role, 'back');
  assert.equal(indexSection.included, false);
  const ch1 = result.sections.find(s => s.title === 'Chapter 1: Descriptive Statistics');
  assert.equal(ch1.startPage, 10);
  assert.equal(ch1.endPage, 39);
  assert.equal(ch1.included, true);

  // Heading fallback when no outline exists.
  const headingPages = [
    { pageNumber: 1, text: 'Chapter 1\nDescriptive Statistics\nMean and median.', lines: ['Chapter 1', 'Descriptive Statistics', 'Mean and median.'], charCount: 45 },
    { pageNumber: 2, text: 'More stats.', lines: ['More stats.'], charCount: 11 },
    { pageNumber: 3, text: 'Chapter 2\nHypothesis Testing\nP-values.', lines: ['Chapter 2', 'Hypothesis Testing', 'P-values.'], charCount: 38 },
  ];
  const fromHeadings = autoSegmentPdf(headingPages, []);
  assert.equal(fromHeadings.strategy, 'headings');
  assert.equal(fromHeadings.sections.length, 2);
  assert.equal(fromHeadings.sections[0].title, 'Chapter 1: Descriptive Statistics');
  assert.equal(fromHeadings.sections[1].startPage, 3);

  // Fixed chunk fallback and large chapter chunking.
  const chunks = segmentByPageChunks(pages.slice(0, 25), 10);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[2].startPage, 21);
  assert.equal(chunks[2].endPage, 25);

  const bigText = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}: ` + 'x'.repeat(1000)).join('\n\n');
  const split = chunkChapterText(bigText, 3500);
  assert.ok(split.length >= 3);
  assert.ok(split.every(part => part.length <= 3500));

  assert.equal(sanitizeBookTitle('Stats: With / Python?.pdf'), 'Stats With Python');
  assert.equal(extractRangeText(headingPages, 1, 2).includes('[Page 2]'), true);
  assert.equal(segmentFromOutline(headingPages, []), null);
});

test('recommendExtensions suggests Code Lab and plotting extensions for a Statistics with Python PDF', () => {
  const sample = `
    Practical Statistics with Python
    Chapter 1: Descriptive Statistics — def sample_mean(xs):
    Chapter 2: Normal Distribution, Gaussian curves, and Regression with pandas and numpy
  `;
  const { recommendedIds, reasons } = recommendExtensions(sample, [
    codeLabExtension.id,
    mathPlotExtension.id,
    mermaidExtension.id,
    sqlDuckdbLabExtension.id,
  ]);
  assert.ok(recommendedIds.includes('ext-code-lab'));
  assert.ok(recommendedIds.includes('ext-math-plot'));
  assert.ok(reasons['ext-code-lab'].includes('Python'));
});
