import { unzipSync, strFromU8 } from 'fflate';
import { ExtractionError, type ExtractedText } from './types';

/**
 * DOCX text extraction.
 *
 * A .docx is a ZIP holding WordprocessingML. Rather than pulling a full
 * converter (mammoth and friends bring a large dependency tree into a package
 * that handles resumes), we unzip locally and read the handful of elements that
 * carry text and structure: w:t (runs), w:p (paragraphs), w:br/w:tab, and table
 * cells. That is everything a resume's plain text needs.
 */
export function extractDocx(bytes: ArrayBuffer): ExtractedText {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes), {
      filter: (file) => DOC_PARTS.test(file.name),
    });
  } catch {
    throw new ExtractionError('This file could not be read as a Word document.', 'ECORRUPT');
  }

  const main = files['word/document.xml'];
  if (!main) {
    throw new ExtractionError(
      'This Word file has no document body. If it is a .doc, re-save it as .docx.',
      'ECORRUPT',
    );
  }

  const warnings: string[] = [];
  const parts: string[] = [xmlToText(strFromU8(main))];

  // Headers and footers often hold the contact block on designed resumes.
  for (const name of Object.keys(files).sort()) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const extra = xmlToText(strFromU8(files[name] as Uint8Array));
    if (extra.trim()) parts.push(extra);
  }

  const text = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!text) {
    throw new ExtractionError(
      'This Word document appears to contain no text. Paste the text instead.',
      'EEMPTY',
    );
  }

  return { format: 'docx', text, warnings, pageCount: 1 };
}

const DOC_PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;

/**
 * Converts WordprocessingML to plain text.
 *
 * Deliberately a scanner rather than a DOM parse: DOMParser on untrusted markup
 * inside an extension page is an unnecessary risk, and the grammar we need here
 * is tiny. Nothing from the document is ever interpreted as markup or script.
 */
export function xmlToText(xml: string): string {
  let out = '';
  const tag = /<([^>]+)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  /** Only text inside <w:t> is real content; <w:instrText> etc. is machinery. */
  let inTextRun = false;

  while ((match = tag.exec(xml)) !== null) {
    if (inTextRun) {
      out += decodeEntities(xml.slice(lastIndex, match.index));
    }
    lastIndex = tag.lastIndex;

    const raw = match[1] ?? '';
    const name = raw.replace(/^\//, '').split(/[\s/>]/)[0] ?? '';
    const closing = raw.startsWith('/');
    const selfClosing = raw.endsWith('/');

    switch (name) {
      case 'w:t':
        inTextRun = !closing && !selfClosing;
        break;
      case 'w:p':
      case 'w:tr':
        if (closing) out += '\n';
        break;
      case 'w:tc':
        // Cell boundary: a tab keeps two-column layouts from merging into one
        // run-on line, which matters for "Company        2021 – 2023" rows.
        if (closing) out += '\t';
        break;
      case 'w:br':
        out += '\n';
        break;
      case 'w:tab':
        out += '\t';
        break;
      default:
        break;
    }
  }

  return out
    .split('\n')
    .map((line) => line.replace(/\t+/g, '\t').replace(/[ \t]+$/, '').trimEnd())
    .filter((line, index, all) => line.trim().length > 0 || (all[index - 1] ?? '').trim().length > 0)
    .join('\n');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
