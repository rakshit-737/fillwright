import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { ExtractionError, type ExtractedText } from './types';

/**
 * The worker is served from the extension's own package — never a CDN — so PDF
 * parsing works offline and leaks no request when a resume is imported.
 */
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

/** Items whose baselines are within this many points belong to the same line. */
const LINE_TOLERANCE = 2.5;
/** A horizontal gap wider than this fraction of the font size implies a space. */
const SPACE_RATIO = 0.28;
/** Wider still, and the text is in a separate column or cell — use a tab. */
const COLUMN_RATIO = 1.8;
/** A gutter narrower than this, in points, is a word gap, not a column break. */
const MIN_GUTTER = 8;
/** Lines at the top of a page that may span the gutter (name, contact row). */
const MAX_HEADER_LINES = 6;
/** Web links taken from one file's annotations; more is not a resume. */
const MAX_LINKS = 50;

export interface PositionedItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extracts text from a PDF, reconstructing reading order from glyph positions.
 *
 * pdf.js hands back positioned runs, not lines: naively joining them destroys
 * the line structure that every downstream heuristic depends on. So runs are
 * bucketed by baseline, ordered left to right, and re-spaced from their gaps.
 */
export async function extractPdf(bytes: ArrayBuffer): Promise<ExtractedText> {
  const warnings: string[] = [];

  let document: pdfjs.PDFDocumentProxy;
  try {
    document = await pdfjs.getDocument({
      // A COPY, deliberately. pdf.js transfers the buffer it is given to its
      // worker thread, which detaches the original — and the caller still needs
      // those bytes afterwards to store the file. Handing over `bytes` directly
      // leaves the caller holding a dead handle, and the failure only surfaces
      // later, as a DataCloneError when the resume is written to IndexedDB.
      data: new Uint8Array(bytes.slice(0)),
      // No network access of any kind while parsing.
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      useSystemFonts: false,
      // Standard font data is only needed to *render*; we only read text.
      useWorkerFetch: false,
    }).promise;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    if (/password/i.test(message)) {
      throw new ExtractionError(
        'This PDF is password protected. Remove the password and try again.',
        'EENCRYPTED',
      );
    }
    throw new ExtractionError('This file could not be read as a PDF.', 'ECORRUPT');
  }

  const pages: string[] = [];
  const links: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      // "LinkedIn | GitHub" as clickable words keeps the URL only in the link
      // annotation, never in the text layer.
      if (links.length < MAX_LINKS) links.push(...(await linkAnnotations(page)));

      const items: PositionedItem[] = [];
      for (const raw of content.items) {
        const item = raw as TextItem;
        if (typeof item.str !== 'string' || item.str.length === 0) continue;
        const transform = item.transform as number[];
        const x = transform[4] ?? 0;
        const y = transform[5] ?? 0;
        items.push({
          text: item.str,
          x,
          y,
          width: item.width ?? 0,
          height: item.height || Math.abs(transform[3] ?? 10) || 10,
        });
      }

      // Release the page's operator list; resumes are small but a 40-page PDF
      // held entirely in memory is avoidable waste.
      page.cleanup();

      if (items.length === 0) {
        warnings.push(`Page ${pageNumber} contained no selectable text.`);
        continue;
      }

      pages.push(itemsToLines(items).join('\n'));
    }
  } finally {
    await document.destroy();
  }

  const text = pages.join('\n\n');

  if (text.trim().length === 0) {
    throw new ExtractionError(
      'This PDF has no selectable text — it is probably a scan or an image. Paste the text instead.',
      'EIMAGEONLY',
    );
  }

  return {
    format: 'pdf',
    text,
    warnings,
    pageCount: document.numPages,
    links: Array.from(new Set(links)).slice(0, MAX_LINKS),
  };
}

/**
 * The http(s) targets of a page's link annotations. A URL is data: it is only
 * ever handed to the link matcher, which re-validates it. Anything else
 * (javascript:, file:, mailto:, launch actions) is dropped here.
 */
async function linkAnnotations(page: pdfjs.PDFPageProxy): Promise<string[]> {
  if (typeof page.getAnnotations !== 'function') return [];
  let annotations: unknown[];
  try {
    annotations = await page.getAnnotations();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const raw of annotations) {
    const annotation = raw as { subtype?: unknown; url?: unknown };
    if (annotation.subtype !== 'Link' || typeof annotation.url !== 'string') continue;
    const url = annotation.url.trim();
    if (url.length > 2048 || !/^https?:\/\//i.test(url)) continue;
    out.push(url);
  }
  return out;
}

/**
 * Reads one page, column by column when it has a gutter.
 *
 * Sidebar templates put two columns side by side; joined baseline by baseline
 * they become "SKILLS<tab>EXPERIENCE", which no heading matcher accepts. So a
 * page is checked for a vertical band that no text crosses. When one exists the
 * lines above the columns (name, contact row) are read first, then the left
 * column, then the right. Otherwise the page is read exactly as before.
 */
export function pageToLines(items: PositionedItem[]): string[] {
  const lines = groupLines(items);
  for (let header = 0; header <= Math.min(MAX_HEADER_LINES, lines.length - 2); header++) {
    const body = lines.slice(header).flat();
    const gutter = findGutter(body);
    if (gutter === null) continue;
    const left = body.filter((item) => item.x + item.width <= gutter);
    const right = body.filter((item) => item.x >= gutter);
    if (!looksLikeColumns(left, right)) continue;
    return [
      ...linesToText(lines.slice(0, header)),
      ...linesToText(groupLines(left)),
      ...linesToText(groupLines(right)),
    ];
  }
  return linesToText(lines);
}

/**
 * The middle of the widest interior band no item crosses, from a 1-pt
 * histogram of item extents, or null when there is none wide enough.
 */
function findGutter(items: PositionedItem[]): number | null {
  if (items.length < 4) return null;
  const minX = Math.floor(Math.min(...items.map((item) => item.x)));
  const maxX = Math.ceil(Math.max(...items.map((item) => item.x + item.width)));
  const span = maxX - minX;
  if (span <= 0 || span > 5000) return null;

  const covered = new Uint8Array(span + 1);
  for (const item of items) {
    const from = Math.max(0, Math.floor(item.x) - minX);
    const to = Math.min(span, Math.ceil(item.x + item.width) - minX);
    for (let i = from; i <= to; i++) covered[i] = 1;
  }

  let best: { start: number; width: number } | null = null;
  let start = -1;
  for (let i = 0; i <= span; i++) {
    if (covered[i] === 0) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const width = i - start;
      if (!best || width > best.width) best = { start, width };
      start = -1;
    }
  }
  if (!best || best.width < MIN_GUTTER) return null;
  return minX + best.start + best.width / 2;
}

/**
 * Two real columns flow independently, so each has baselines the other does
 * not. A right-aligned date column, by contrast, sits on its rows' baselines;
 * splitting there would separate "Acme Corp" from "2021 – 2023".
 */
function looksLikeColumns(left: PositionedItem[], right: PositionedItem[]): boolean {
  const leftLines = groupLines(left);
  const rightLines = groupLines(right);
  if (leftLines.length < 3 || rightLines.length < 3) return false;
  // Columns start side by side. When one side begins well above the other, the
  // lines up there are a header that happens not to cross the gutter (a
  // centred name); the caller retries with them treated as the header.
  const top = (lines: PositionedItem[][]) => lines[0]![0]!.y;
  const heights = left
    .concat(right)
    .map((item) => item.height)
    .sort((a, b) => a - b);
  const lineHeight = Math.max(heights[Math.floor(heights.length / 2)] ?? 10, 6);
  if (Math.abs(top(leftLines) - top(rightLines)) > lineHeight * 2) return false;
  const baselines = (lines: PositionedItem[][]) => lines.map((line) => line[0]!.y);
  const unmatched = (mine: number[], theirs: number[]) =>
    mine.filter((y) => !theirs.some((other) => Math.abs(other - y) <= LINE_TOLERANCE)).length /
    mine.length;
  const l = baselines(leftLines);
  const r = baselines(rightLines);
  return unmatched(l, r) >= 0.25 && unmatched(r, l) >= 0.25;
}

/** Groups positioned runs into lines and re-inserts the whitespace. */
export function itemsToLines(items: PositionedItem[]): string[] {
  return pageToLines(items);
}

/** Buckets runs by baseline, top to bottom. */
function groupLines(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((a, b) => (b.y === a.y ? a.x - b.x : b.y - a.y));

  const lines: PositionedItem[][] = [];
  let current: PositionedItem[] = [];
  let currentY: number | null = null;

  for (const item of sorted) {
    if (currentY === null || Math.abs(item.y - currentY) <= LINE_TOLERANCE) {
      current.push(item);
      // Track the running baseline so a slowly drifting line stays one line.
      currentY = currentY === null ? item.y : (currentY + item.y) / 2;
    } else {
      lines.push(current);
      current = [item];
      currentY = item.y;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Orders each line left to right and re-inserts spaces and tabs. */
function linesToText(lines: PositionedItem[][]): string[] {
  return lines
    .map((line) => {
      const ordered = [...line].sort((a, b) => a.x - b.x);
      let out = '';
      let previousEnd: number | null = null;
      let previousHeight = 10;

      for (const item of ordered) {
        if (previousEnd !== null) {
          const gap = item.x - previousEnd;
          const reference = Math.max(previousHeight, item.height, 6);
          if (gap > reference * COLUMN_RATIO) out += '\t';
          else if (gap > reference * SPACE_RATIO && !/\s$/.test(out)) out += ' ';
        }
        out += item.text;
        previousEnd = item.x + item.width;
        previousHeight = item.height;
      }
      return out.replace(/[ \t]+$/, '');
    })
    .filter((line) => line.trim().length > 0);
}
