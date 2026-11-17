const { stripFrontmatter } = require('./intro-model');
const { flattenConcepts } = require('./buch-model');
const { stripSpeechMarkup } = require('./language');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const RATINGS = [
  { rating: 1, label: 'Again', key: '1' },
  { rating: 2, label: 'Hard', key: '2' },
  { rating: 3, label: 'Good', key: '3' },
  { rating: 4, label: 'Easy', key: '4' },
];
const AUDIO_RE = /!\[\[([^\]|]+?\.(?:mp3|wav|ogg|m4a|webm|aac|flac))(?:\|[^\]]*)?\]\]/i;
const CLOZE_RE = /==((?:\\=|[^=\r\n])+?)==/g;
const CARD_CALLOUTS = new Set(['card', 'flashcard', 'vocab', 'phrase']);
const FLASHCARD_TAG_RE = /(?:^|\s)#(?:flashcards?|cards?)(?:\/[\w-]+)?(?=\s|$)/i;
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Format a millisecond interval for FSRS review buttons. */
function formatInterval(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

/** Schedule the next FSRS state for a card given rating 1..4. */
function reviewCard(record, rating, now = Date.now()) {
  const r = clamp(Math.round(Number(rating) || 3), 1, 4);
  const current = record && typeof record === 'object' ? record : null;
  const reps = Number(current?.reps) || 0;
  const lapses = Number(current?.lapses) || 0;
  const prevS = Number(current?.stability) || 0;
  const prevD = Number(current?.difficulty) || 0;

  if (!current || reps === 0 || !prevS) {
    const initialS = [0.007, 0.25, 1, 4][r - 1]; // ~10m, 6h, 1d, 4d in days
    const initialD = clamp(7 - (r - 1) * 1.15, 1, 10);
    const intervalMs = r === 1 ? 10 * MINUTE : r === 2 ? 6 * 60 * MINUTE : initialS * DAY;
    return {
      due: now + intervalMs,
      stability: Number(initialS.toFixed(4)),
      difficulty: Number(initialD.toFixed(3)),
      reps: 1,
      lapses: r === 1 ? lapses + 1 : lapses,
      state: r <= 2 ? 'learning' : 'review',
      lastReview: now,
    };
  }

  const elapsedDays = Math.max(0, (now - (Number(current.lastReview) || now)) / DAY);
  const retrievability = Math.pow(1 + (19 / 81) * (elapsedDays / Math.max(0.05, prevS)), -0.5);
  const deltaD = 0.85 * (3 - r);
  const difficulty = Number(clamp(prevD + deltaD + 0.1 * (5 - prevD), 1, 10).toFixed(3));

  if (r === 1) {
    const stability = Number(Math.max(0.25, prevS * 0.3).toFixed(4));
    return {
      due: now + 10 * MINUTE,
      stability,
      difficulty,
      reps: reps + 1,
      lapses: lapses + 1,
      state: 'relearning',
      lastReview: now,
    };
  }

  const ratingFactor = r === 2 ? 0.55 : r === 4 ? 1.55 : 1;
  const gain = Math.exp(0.55) * (11 - difficulty) * Math.pow(Math.max(0.25, prevS), -0.15) * (Math.exp(1.2 * (1 - retrievability)) - 1);
  const minGrow = r === 2 ? Math.max(0.5, prevS * 1.15) : Math.max(1, prevS * (r === 4 ? 1.6 : 1.25));
  const stability = Number(Math.max(minGrow, prevS * (1 + gain * ratingFactor)).toFixed(4));
  const intervalDays = clamp(Math.round(stability), r === 2 ? 1 : r === 3 ? 1 : 2, 3650);
  return {
    due: now + intervalDays * DAY,
    stability,
    difficulty,
    reps: reps + 1,
    lapses,
    state: 'review',
    lastReview: now,
  };
}

function previewIntervals(record, now = Date.now()) {
  return RATINGS.map(item => {
    const next = reviewCard(record, item.rating, now);
    return { ...item, ms: Math.max(MINUTE, next.due - now), labelText: formatInterval(next.due - now) };
  });
}

function isDue(record, now = Date.now()) {
  if (!record || !record.reps) return true;
  return Number(record.due) <= now;
}

function hasFlashcardFrontmatter(text) {
  const fm = text.match(FRONTMATTER_RE)?.[1] ?? '';
  return /(?:^|\n)\s*-\s*flashcards?\b/i.test(fm) || /(?:^|\n)tags\s*:[^\n]*\bflashcards?\b/i.test(fm);
}

function stripProtectedSpans(line) {
  return line
    .replace(/`+[^`]*`+/g, m => ' '.repeat(m.length))
    .replace(/\$\$?[^$\r\n]*\$\$?/g, m => ' '.repeat(m.length))
    .replace(/https?:\/\/\S+/gi, m => ' '.repeat(m.length));
}

function extractTags(text) {
  return [...new Set((text.match(/(?:^|\s)(#[a-zA-Z][\w/-]*)/g) ?? []).map(tag => tag.trim()))];
}

function cleanCardText(text) {
  return text.replace(/(?:^|\s)#(?:flashcards?|cards?)(?:\/[\w-]+)?(?=\s|$)/gi, ' ').replace(/\s\^[\w-]+$/, '').trim();
}

function splitClozeParts(raw) {
  const sep = raw.indexOf(';;');
  if (sep < 0) return { answer: raw.trim(), hint: '' };
  return { answer: raw.slice(0, sep).trim(), hint: raw.slice(sep + 2).trim() };
}

function buildClozeCards(blockText, baseMeta, register) {
  const matches = [...blockText.matchAll(CLOZE_RE)];
  if (!matches.length) return false;
  const allowWithoutHint = baseMeta.clozeEligible;
  const hasExplicitHint = matches.some(m => m[1].includes(';;'));
  if (!allowWithoutHint && !hasExplicitHint) return false;

  matches.forEach((active, index) => {
    const { answer, hint } = splitClozeParts(active[1]);
    if (!answer) return;
    let cursor = 0;
    let masked = '';
    let revealed = '';
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      masked += blockText.slice(cursor, m.index);
      revealed += blockText.slice(cursor, m.index);
      const parts = splitClozeParts(m[1]);
      if (i === index) {
        masked += hint ? `[${hint}]` : '[…]';
        revealed += `**${parts.answer}**`;
      } else {
        masked += parts.answer;
        revealed += parts.answer;
      }
      cursor = m.index + m[0].length;
    }
    masked += blockText.slice(cursor);
    revealed += blockText.slice(cursor);
    register('cloze', cleanCardText(masked), cleanCardText(revealed), {
      ...baseMeta,
      clozeAnswer: answer,
      hint,
      speakTextSource: cleanCardText(revealed),
    });
  });
  return true;
}

/** Parse Obsidian Spaced Repetition & Bücher flashcards from a Markdown file. */
function parseFlashcards(file, text, chapterName = '') {
  const body = stripFrontmatter(text, false);
  const startOffset = text.length - body.length;
  const baseLine = text.slice(0, startOffset).split('\n').length;
  const lines = body.split(/\r?\n/);
  const filePath = file.path;
  const isCardFile = /(?:^|\/)_cards\.md$/i.test(filePath) || hasFlashcardFrontmatter(text);
  const cards = [];
  const seenIds = new Map();

  const register = (direction, front, back, meta) => {
    const cleanFront = cleanCardText(front);
    const cleanBack = cleanCardText(back);
    if (!cleanFront || !cleanBack) return;
    const baseId = `${filePath}#${direction}:${hashText(`${cleanFront}\n${cleanBack}`)}`;
    const count = (seenIds.get(baseId) ?? 0) + 1;
    seenIds.set(baseId, count);
    const id = count > 1 ? `${baseId}:${count}` : baseId;
    const audioMatch = cleanFront.match(AUDIO_RE) ?? cleanBack.match(AUDIO_RE) ?? meta.example?.match(AUDIO_RE);
    cards.push({
      id,
      file,
      filePath,
      chapterName: chapterName || file.basename || file.name?.replace(/\.md$/i, '') || filePath,
      sectionTitle: meta.sectionTitle ?? '',
      line: meta.line,
      direction,
      front: cleanFront,
      back: cleanBack,
      example: meta.example ?? '',
      hint: meta.hint ?? '',
      clozeAnswer: meta.clozeAnswer ?? '',
      speakSource: meta.speakSource ?? cleanFront,
      audio: audioMatch?.[1] ?? '',
      tags: meta.tags ?? [],
    });
  };

  let inFence = false;
  let fenceChar = '';
  let inMath = false;
  let sectionTitle = '';
  let calloutType = '';
  let calloutTags = [];
  let deckTagged = isCardFile;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) { inFence = true; fenceChar = fence[1][0]; }
      else if (fence[1][0] === fenceChar) { inFence = false; fenceChar = ''; }
      continue;
    }
    if (inFence) continue;
    if (/^\$\$/.test(trimmed)) {
      if (!/^\$\$[\s\S]+\$\$$/.test(trimmed)) inMath = !inMath;
      continue;
    }
    if (inMath) continue;

    const heading = trimmed.match(/^#{1,6}\s+(.+)/);
    if (heading) {
      sectionTitle = heading[1].replace(/\s+#+\s*$/, '').trim();
      calloutType = '';
      calloutTags = [];
      continue;
    }

    const callout = rawLine.match(/^ {0,3}>\s*\[!([\w-]+)\][-+]?[^\S\r\n]*(.*)/);
    if (callout) {
      calloutType = callout[1].toLowerCase();
      calloutTags = extractTags(callout[2]);
      continue;
    }
    if (!rawLine.startsWith('>')) {
      calloutType = '';
      calloutTags = [];
    }
    if (FLASHCARD_TAG_RE.test(rawLine)) deckTagged = true;

    const unwrapped = rawLine.startsWith('>') ? rawLine.replace(/^ {0,3}>\s?/, '') : rawLine;
    const lineTrim = unwrapped.trim();
    if (!lineTrim || lineTrim === '---' || lineTrim.startsWith('<!--')) continue;

    // 1. Multiline ? or ?? card
    if (lineTrim === '?' || lineTrim === '??') {
      const reversible = lineTrim === '??';
      const frontLines = [];
      for (let j = i - 1; j >= 0; j--) {
        const prev = (lines[j].startsWith('>') ? lines[j].replace(/^ {0,3}>\s?/, '') : lines[j]).trim();
        if (!prev || prev === '---' || /^#{1,6}\s/.test(prev) || /^\[![\w-]+\]/.test(prev) || prev === '?' || prev === '??') break;
        frontLines.unshift(prev);
      }
      const backLines = [];
      let endIdx = i;
      for (let j = i + 1; j < lines.length; j++) {
        const nextRaw = lines[j];
        const next = (nextRaw.startsWith('>') ? nextRaw.replace(/^ {0,3}>\s?/, '') : nextRaw).trim();
        if (!next || next === '---' || /^#{1,6}\s/.test(next) || next === '?' || next === '??') break;
        backLines.push(next);
        endIdx = j;
      }
      if (frontLines.length && backLines.length) {
        const front = frontLines.join('\n');
        const back = backLines.join('\n');
        const tags = [...new Set([...calloutTags, ...extractTags(`${front}\n${back}`)])];
        const lineNo = baseLine + i - frontLines.length;
        register('forward', front, back, { sectionTitle, line: lineNo, tags, speakSource: front });
        if (reversible) register('reverse', back, front, { sectionTitle, line: lineNo, tags, speakSource: back });
        i = endIdx;
        continue;
      }
    }

    // Look ahead one line for an optional example sentence line (e.g. `> Example: ...` or `- Example: ...`)
    const nextRaw = lines[i + 1] ?? '';
    const nextUnwrapped = (nextRaw.startsWith('>') ? nextRaw.replace(/^ {0,3}>\s?/, '') : nextRaw)
      .trim()
      .replace(/^[-*+]\s+/, '');
    const example = /^(?:Example|Exemplo|Sentence|Frase)\s*:/i.test(nextUnwrapped)
      ? nextUnwrapped.replace(/^(?:Example|Exemplo|Sentence|Frase)\s*:\s*/i, '')
      : '';

    // 2. Single-line ::: (reversible) or :: (forward)
    const cleanSpan = stripProtectedSpans(unwrapped);
    const revIdx = cleanSpan.indexOf(':::');
    if (revIdx > 0 && revIdx + 3 < cleanSpan.length) {
      const left = unwrapped.slice(0, revIdx).replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '').trim();
      const right = unwrapped.slice(revIdx + 3).trim();
      if (left && right) {
        const tags = [...new Set([...calloutTags, ...extractTags(unwrapped)])];
        const meta = { sectionTitle, line: baseLine + i, example, tags };
        register('forward', left, right, { ...meta, speakSource: left });
        register('reverse', right, left, { ...meta, speakSource: left });
        continue;
      }
    }
    const singleIdx = cleanSpan.indexOf('::');
    if (singleIdx > 0 && singleIdx + 2 < cleanSpan.length && cleanSpan[singleIdx - 1] !== ':' && cleanSpan[singleIdx + 2] !== ':') {
      const left = unwrapped.slice(0, singleIdx).replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '').trim();
      const right = unwrapped.slice(singleIdx + 2).trim();
      if (left && right) {
        const tags = [...new Set([...calloutTags, ...extractTags(unwrapped)])];
        register('forward', left, right, { sectionTitle, line: baseLine + i, example, tags, speakSource: left });
        continue;
      }
    }

    // 3. Cloze deletions
    if (CLOZE_RE.test(unwrapped)) {
      CLOZE_RE.lastIndex = 0;
      const clozeEligible = deckTagged || CARD_CALLOUTS.has(calloutType) || FLASHCARD_TAG_RE.test(unwrapped);
      buildClozeCards(unwrapped.replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, ''), {
        sectionTitle,
        line: baseLine + i,
        example,
        tags: [...new Set([...calloutTags, ...extractTags(unwrapped)])],
        clozeEligible,
      }, register);
    }
  }
  return cards;
}

/** Collect all flashcards across a Buch's chapters plus `_cards.md` and `_notes.md`. */
async function collectBookCards(app, book, extraPaths = ['_cards.md', '_notes.md']) {
  const concepts = flattenConcepts(book?.concepts ?? []);
  const files = concepts.map(concept => ({ file: concept.file, name: concept.name }));
  for (const suffix of extraPaths) {
    const extra = app.vault.getAbstractFileByPath(`${book.path}/${suffix}`);
    if (extra && !Array.isArray(extra.children)) {
      files.push({ file: extra, name: suffix === '_cards.md' ? 'Flashcards' : 'Quick notes' });
    }
  }
  const groups = await Promise.all(files.map(async ({ file, name }) => {
    const text = await (app.vault.cachedRead ?? app.vault.read).call(app.vault, file);
    return parseFlashcards(file, text, name);
  }));
  return groups.flat();
}

function normalizeAnswer(text) {
  return stripSpeechMarkup(text)
    .toLowerCase()
    .replace(/[.,!?;:"'()[\]{}¡¿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compare a typed recall answer against an expected answer. */
function checkTypedAnswer(input, expected) {
  const actual = normalizeAnswer(input);
  const target = normalizeAnswer(expected);
  if (!actual || !target) return 'mismatch';
  if (actual === target) return 'exact';
  const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '');
  if (fold(actual) === fold(target)) return 'close';
  return 'mismatch';
}

module.exports = {
  RATINGS,
  formatInterval,
  reviewCard,
  previewIntervals,
  isDue,
  parseFlashcards,
  collectBookCards,
  checkTypedAnswer,
};
