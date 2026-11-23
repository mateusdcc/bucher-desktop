/**
 * Pure PDF text cleaning, chapter segmentation, and context-safe chunking.
 *
 * Kept free of browser/PDF.js dependencies so it can be unit-tested directly
 * in Node and shared cleanly across the import pipeline.
 *
 * @module pdf/pdf-segment
 */

const BACK_MATTER_RE = /^(?:index|bibliography|references|works\s+cited|colophon|glossary|list\s+of\s+(?:figures|tables)|acknowledg(?:e)?ments?|about\s+the\s+authors?)$/i;
const FRONT_MATTER_RE = /^(?:cover|title\s+page|copyright|dedication|table\s+of\s+contents|contents|preface|foreword|how\s+to\s+use\s+this\s+book)$/i;
const PART_RE = /^(?:part|section|unit|book)\s+(?:[IVXLC]+|\d+)\b/i;
const CHAPTER_HEADING_RE = /^(?:chapter\s+(?:\d+|[IVXLC]+)|(?:ch\.|cap[ií]tulo|kapitel)\s*\d+|\d{1,2}\.?\s+[A-Z][\w\s,:-]{3,70})$/i;

/**
 * Sanitize a candidate book title so it is a valid Bücher folder name.
 *
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeBookTitle(raw) {
  const cleaned = String(raw || '')
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return cleaned || 'Imported PDF Book';
}

/**
 * Clean extracted per-page lines: remove repetitive running headers/footers,
 * lone page numbers, and de-hyphenate wrapped prose lines.
 *
 * @param {Array<{ pageNumber: number, lines: string[] }>} rawPages
 * @returns {Array<{ pageNumber: number, text: string, lines: string[], charCount: number }>}
 */
export function cleanExtractedPages(rawPages) {
  const total = rawPages.length;
  /** @type {Map<string, number>} */
  const edgeCounts = new Map();
  if (total >= 6) {
    for (const page of rawPages) {
      const nonEmpty = page.lines.map(line => line.trim()).filter(Boolean);
      if (!nonEmpty.length) continue;
      const edges = new Set([nonEmpty[0], nonEmpty[nonEmpty.length - 1]]);
      for (const edge of edges) {
        const normalized = edge.replace(/\b\d+\b/g, '#');
        edgeCounts.set(normalized, (edgeCounts.get(normalized) ?? 0) + 1);
      }
    }
  }
  const threshold = Math.max(3, Math.ceil(total * 0.4));

  return rawPages.map(page => {
    const filtered = [];
    const lines = page.lines;
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      const trimmed = raw.trim();
      const isEdge = index === 0 || index === lines.length - 1;
      if (isEdge && /^\d{1,4}$/.test(trimmed)) continue;
      if (isEdge && total >= 6) {
        const normalized = trimmed.replace(/\b\d+\b/g, '#');
        if ((edgeCounts.get(normalized) ?? 0) >= threshold) continue;
      }
      filtered.push(raw);
    }

    // Rejoin hyphenated word wraps (e.g. "statis-\ntics" -> "statistics")
    // while preserving blank lines, Markdown headings, and code indentation.
    const merged = [];
    for (let i = 0; i < filtered.length; i++) {
      let line = filtered[i];
      while (
        i + 1 < filtered.length &&
        /[a-zA-Z]{2,}-$/.test(line.trimEnd()) &&
        /^[a-z]/.test(filtered[i + 1].trimStart()) &&
        !/^ {4}|\t/.test(line)
      ) {
        line = line.replace(/-\s*$/, '') + filtered[i + 1].trimStart();
        i += 1;
      }
      merged.push(line);
    }

    const text = merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      pageNumber: page.pageNumber,
      text,
      lines: merged,
      charCount: text.length,
    };
  });
}

/**
 * Flatten a PDF outline into chapter-level entries. If top-level entries are
 * broad "Part I / Part II" containers with nested chapters, promote the
 * chapters so each unit stays focused and context-friendly.
 *
 * @param {Array<{ title: string, pageNumber: number, level: number }>} outline
 * @param {number} numPages
 * @returns {Array<{ title: string, pageNumber: number, level: number }>}
 */
function chooseOutlineLevel(outline, numPages) {
  const valid = outline
    .filter(item => item && typeof item.title === 'string' && item.title.trim() && Number.isInteger(item.pageNumber) && item.pageNumber >= 1 && item.pageNumber <= numPages)
    .map(item => ({ title: item.title.trim().replace(/\s+/g, ' '), pageNumber: item.pageNumber, level: item.level ?? 0 }));
  if (!valid.length) return [];

  const level0 = valid.filter(item => item.level === 0);
  const level1 = valid.filter(item => item.level === 1);
  // Promote level-1 chapters when level-0 consists mostly of Part wrappers or has very few huge sections.
  const partHeavy = level0.length > 0 && level0.filter(item => PART_RE.test(item.title)).length >= Math.max(1, Math.floor(level0.length * 0.4));
  const avgSpan = level0.length ? numPages / level0.length : numPages;
  const chosen = (level1.length >= 3 && (partHeavy || (level0.length <= 5 && avgSpan > 35)))
    ? valid.filter(item => item.level <= 1 && !PART_RE.test(item.title))
    : level0;

  // Deduplicate entries pointing to the exact same start page (keep the first meaningful title).
  const sorted = [...chosen].sort((a, b) => a.pageNumber - b.pageNumber);
  const deduped = [];
  for (const item of sorted) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.pageNumber === item.pageNumber) continue;
    deduped.push(item);
  }
  return deduped;
}

/**
 * Segment pages using PDF outline bookmarks.
 *
 * @param {Array<{ pageNumber: number, text: string, charCount: number }>} pages
 * @param {Array<{ title: string, pageNumber: number, level: number }>} outline
 * @returns {Array<{ id: string, title: string, startPage: number, endPage: number, included: boolean, role: 'front'|'chapter'|'back', charCount: number }> | null}
 */
export function segmentFromOutline(pages, outline) {
  const numPages = pages.length;
  if (!numPages || !outline?.length) return null;
  const entries = chooseOutlineLevel(outline, numPages);
  if (entries.length < 2) return null;

  const sections = [];
  if (entries[0].pageNumber > 1) {
    const startPage = 1;
    const endPage = entries[0].pageNumber - 1;
    const chars = rangeCharCount(pages, startPage, endPage);
    if (chars > 120) {
      sections.push({
        id: `sec-front-${startPage}`,
        title: 'Front Matter & Preface',
        startPage,
        endPage,
        included: false,
        role: 'front',
        charCount: chars,
      });
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const next = entries[i + 1];
    const startPage = entry.pageNumber;
    const endPage = next ? Math.max(startPage, next.pageNumber - 1) : numPages;
    const isBack = BACK_MATTER_RE.test(entry.title);
    const isFront = FRONT_MATTER_RE.test(entry.title);
    const role = isBack ? 'back' : isFront ? 'front' : 'chapter';
    sections.push({
      id: `sec-${i + 1}-${startPage}`,
      title: entry.title,
      startPage,
      endPage,
      included: role === 'chapter',
      role,
      charCount: rangeCharCount(pages, startPage, endPage),
    });
  }

  // Ensure at least one section is included by default.
  if (!sections.some(section => section.included) && sections.length) {
    sections.forEach(section => { section.included = true; });
  }
  return sections;
}

/**
 * Fallback segmentation when a PDF has no outline: scan top lines of each page
 * for chapter headings (or Markdown `#` heading markers emitted by font-size analysis).
 *
 * @param {Array<{ pageNumber: number, text: string, lines: string[], charCount: number }>} pages
 * @returns {Array<{ id: string, title: string, startPage: number, endPage: number, included: boolean, role: 'front'|'chapter'|'back', charCount: number }> | null}
 */
export function segmentFromHeadings(pages) {
  const numPages = pages.length;
  if (numPages < 2) return null;
  /** @type {Array<{ title: string, pageNumber: number }>} */
  const hits = [];
  for (const page of pages) {
    const topLines = page.lines.map(l => l.trim()).filter(Boolean).slice(0, 6);
    for (let i = 0; i < topLines.length; i++) {
      const clean = topLines[i].replace(/^#+\s*/, '').trim();
      if (!clean || clean.length < 3 || clean.length > 90) continue;
      if (/^chapter\s+(?:\d+|[IVXLC]+)\b/i.test(clean)) {
        // Combine "Chapter 1" + subtitle on next line if present.
        const nextLine = topLines[i + 1]?.replace(/^#+\s*/, '').trim() || '';
        const title = clean.length < 18 && nextLine && nextLine.length < 70 && !/[.;]$/.test(nextLine)
          ? `${clean}: ${nextLine}`
          : clean;
        hits.push({ title, pageNumber: page.pageNumber });
        break;
      }
      if (topLines[i].startsWith('# ') && CHAPTER_HEADING_RE.test(clean)) {
        hits.push({ title: clean, pageNumber: page.pageNumber });
        break;
      }
    }
  }
  if (hits.length < 2) return null;
  return segmentFromOutline(pages, hits.map(hit => ({ ...hit, level: 0 })));
}

/**
 * Fallback segmentation: fixed-size page chunks so flat or scanned-OCR PDFs
 * still convert cleanly without exceeding context limits.
 *
 * @param {Array<{ pageNumber: number, text: string, charCount: number }>} pages
 * @param {number} [pagesPerChunk]
 */
export function segmentByPageChunks(pages, pagesPerChunk = 12) {
  const numPages = pages.length;
  if (!numPages) return [];
  const size = Math.max(1, Math.round(pagesPerChunk));
  const sections = [];
  for (let start = 1, index = 1; start <= numPages; start += size, index += 1) {
    const end = Math.min(numPages, start + size - 1);
    const label = numPages <= size
      ? 'Full Document'
      : `Section ${index} (pp. ${start}–${end})`;
    sections.push({
      id: `chunk-${index}-${start}`,
      title: label,
      startPage: start,
      endPage: end,
      included: true,
      role: /** @type {'chapter'} */ ('chapter'),
      charCount: rangeCharCount(pages, start, end),
    });
  }
  return sections;
}

/**
 * Automatically pick the best segmentation strategy for a PDF.
 *
 * @param {Array<{ pageNumber: number, text: string, lines: string[], charCount: number }>} pages
 * @param {Array<{ title: string, pageNumber: number, level: number }>} outline
 * @returns {{ strategy: 'outline'|'headings'|'chunks', sections: Array<{ id: string, title: string, startPage: number, endPage: number, included: boolean, role: 'front'|'chapter'|'back', charCount: number }> }}
 */
export function autoSegmentPdf(pages, outline = []) {
  const fromOutline = segmentFromOutline(pages, outline);
  if (fromOutline) return { strategy: 'outline', sections: fromOutline };
  const fromHeadings = segmentFromHeadings(pages);
  if (fromHeadings) return { strategy: 'headings', sections: fromHeadings };
  return { strategy: 'chunks', sections: segmentByPageChunks(pages) };
}

/**
 * Concatenate extracted page text for a 1-based inclusive page range.
 *
 * @param {Array<{ pageNumber: number, text: string }>} pages
 * @param {number} startPage
 * @param {number} endPage
 * @returns {string}
 */
export function extractRangeText(pages, startPage, endPage) {
  return pages
    .filter(page => page.pageNumber >= startPage && page.pageNumber <= endPage && page.text)
    .map(page => `[Page ${page.pageNumber}]\n${page.text}`)
    .join('\n\n');
}

/**
 * Split a very large chapter into context-safe chunks along paragraph boundaries
 * so even a 60-page textbook chapter converts cleanly without truncation.
 *
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function chunkChapterText(text, maxChars = 28000) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      for (let offset = 0; offset < para.length; offset += maxChars) {
        chunks.push(para.slice(offset, offset + maxChars).trim());
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Build a concise sample across the book (title + chapter names + excerpts from
 * beginning, middle, and end) for extension recommendation.
 *
 * @param {string} title
 * @param {Array<{ title: string }>} sections
 * @param {Array<{ text: string }>} pages
 * @returns {string}
 */
export function buildAnalysisSample(title, sections, pages) {
  const parts = [title, sections.map(s => s.title).join('\n')];
  if (pages.length) {
    const indices = new Set([
      0, 1, 2,
      Math.floor(pages.length * 0.25),
      Math.floor(pages.length * 0.5),
      Math.floor(pages.length * 0.75),
      pages.length - 1,
    ]);
    for (const idx of indices) {
      const page = pages[idx];
      if (page?.text) parts.push(page.text.slice(0, 2000));
    }
  }
  return parts.join('\n\n');
}

/**
 * @param {Array<{ pageNumber: number, charCount: number }>} pages
 * @param {number} startPage
 * @param {number} endPage
 */
function rangeCharCount(pages, startPage, endPage) {
  let sum = 0;
  for (const page of pages) {
    if (page.pageNumber >= startPage && page.pageNumber <= endPage) sum += page.charCount;
  }
  return sum;
}
