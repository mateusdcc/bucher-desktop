import { invoke } from '@tauri-apps/api/core';
import { registry } from './extensions/index.js';
import { composeSkills, skillArgs, validateExtensionBlocks } from './extensions/skills.js';
import { parsePdfBook } from './pdf/pdf-reader.js';
import {
  chunkChapterText,
  extractRangeText,
  segmentByPageChunks,
} from './pdf/pdf-segment.js';
import { extensionTag, recommendExtensions } from './pdf/recommend.js';
import { manageChatGptUsage } from './settings';
import { button, dialog, el, icon, iconButton } from './ui';
import { Badge, Button, ProgressBar, SegmentedControl } from './components/ui/index.ts';

function field({ name, label, required, multiline, value = '', placeholder = '' }) {
  const control = el(multiline ? 'textarea' : 'input');
  control.name = name;
  control.required = Boolean(required);
  control.value = value;
  if (placeholder) control.placeholder = placeholder;
  const row = el('label', 'field', label, control);
  return [row, control];
}

function checkboxRow(label, hint, checked, onChange) {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', 'import-option-row',
    input,
    el('span', 'import-option-copy',
      el('strong', '', label),
      hint ? el('span', 'muted', hint) : null));
}

/**
 * Interactive picker letting the user choose exactly which extensions expose
 * their AI authoring skills during this book import.
 */
function extensionSkillPicker({ selected, onChange, recommendations = { recommendedIds: [], reasons: {} } }) {
  const extensions = registry.list();
  let recs = recommendations;

  const summary = el('span', 'muted import-ext-summary');
  const recommendBtn = Button({
    label: 'Select recommended',
    leftIcon: 'sparkles',
    size: 'xs',
    variant: 'secondary',
    onClick: () => {
      selected.clear();
      for (const id of recs.recommendedIds) selected.add(id);
      sync();
      onChange();
    },
  });
  const allBtn = Button({
    label: 'All',
    size: 'xs',
    variant: 'ghost',
    onClick: () => {
      for (const ext of extensions) selected.add(ext.id);
      sync();
      onChange();
    },
  });
  const noneBtn = Button({
    label: 'None',
    size: 'xs',
    variant: 'ghost',
    onClick: () => {
      selected.clear();
      sync();
      onChange();
    },
  });
  const previewBtn = Button({
    label: 'Preview skills',
    leftIcon: 'eye',
    size: 'xs',
    variant: 'ghost',
    onClick: () => {
      const promptText = composeSkills(registry, { extensionIds: selected, importMode: true });
      dialog('Exposed extension skills', panel => {
        panel.classList.add('extension-source-dialog');
        panel.append(
          el('p', 'muted', selected.size
            ? `Exact skill instructions, schemas, and examples injected for the ${selected.size} selected extension${selected.size === 1 ? '' : 's'}.`
            : 'No extensions selected — the book will be imported as pure Markdown without interactive blocks.'),
          el('pre', 'extension-source', promptText || 'No extensions selected.'),
        );
      });
    },
  });

  const grid = el('div', 'import-ext-grid');
  const cards = new Map();

  for (const ext of extensions) {
    const input = el('input');
    input.type = 'checkbox';
    input.value = ext.id;
    input.setAttribute('aria-label', `Expose ${ext.name} skill`);
    const tag = extensionTag(ext.id);
    const recBadge = el('span', 'import-ext-rec-badge', 'Recommended');
    recBadge.hidden = true;
    const reasonText = el('span', 'import-ext-reason muted');
    reasonText.hidden = true;
    const disabledNote = el('span', 'import-ext-disabled muted', 'Disabled in Settings · will enable on import');
    disabledNote.hidden = true;

    const card = el('label', 'import-ext-card',
      el('div', 'import-ext-card-head',
        input,
        icon(ext.icon),
        el('span', 'import-ext-name', ext.name),
        tag ? Badge({ variant: 'neutral', children: tag }) : null),
      el('div', 'import-ext-card-meta',
        el('span', 'muted', ext.category),
        recBadge),
      reasonText,
      disabledNote);

    input.addEventListener('change', () => {
      if (input.checked) selected.add(ext.id);
      else selected.delete(ext.id);
      sync();
      onChange();
    });
    cards.set(ext.id, { card, input, recBadge, reasonText, disabledNote });
    grid.append(card);
  }

  function sync() {
    const count = selected.size;
    summary.textContent = count
      ? `${count} of ${extensions.length} extension${extensions.length === 1 ? '' : 's'} exposed`
      : 'No extensions exposed (Markdown only)';
    recommendBtn.hidden = !recs.recommendedIds.length;
    const recSet = new Set(recs.recommendedIds);
    for (const ext of extensions) {
      const entry = cards.get(ext.id);
      const checked = selected.has(ext.id);
      entry.input.checked = checked;
      entry.card.classList.toggle('selected', checked);
      const isRec = recSet.has(ext.id);
      entry.card.classList.toggle('recommended', isRec);
      entry.recBadge.hidden = !isRec;
      const reason = recs.reasons[ext.id] || '';
      entry.reasonText.textContent = reason;
      entry.reasonText.hidden = !reason;
      entry.disabledNote.hidden = !(checked && !registry.isEnabled(ext.id));
    }
  }

  sync();
  const root = el('section', 'import-extensions',
    el('div', 'import-section-head',
      el('div', '',
        el('h3', '', 'Extensions & AI skills'),
        summary),
      el('div', 'import-section-actions', recommendBtn, allBtn, noneBtn, previewBtn)),
    el('p', 'muted import-section-hint',
      'Selected extensions expose their authoring skills (instructions, YAML syntax, schema, and examples) so the AI converts matching exercises and visuals into live interactive blocks.'),
    grid);

  return {
    root,
    setRecommendations(nextRecs) {
      recs = nextRecs || { recommendedIds: [], reasons: {} };
      sync();
    },
    sync,
  };
}

/**
 * Editable draft preview shared by both Markdown and PDF book imports, with
 * live Zod validation of generated extension blocks and flashcard preview.
 */
function importPreview(draft, markdown) {
  function editable(parent, key, label, type, display, onUpdate) {
    const section = el('section', 'draft-section');
    function show() {
      const edit = iconButton('Edit ' + label.toLowerCase(), 'pencil', () => {
        const [row, input] = field({ name: key, label, multiline: type === 'markdown', value: parent[key] || '' });
        input.addEventListener('input', () => {
          parent[key] = type === 'text' ? input.value.trim() : input.value;
          onUpdate?.();
        });
        const finish = button('Done editing ' + label.toLowerCase(), 'check', () => {
          show();
          onUpdate?.();
          section.querySelector('button').focus();
        });
        section.replaceChildren(row, finish);
        input.focus();
      });
      section.replaceChildren(display(parent[key] || ''), edit);
    }
    show();
    return section;
  }

  const summaryBar = el('div', 'import-draft-summary');
  const chapterChecks = new Map();

  function refreshSummary() {
    let totalBlocks = 0;
    let validBlocks = 0;
    let totalIssues = 0;
    let prereqCount = 0;
    for (const chapter of draft.chapters) {
      const report = validateExtensionBlocks(chapter.markdown, registry);
      totalBlocks += report.total;
      validBlocks += report.valid;
      totalIssues += report.invalid.length;
      prereqCount += Array.isArray(chapter.depends_on) ? chapter.depends_on.length : 0;
      const badgeHost = chapterChecks.get(chapter);
      if (badgeHost) renderChapterReport(badgeHost, report, chapter);
    }
    const cardCount = Array.isArray(draft.cards) ? draft.cards.length : 0;
    const chips = [
      Badge({ variant: 'neutral', children: `${draft.chapters.length} chapter${draft.chapters.length === 1 ? '' : 's'}` }),
    ];
    if (totalBlocks > 0) {
      chips.push(Badge({
        variant: totalIssues ? 'warning' : 'success',
        children: totalIssues
          ? `${validBlocks}/${totalBlocks} interactive blocks valid`
          : `${totalBlocks} interactive block${totalBlocks === 1 ? '' : 's'} valid`,
      }));
    }
    if (prereqCount > 0) {
      chips.push(Badge({ variant: 'info', children: `${prereqCount} prerequisite link${prereqCount === 1 ? '' : 's'}` }));
    }
    if (cardCount > 0) {
      chips.push(Badge({ variant: 'accent', children: `${cardCount} flashcard${cardCount === 1 ? '' : 's'}` }));
    }
    summaryBar.replaceChildren(...chips);
  }

  function renderChapterReport(host, report, chapter) {
    const items = [];
    if (Array.isArray(chapter.depends_on) && chapter.depends_on.length) {
      items.push(el('p', 'muted draft-chapter-meta', `Prerequisites: ${chapter.depends_on.join(', ')}`));
    }
    if (report.total > 0) {
      items.push(el('div', 'draft-validation-row',
        Badge({
          variant: report.invalid.length ? 'warning' : 'success',
          children: report.invalid.length
            ? `${report.valid}/${report.total} extension blocks valid · ${report.invalid.length} issue${report.invalid.length === 1 ? '' : 's'}`
            : `${report.total} interactive block${report.total === 1 ? '' : 's'} verified`,
        })));
      for (const bad of report.invalid) {
        items.push(el('div', 'draft-validation-issue',
          el('strong', '', `${bad.extensionId} (${bad.title}): `),
          el('span', '', bad.issues.join(' · '))));
      }
    }
    host.replaceChildren(...items);
  }

  const draftTitle = editable(draft, 'title', 'Book title', 'text', title => el('h3', 'draft-book-title', title || 'Untitled book'));
  const draftDescription = draft.description != null
    ? editable(draft, 'description', 'Book description', 'text', desc => el('p', 'muted', desc || 'No description'))
    : null;
  const introduction = editable(draft, 'introduction', 'Introduction', 'markdown',
    source => source ? markdown(source, '') : el('p', 'muted', 'No introduction'));

  const chapterNodes = draft.chapters.map(chapter => {
    const checkHost = el('div', 'draft-chapter-checks');
    chapterChecks.set(chapter, checkHost);
    return el('div', 'draft-chapter',
      editable(chapter, 'title', 'Chapter title', 'text', title => el('h4', '', title || 'Untitled chapter')),
      checkHost,
      editable(chapter, 'markdown', 'Chapter Markdown', 'markdown', text => markdown(text, ''), refreshSummary));
  });

  const cards = Array.isArray(draft.cards) ? draft.cards : [];
  const cardsSection = cards.length ? el('details', 'draft-cards-preview',
    el('summary', '', `${cards.length} generated FSRS flashcards (_cards.md)`),
    el('div', 'draft-cards-list', cards.map(card => el('div', 'draft-card-row',
      el('div', 'draft-card-front', card.front),
      el('div', 'draft-card-back muted', card.back))))) : null;

  refreshSummary();
  return el('div', 'import-draft', summaryBar, draftTitle, draftDescription, introduction, chapterNodes, cardsSection);
}

/**
 * Render the unified Import Studio supporting both Markdown and entire PDF
 * book imports with per-import extension skill selection.
 */
export function renderImportStudio({ selection, markdown, openImportedBook, close, initialMode = 'markdown' }) {
  const usesChatGpt = selection.provider === 'chatgpt';
  const selectedExtensions = new Set(registry.enabled().map(ext => ext.id));
  let mode = initialMode === 'pdf' ? 'pdf' : 'markdown';
  let parsedPdf = null;
  let segmentationMode = 'auto';
  let pdfCancelled = false;
  let generating = false;

  const heading = el('h2', '', icon('sparkles'), mode === 'pdf' ? 'Import a PDF book' : 'Prepare from Markdown');
  heading.id = 'ai-' + crypto.randomUUID();
  const dismiss = iconButton(mode === 'pdf' ? 'Dismiss import a pdf book' : 'Dismiss prepare from markdown', 'x', () => {
    pdfCancelled = true;
    close();
  });
  const panel = el('section', 'ai-panel ai-import',
    el('div', 'ai-heading', heading, dismiss));
  panel.setAttribute('aria-labelledby', heading.id);

  if (usesChatGpt) {
    panel.append(el('div', 'ai-provider-note', el('span', 'muted', 'Using ChatGPT plan'), manageChatGptUsage()));
  }

  const status = el('p', 'ai-status muted');
  status.setAttribute('role', 'status');
  const showError = error => {
    status.textContent = error?.message || String(error);
    status.classList.add('error-text');
  };
  const setStatus = text => {
    status.textContent = text;
    status.classList.remove('error-text');
  };

  const result = el('div', 'ai-result');
  result.hidden = true;

  const picker = extensionSkillPicker({
    selected: selectedExtensions,
    onChange: () => {},
  });

  // --- Mode Switch (Markdown | PDF Book) ---
  const modeSwitch = SegmentedControl({
    ariaLabel: 'Import source format',
    value: mode,
    options: [
      { value: 'markdown', label: 'Markdown', icon: 'file-text' },
      { value: 'pdf', label: 'PDF Book', icon: 'book-open' },
    ],
    onChange(next) {
      if (generating) return;
      mode = next;
      markdownForm.hidden = mode !== 'markdown';
      pdfView.hidden = mode !== 'pdf';
      pdfSubmitBar.hidden = mode !== 'pdf' || !parsedPdf;
      heading.replaceChildren(icon('sparkles'), mode === 'pdf' ? 'Import a PDF book' : 'Prepare from Markdown');
      dismiss.setAttribute('aria-label', mode === 'pdf' ? 'Dismiss import a pdf book' : 'Dismiss prepare from markdown');
      setStatus('');
    },
  });

  // --- Shared Draft Review Transition ---
  function showReviewDraft(draft) {
    const content = importPreview(draft, markdown);
    result.replaceChildren(content);
    heading.replaceChildren(icon('sparkles'), 'Review draft');
    const backBtn = button('Back to setup', 'arrow-left', () => {
      result.hidden = true;
      setupStage.hidden = false;
      heading.replaceChildren(icon('sparkles'), mode === 'pdf' ? 'Import a PDF book' : 'Prepare from Markdown');
      setStatus('');
    });
    const acceptBtn = button('Import book', 'check', async () => {
      setStatus('Saving…');
      acceptBtn.disabled = true;
      try {
        // Ensure any extension the reader explicitly selected for this book is enabled in the reader.
        for (const id of selectedExtensions) {
          if (!registry.isEnabled(id)) registry.setEnabled(id, true);
        }
        const payload = {
          ...draft,
          extensions: [...selectedExtensions],
        };
        const path = await invoke('ai_import_book', { draft: payload });
        await close();
        await openImportedBook(path);
      } catch (error) {
        showError(error);
        acceptBtn.disabled = false;
      }
    }, 'accent-button');
    result.append(el('div', 'ai-actions', backBtn, button('Close', null, close), acceptBtn));
    setStatus('');
    setupStage.hidden = true;
    result.hidden = false;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  // --- Markdown Import Form (preserves exact existing labels & selectors) ---
  const markdownForm = el('form', 'ai-form');
  markdownForm.hidden = mode !== 'markdown';
  const [mdTitleRow, mdTitleInput] = field({ name: 'title', label: 'Book title', required: true });
  const [mdSourceRow, mdSourceInput] = field({ name: 'markdown', label: 'Source Markdown', required: true, multiline: true });
  const mdSubmit = button('Prepare draft', null, null, 'accent-button');
  mdSubmit.type = 'submit';
  markdownForm.append(mdTitleRow, mdSourceRow, el('div', 'ai-actions', mdSubmit));

  markdownForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (mdSubmit.disabled || generating) return;
    const title = mdTitleInput.value.trim();
    const sourceText = mdSourceInput.value;
    if (!title || !sourceText.trim()) {
      showError('Fill in the required fields.');
      return;
    }
    generating = true;
    mdSubmit.disabled = true;
    mdTitleInput.readOnly = true;
    mdSourceInput.readOnly = true;
    setStatus(usesChatGpt ? 'Waiting for ChatGPT…' : 'Waiting for Ollama…');
    try {
      const skillsPayload = skillArgs(registry, { extensionIds: selectedExtensions, importMode: true });
      const draft = await invoke('ai_prepare_import', {
        ...selection,
        ...skillsPayload,
        title,
        markdown: sourceText,
      });
      if (!panel.isConnected) return;
      showReviewDraft(draft);
    } catch (error) {
      showError(error);
    } finally {
      generating = false;
      mdSubmit.disabled = false;
      mdTitleInput.readOnly = false;
      mdSourceInput.readOnly = false;
    }
  });

  // --- PDF Book Import View ---
  const pdfView = el('div', 'pdf-import-view');
  pdfView.hidden = mode !== 'pdf';

  const fileInput = el('input', 'pdf-file-input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,application/pdf';
  fileInput.setAttribute('aria-label', 'PDF book file');

  const pickBtn = Button({
    label: 'Choose PDF book…',
    leftIcon: 'file-up',
    variant: 'primary',
    onClick: () => fileInput.click(),
  });

  const dropzone = el('div', 'pdf-dropzone',
    icon('book-open'),
    el('div', 'pdf-dropzone-copy',
      el('strong', '', 'Drop an entire PDF book here'),
      el('p', 'muted', 'Extracts chapters locally with PDF.js, recommends matching extensions, and converts chapter by chapter into interactive Bücher Markdown.')),
    pickBtn,
    fileInput);

  const parseProgressHost = el('div', 'pdf-parse-progress');
  parseProgressHost.hidden = true;

  const pdfConfigHost = el('div', 'pdf-config');
  pdfConfigHost.hidden = true;

  const pipelineHost = el('div', 'pdf-pipeline');
  pipelineHost.hidden = true;

  // Pedagogical enrichment options aligned with Bücher's active-study philosophy.
  const studyOpts = {
    callouts: true,
    convertExercises: true,
    generatePrereqs: true,
    generateCloze: false,
    generateCards: true,
  };

  let pdfTitleInput;
  let pdfDescInput;
  let pdfInstrInput;

  function renderPdfConfig() {
    if (!parsedPdf) return;
    pdfConfigHost.hidden = false;

    const strategyLabel = parsedPdf.strategy === 'outline'
      ? 'Chapters detected from PDF outline'
      : parsedPdf.strategy === 'headings'
        ? 'Chapters detected from headings'
        : 'Split into page chunks';

    const metaStrip = el('div', 'pdf-meta-strip',
      el('div', 'pdf-meta-info',
        el('strong', '', parsedPdf.fileName),
        el('span', 'muted', `${parsedPdf.numPages} pages · ${Math.round(parsedPdf.totalChars / 1000).toLocaleString()}k chars · ${strategyLabel}`)),
      Button({
        label: 'Choose another PDF',
        leftIcon: 'replace',
        size: 'xs',
        variant: 'ghost',
        onClick: () => fileInput.click(),
      }));

    const [titleRow, titleCtrl] = field({ name: 'pdfTitle', label: 'Book title', required: true, value: parsedPdf.title });
    const [descRow, descCtrl] = field({
      name: 'pdfDescription',
      label: 'Book description (optional)',
      required: false,
      value: parsedPdf.subject || '',
      placeholder: 'One-sentence summary shown on the book overview page',
    });
    pdfTitleInput = titleCtrl;
    pdfDescInput = descCtrl;

    // Chapter list & segmentation controls
    const chapterList = el('div', 'pdf-chapter-list');
    const chapterCount = el('span', 'muted import-ext-summary');

    function redrawChapters() {
      const selectedCount = parsedPdf.sections.filter(s => s.included).length;
      const selectedPages = parsedPdf.sections.filter(s => s.included).reduce((n, s) => n + (s.endPage - s.startPage + 1), 0);
      chapterCount.textContent = `${selectedCount} of ${parsedPdf.sections.length} selected (${selectedPages} pages)`;
      chapterList.replaceChildren(...parsedPdf.sections.map(sec => {
        const check = el('input');
        check.type = 'checkbox';
        check.checked = sec.included;
        check.setAttribute('aria-label', `Include ${sec.title}`);
        check.addEventListener('change', () => {
          sec.included = check.checked;
          row.classList.toggle('excluded', !sec.included);
          redrawCount();
        });
        const titleEdit = el('input', 'pdf-chapter-title-input');
        titleEdit.type = 'text';
        titleEdit.value = sec.title;
        titleEdit.setAttribute('aria-label', `Title for pages ${sec.startPage} to ${sec.endPage}`);
        titleEdit.addEventListener('input', () => { sec.title = titleEdit.value; });
        const pagesSpan = sec.endPage - sec.startPage + 1;
        const roleBadge = sec.role === 'front'
          ? Badge({ variant: 'neutral', children: 'Front' })
          : sec.role === 'back'
            ? Badge({ variant: 'neutral', children: 'Back' })
            : null;
        const row = el('div', 'pdf-chapter-row' + (sec.included ? '' : ' excluded'),
          check,
          titleEdit,
          roleBadge,
          el('span', 'pdf-chapter-pages muted', `pp. ${sec.startPage}–${sec.endPage} (${pagesSpan}p)`));
        return row;
      }));
    }

    function redrawCount() {
      const selectedCount = parsedPdf.sections.filter(s => s.included).length;
      const selectedPages = parsedPdf.sections.filter(s => s.included).reduce((n, s) => n + (s.endPage - s.startPage + 1), 0);
      chapterCount.textContent = `${selectedCount} of ${parsedPdf.sections.length} selected (${selectedPages} pages)`;
    }

    const segControl = SegmentedControl({
      ariaLabel: 'Chapter detection mode',
      size: 'sm',
      value: segmentationMode,
      options: [
        { value: 'auto', label: 'Auto chapters' },
        { value: 'chunks', label: '12-page chunks' },
      ],
      onChange(next) {
        segmentationMode = next;
        parsedPdf.sections = next === 'chunks'
          ? segmentByPageChunks(parsedPdf.pages, 12)
          : parsedPdf.autoSections.map(s => ({ ...s }));
        redrawChapters();
      },
    });

    const chaptersPanel = el('section', 'pdf-chapters-panel',
      el('div', 'import-section-head',
        el('div', '', el('h3', '', 'Chapters to import'), chapterCount),
        el('div', 'import-section-actions',
          segControl.root,
          Button({
            label: 'Core',
            size: 'xs',
            variant: 'ghost',
            onClick: () => {
              for (const s of parsedPdf.sections) s.included = s.role === 'chapter';
              if (!parsedPdf.sections.some(s => s.included) && parsedPdf.sections.length) {
                parsedPdf.sections[0].included = true;
              }
              redrawChapters();
            },
          }),
          Button({
            label: 'All',
            size: 'xs',
            variant: 'ghost',
            onClick: () => {
              for (const s of parsedPdf.sections) s.included = true;
              redrawChapters();
            },
          }),
          Button({
            label: 'None',
            size: 'xs',
            variant: 'ghost',
            onClick: () => {
              for (const s of parsedPdf.sections) s.included = false;
              redrawChapters();
            },
          }))),
      chapterList);

    redrawChapters();

    // Active study enrichment options (Bücher philosophy)
    const optionsPanel = el('section', 'pdf-study-options',
      el('h3', '', 'Active study enrichment'),
      el('div', 'import-options-grid',
        checkboxRow('Structured callouts', 'Definitions, theorems, examples, exercises, and collapsible hints', studyOpts.callouts, v => { studyOpts.callouts = v; }),
        checkboxRow('Interactive extension exercises', 'Convert matching exercises & visuals into the extensions selected above', studyOpts.convertExercises, v => { studyOpts.convertExercises = v; }),
        checkboxRow('Prerequisite graph', 'Link each chapter’s depends_on to earlier chapters it builds on', studyOpts.generatePrereqs, v => { studyOpts.generatePrereqs = v; }),
        checkboxRow('FSRS flashcards (_cards.md)', 'Generate spaced-repetition cards from key concepts per chapter', studyOpts.generateCards, v => { studyOpts.generateCards = v; }),
        checkboxRow('Cloze recall blanks (==…==)', 'Mark key formulas & terms for Bücher’s Cloze Quiz mode', studyOpts.generateCloze, v => { studyOpts.generateCloze = v; })));

    const [instrRow, instrCtrl] = field({
      name: 'pdfInstructions',
      label: 'Authoring instructions (optional)',
      multiline: true,
      placeholder: 'e.g. Convert every Python statistics exercise into runnable Code Lab tests using Python’s standard library.',
    });
    pdfInstrInput = instrCtrl;

    pdfConfigHost.replaceChildren(
      metaStrip,
      titleRow,
      descRow,
      chaptersPanel,
      optionsPanel,
      instrRow);
    pdfSubmitBar.hidden = mode !== 'pdf';
  }

  async function handlePdfFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showError('Choose a PDF (.pdf) file.');
      return;
    }
    setStatus('');
    parseProgressHost.hidden = false;
    pdfConfigHost.hidden = true;
    pdfSubmitBar.hidden = true;
    pipelineHost.hidden = true;
    const bar = ProgressBar({ value: 0, max: 1, label: 'Reading PDF…' });
    const phaseLabel = el('p', 'muted', 'Opening PDF…');
    parseProgressHost.replaceChildren(bar.root, phaseLabel);

    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parsePdfBook(buffer, file.name, ({ current, total, phase }) => {
        bar.setValue(current, total || 1);
        phaseLabel.textContent = phase;
      });
      if (!panel.isConnected) return;
      parsed.autoSections = parsed.sections.map(s => ({ ...s }));
      parsedPdf = parsed;
      segmentationMode = 'auto';
      const recs = recommendExtensions(parsed.sample, registry.list().map(e => e.id));
      picker.setRecommendations(recs);
      parseProgressHost.hidden = true;
      renderPdfConfig();
      if (recs.recommendedIds.length) {
        setStatus(`Parsed ${parsed.numPages} pages. Highlighted ${recs.recommendedIds.length} recommended extension${recs.recommendedIds.length === 1 ? '' : 's'} for this book.`);
      } else {
        setStatus(`Parsed ${parsed.numPages} pages into ${parsed.sections.length} section${parsed.sections.length === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      parseProgressHost.hidden = true;
      showError(error);
    } finally {
      fileInput.value = '';
    }
  }

  fileInput.addEventListener('change', () => handlePdfFile(fileInput.files?.[0]));
  dropzone.addEventListener('dragover', event => {
    event.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dropzone.classList.remove('drag-over');
    handlePdfFile(event.dataTransfer?.files?.[0]);
  });

  // --- Chapter-by-Chapter PDF Generation Pipeline ---
  async function runPdfPipeline() {
    if (!parsedPdf || generating) return;
    const bookTitle = pdfTitleInput.value.trim();
    if (!bookTitle) {
      showError('Enter a book title.');
      return;
    }
    const chosenSections = parsedPdf.sections.filter(s => s.included);
    if (!chosenSections.length) {
      showError('Select at least one chapter to import.');
      return;
    }

    generating = true;
    pdfCancelled = false;
    setStatus('');
    pdfConfigHost.hidden = true;
    pdfSubmitBar.hidden = true;
    dropzone.hidden = true;
    picker.root.hidden = true;
    modeSwitch.root.hidden = true;
    pipelineHost.hidden = false;

    const skillsPayload = skillArgs(registry, { extensionIds: selectedExtensions, importMode: true });
    const chapterOptions = {
      callouts: studyOpts.callouts,
      convertExercises: studyOpts.convertExercises,
      generatePrereqs: studyOpts.generatePrereqs,
      generateCloze: studyOpts.generateCloze,
      generateCards: studyOpts.generateCards,
      instructions: pdfInstrInput.value.trim() || null,
    };

    const jobs = chosenSections.map((section, idx) => ({
      index: idx + 1,
      section,
      state: 'queued',
      detail: `pp. ${section.startPage}–${section.endPage}`,
      result: null,
      error: null,
    }));

    const overallBar = ProgressBar({ value: 0, max: jobs.length, label: 'Converting chapters' });
    const jobList = el('div', 'pdf-job-list');
    const pipelineActions = el('div', 'ai-actions');

    const cancelBtn = Button({
      label: 'Stop after current chapter',
      leftIcon: 'square',
      variant: 'danger',
      onClick: () => {
        pdfCancelled = true;
        cancelBtn.disabled = true;
        setStatus('Stopping after the current chapter finishes…');
      },
    });
    const backToConfigBtn = Button({
      label: 'Back to PDF setup',
      leftIcon: 'arrow-left',
      variant: 'secondary',
      onClick: () => {
        if (generating) return;
        pipelineHost.hidden = true;
        dropzone.hidden = false;
        pdfConfigHost.hidden = false;
        pdfSubmitBar.hidden = false;
        picker.root.hidden = false;
        modeSwitch.root.hidden = false;
      },
    });
    const reviewBtn = Button({
      label: 'Review draft',
      leftIcon: 'check',
      variant: 'primary',
      onClick: () => finishToReview(),
    });
    reviewBtn.hidden = true;
    backToConfigBtn.hidden = true;

    pipelineActions.append(backToConfigBtn, cancelBtn, reviewBtn);
    pipelineHost.replaceChildren(
      el('h3', '', `Converting “${bookTitle}”`),
      el('p', 'muted', selectedExtensions.size
        ? `Exposing skills for ${selectedExtensions.size} extension${selectedExtensions.size === 1 ? '' : 's'} across ${jobs.length} chapter${jobs.length === 1 ? '' : 's'}.`
        : `Converting ${jobs.length} chapter${jobs.length === 1 ? '' : 's'} as Markdown.`),
      overallBar.root,
      jobList,
      pipelineActions);

    let introDraft = { description: pdfDescInput.value.trim(), introduction: '' };

    function renderJobs() {
      const doneCount = jobs.filter(j => j.state === 'done').length;
      overallBar.setValue(doneCount, jobs.length);
      jobList.replaceChildren(...jobs.map(job => {
        const badgeVariant = job.state === 'done' ? 'success'
          : job.state === 'running' ? 'info'
            : job.state === 'error' ? 'danger' : 'neutral';
        const badgeLabel = job.state === 'done' ? 'Done'
          : job.state === 'running' ? 'Generating…'
            : job.state === 'error' ? 'Failed' : 'Queued';
        const retry = job.state === 'error' && !generating
          ? Button({
            label: 'Retry',
            leftIcon: 'refresh-cw',
            size: 'xs',
            variant: 'secondary',
            onClick: async () => {
              generating = true;
              backToConfigBtn.hidden = true;
              reviewBtn.hidden = true;
              await runSingleJob(job);
              generating = false;
              backToConfigBtn.hidden = false;
              reviewBtn.hidden = !jobs.some(j => j.state === 'done');
              renderJobs();
            },
          })
          : null;
        return el('div', `pdf-job-row ${job.state}`,
          Badge({ variant: badgeVariant, children: badgeLabel }),
          el('div', 'pdf-job-copy',
            el('strong', '', `${job.index}. ${job.section.title.trim() || `Chapter ${job.index}`}`),
            el('span', 'muted', job.error || job.detail)),
          retry);
      }));
    }

    async function runSingleJob(job) {
      job.state = 'running';
      job.error = null;
      const rawText = extractRangeText(parsedPdf.pages, job.section.startPage, job.section.endPage);
      const chunks = chunkChapterText(rawText, 28000);
      if (!chunks.length) {
        job.state = 'error';
        job.error = 'No selectable text in this page range.';
        renderJobs();
        return;
      }
      const previousChapters = jobs
        .slice(0, job.index - 1)
        .filter(prev => prev.result)
        .map(prev => prev.result.title);

      try {
        const parts = [];
        const allDeps = new Set();
        const allCards = [];
        let finalTitle = job.section.title.trim() || `Chapter ${job.index}`;
        let finalDesc = '';

        for (let partIndex = 0; partIndex < chunks.length; partIndex++) {
          job.detail = chunks.length > 1
            ? `pp. ${job.section.startPage}–${job.section.endPage} · part ${partIndex + 1}/${chunks.length}…`
            : `pp. ${job.section.startPage}–${job.section.endPage}…`;
          renderJobs();
          const prepared = await invoke('ai_prepare_chapter', {
            ...selection,
            ...skillsPayload,
            bookTitle,
            chapterTitle: chunks.length > 1 ? `${finalTitle} (Part ${partIndex + 1}/${chunks.length})` : finalTitle,
            chapterIndex: job.index,
            totalChapters: jobs.length,
            previousChapters,
            sourceText: chunks[partIndex],
            options: chapterOptions,
          });
          if (!panel.isConnected) return;
          if (partIndex === 0) {
            finalTitle = (prepared.title || finalTitle).replace(/\s*\(Part\s+1\/\d+\)\s*$/i, '').trim() || finalTitle;
            finalDesc = prepared.description || '';
          }
          parts.push(prepared.markdown.trim());
          for (const dep of prepared.depends_on || []) allDeps.add(dep);
          for (const card of prepared.cards || []) {
            allCards.push({ front: card.front, back: card.back, chapter: finalTitle });
          }
        }

        const mergedMarkdown = parts.join('\n\n');
        const check = validateExtensionBlocks(mergedMarkdown, registry);
        const bits = [`pp. ${job.section.startPage}–${job.section.endPage}`];
        if (check.total > 0) {
          bits.push(check.invalid.length
            ? `${check.valid}/${check.total} blocks valid`
            : `${check.total} interactive block${check.total === 1 ? '' : 's'} ✓`);
        }
        if (allCards.length > 0) bits.push(`${allCards.length} card${allCards.length === 1 ? '' : 's'}`);
        job.result = {
          title: finalTitle,
          description: finalDesc || null,
          markdown: mergedMarkdown,
          depends_on: [...allDeps],
          cards: allCards,
        };
        job.state = 'done';
        job.detail = bits.join(' · ');
      } catch (error) {
        job.state = 'error';
        job.error = error?.message || String(error);
      }
      renderJobs();
    }

    function finishToReview() {
      const completed = jobs.filter(j => j.result).map(j => j.result);
      if (!completed.length) {
        showError('No chapters were generated yet.');
        return;
      }
      const allCards = completed.flatMap(ch => ch.cards || []);
      const draft = {
        title: bookTitle,
        description: introDraft.description || pdfDescInput.value.trim() || '',
        introduction: introDraft.introduction || '',
        extensions: [...selectedExtensions],
        chapters: completed.map(ch => ({
          title: ch.title,
          description: ch.description,
          markdown: ch.markdown,
          depends_on: ch.depends_on,
        })),
        cards: allCards,
      };
      pipelineHost.hidden = true;
      dropzone.hidden = false;
      pdfConfigHost.hidden = false;
      pdfSubmitBar.hidden = false;
      picker.root.hidden = false;
      modeSwitch.root.hidden = false;
      showReviewDraft(draft);
    }

    renderJobs();
    for (const job of jobs) {
      if (pdfCancelled || !panel.isConnected) break;
      await runSingleJob(job);
    }

    // Generate book overview & introduction from front matter + chapter titles.
    const completed = jobs.filter(j => j.result);
    if (completed.length && !pdfCancelled && panel.isConnected) {
      setStatus('Drafting book introduction…');
      const frontSections = parsedPdf.sections.filter(s => s.role === 'front');
      const frontText = frontSections.length
        ? frontSections.map(s => extractRangeText(parsedPdf.pages, s.startPage, s.endPage)).join('\n\n').slice(0, 12000)
        : extractRangeText(parsedPdf.pages, 1, Math.min(3, parsedPdf.numPages)).slice(0, 8000);
      try {
        const preparedIntro = await invoke('ai_prepare_book_intro', {
          ...selection,
          title: bookTitle,
          chapterTitles: completed.map(j => j.result.title),
          frontMatter: frontText,
          instructions: pdfInstrInput.value.trim() || null,
        });
        if (preparedIntro) {
          introDraft = {
            description: pdfDescInput.value.trim() || preparedIntro.description || '',
            introduction: preparedIntro.introduction || '',
          };
        }
      } catch {
        // Non-fatal: keep user's description and let them edit the introduction in review.
      }
    }

    generating = false;
    if (!panel.isConnected) return;
    cancelBtn.hidden = true;
    backToConfigBtn.hidden = false;
    reviewBtn.hidden = !completed.length;
    renderJobs();

    const anyFailed = jobs.some(j => j.state === 'error');
    if (!anyFailed && !pdfCancelled && completed.length === jobs.length) {
      finishToReview();
    } else if (pdfCancelled) {
      setStatus(`Stopped after ${completed.length} of ${jobs.length} chapters. You can review and import the completed chapters.`);
    } else if (anyFailed) {
      showError('Some chapters failed to generate. Retry failed chapters or review the completed ones.');
    }
  }

  pdfView.append(dropzone, parseProgressHost, pdfConfigHost, pipelineHost);

  const pdfSubmitBar = el('div', 'ai-actions pdf-submit-bar',
    Button({
      label: 'Generate book from PDF',
      leftIcon: 'sparkles',
      variant: 'primary',
      onClick: () => runPdfPipeline(),
    }));
  pdfSubmitBar.hidden = true;

  const setupStage = el('div', 'import-setup-stage',
    el('div', 'import-mode-bar', modeSwitch.root),
    markdownForm,
    pdfView,
    picker.root,
    pdfSubmitBar);

  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    pdfCancelled = true;
    close();
  });

  panel.append(setupStage, result, status);
  return panel;
}
