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

interface PositionedItem {
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
      data: new Uint8Array(bytes),
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

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();

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

  return { format: 'pdf', text, warnings, pageCount: document.numPages };
}

/** Groups positioned runs into lines and re-inserts the whitespace. */
export function itemsToLines(items: PositionedItem[]): string[] {
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

  return lines
    .map((line) => {
      const ordered = line.sort((a, b) => a.x - b.x);
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
