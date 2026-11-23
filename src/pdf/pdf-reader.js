/**
 * Local PDF book parser powered by self-hosted PDF.js (`pdfjs-dist`).
 *
 * Lazily imports `pdfjs-dist/legacy/build/pdf.mjs` only when the user imports
 * a PDF so normal reader startup pays zero bundle/parse cost.
 *
 * @module pdf/pdf-reader
 */
import {
  autoSegmentPdf,
  buildAnalysisSample,
  cleanExtractedPages,
  sanitizeBookTitle,
} from './pdf-segment.js';

let pdfjsPromise = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(mod => {
      if (typeof window !== 'undefined' && mod.GlobalWorkerOptions) {
        mod.GlobalWorkerOptions.workerSrc = new URL('/pdf/pdf.worker.min.mjs', window.location.origin).href;
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

/**
 * Reconstruct readable lines from a PDF.js textContent item stream, preserving
 * paragraph gaps and tagging oversized heading lines with `# ` / `## ` hints.
 *
 * @param {any[]} items
 * @returns {{ lines: string[], medianFontSize: number }}
 */
function reconstructPageLines(items) {
  const spans = [];
  const sizes = [];
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const text = item.str;
    if (!text) continue;
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const fontSize = Math.hypot(transform[0], transform[1]) || Math.abs(transform[3]) || 11;
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    if (text.trim()) sizes.push(fontSize);
    spans.push({ text, x, y, width: item.width ?? 0, fontSize, hasEOL: Boolean(item.hasEOL) });
  }
  if (!spans.length) return { lines: [], medianFontSize: 11 };

  sizes.sort((a, b) => a - b);
  const medianFontSize = sizes[Math.floor(sizes.length / 2)] || 11;

  // Group spans into visual lines by baseline Y proximity.
  /** @type {Array<{ y: number, maxFont: number, spans: typeof spans }>} */
  const groups = [];
  for (const span of spans) {
    const tolerance = Math.max(2.5, span.fontSize * 0.35);
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.y - span.y) <= tolerance) {
      last.spans.push(span);
      if (span.text.trim() && span.fontSize > last.maxFont) last.maxFont = span.fontSize;
    } else {
      groups.push({ y: span.y, maxFont: span.text.trim() ? span.fontSize : 0, spans: [span] });
    }
  }

  const lines = [];
  let prevY = null;
  for (const group of groups) {
    group.spans.sort((a, b) => a.x - b.x);
    let line = '';
    let prevEnd = null;
    for (const span of group.spans) {
      if (prevEnd !== null) {
        const gap = span.x - prevEnd;
        const spaceWidth = Math.max(1.5, span.fontSize * 0.22);
        if (gap > spaceWidth && !line.endsWith(' ') && !span.text.startsWith(' ')) {
          line += ' ';
        }
      }
      line += span.text;
      prevEnd = span.x + span.width;
    }
    const trimmed = line.replace(/[ \t]+/g, ' ').trim();
    if (!trimmed) continue;

    // Insert a paragraph break on large vertical jumps.
    if (prevY !== null) {
      const verticalGap = Math.abs(prevY - group.y);
      if (verticalGap > medianFontSize * 1.85 && lines.length && lines[lines.length - 1] !== '') {
        lines.push('');
      }
    }
    prevY = group.y;

    // Tag clearly larger short lines as headings to aid chapter detection & AI structure.
    if (trimmed.length <= 120 && group.maxFont >= medianFontSize * 1.45) {
      lines.push(`# ${trimmed}`);
    } else if (trimmed.length <= 120 && group.maxFont >= medianFontSize * 1.2) {
      lines.push(`## ${trimmed}`);
    } else {
      lines.push(trimmed);
    }
  }
  return { lines, medianFontSize };
}

/**
 * Resolve a PDF outline tree into flat `{ title, pageNumber, level }` entries.
 *
 * @param {any} pdf
 * @param {any[] | null} outline
 * @returns {Promise<Array<{ title: string, pageNumber: number, level: number }>>}
 */
async function resolveOutline(pdf, outline) {
  if (!Array.isArray(outline) || !outline.length) return [];
  const entries = [];

  async function walk(items, level) {
    for (const item of items) {
      if (!item) continue;
      let pageNumber = null;
      try {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0];
          const index = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
          if (Number.isInteger(index) && index >= 0) pageNumber = index + 1;
        }
      } catch {
        // Ignore broken bookmark destinations and continue extracting the rest.
      }
      if (pageNumber !== null && typeof item.title === 'string' && item.title.trim()) {
        entries.push({ title: item.title.trim(), pageNumber, level });
      }
      if (Array.isArray(item.items) && item.items.length && level < 2) {
        await walk(item.items, level + 1);
      }
    }
  }

  await walk(outline, 0);
  return entries;
}

/**
 * Parse an entire PDF file into cleaned pages, metadata, and chapter sections.
 *
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {string} fileName
 * @param {(progress: { current: number, total: number, phase: string }) => void} [onProgress]
 */
export async function parsePdfBook(buffer, fileName, onProgress) {
  const pdfjs = await loadPdfJs();
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  onProgress?.({ current: 0, total: 1, phase: 'Opening PDF…' });

  const task = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const numPages = pdf.numPages;
    let infoTitle = '';
    let author = '';
    let subject = '';
    try {
      const meta = await pdf.getMetadata();
      infoTitle = String(meta?.info?.Title || '').trim();
      author = String(meta?.info?.Author || '').trim();
      subject = String(meta?.info?.Subject || '').trim();
    } catch {
      // Metadata is optional.
    }

    onProgress?.({ current: 0, total: numPages, phase: 'Reading PDF outline…' });
    let outline = [];
    try {
      outline = await resolveOutline(pdf, await pdf.getOutline());
    } catch {
      outline = [];
    }

    const rawPages = [];
    for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
      onProgress?.({ current: pageNumber, total: numPages, phase: `Extracting page ${pageNumber} of ${numPages}…` });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const { lines } = reconstructPageLines(content.items || []);
      rawPages.push({ pageNumber, lines });
      page.cleanup?.();
    }

    const pages = cleanExtractedPages(rawPages);
    const totalChars = pages.reduce((sum, p) => sum + p.charCount, 0);
    if (totalChars < 20) {
      throw new Error('No selectable text was found in this PDF. Scanned image-only PDFs need OCR before importing.');
    }

    const candidateTitle = infoTitle && !/^microsoft word|^untitled|^document/i.test(infoTitle)
      ? infoTitle
      : fileName;
    const title = sanitizeBookTitle(candidateTitle);
    const { strategy, sections } = autoSegmentPdf(pages, outline);
    const sample = buildAnalysisSample(title, sections, pages);

    return {
      fileName,
      title,
      author,
      subject,
      numPages,
      totalChars,
      outline,
      pages,
      strategy,
      sections,
      sample,
    };
  } finally {
    await pdf.destroy?.();
  }
}
