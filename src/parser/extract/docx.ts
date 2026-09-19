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
  let declaredTotal = 0;
  try {
    files = unzipSync(new Uint8Array(bytes), {
      // A resume is an untrusted file (SECURITY.md §3.2), and a ZIP entry can
      // inflate a thousandfold. fflate inflates each entry into a buffer of its
      // declared size and no larger, so capping the declared sizes caps the
      // output — a header that lies about its size only truncates the entry.
      filter: (file) => {
        if (!DOC_PARTS.test(file.name)) return false;
        declaredTotal += file.originalSize;
        // Deflate never grows data by more than a few bytes per block, so an
        // entry whose compressed size exceeds its declared size is lying about
        // it — and fflate would still inflate the whole stream to find out.
        const lying = file.size > file.originalSize + (file.originalSize >> 6) + 1024;
        if (lying || file.originalSize > MAX_PART_BYTES || declaredTotal > MAX_TOTAL_BYTES) {
          throw new ExtractionError(TOO_LARGE, 'ETOOLARGE');
        }
        return true;
      },
    });
  } catch (cause) {
    if (cause instanceof ExtractionError) throw cause;
    throw new ExtractionError('This file could not be read as a Word document.', 'ECORRUPT');
  }

  // Belt and braces: never trust more output than the caps allow.
  let total = 0;
  for (const data of Object.values(files)) {
    total += data.length;
    if (data.length > MAX_PART_BYTES || total > MAX_TOTAL_BYTES) {
      throw new ExtractionError(TOO_LARGE, 'ETOOLARGE');
    }
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

  const text = parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    throw new ExtractionError(
      'This Word document appears to contain no text. Paste the text instead.',
      'EEMPTY',
    );
  }

  const rels = files['word/_rels/document.xml.rels'];
  const links = rels ? hyperlinkTargets(strFromU8(rels)) : [];

  return { format: 'docx', text, warnings, pageCount: 1, links };
}

const DOC_PARTS = /^word\/(?:(?:document|header\d*|footer\d*)\.xml|_rels\/document\.xml\.rels)$/;

/** No real resume part comes near this once inflated. */
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_LINKS = 50;
const TOO_LARGE =
  'This Word document expands to far more data than a resume holds, so it was not opened.';

/**
 * External http(s) hyperlink targets from a relationships part. "LinkedIn" as
 * a clickable word keeps its URL here, not in the text. Anything that is not a
 * web link (file:, mailto:, internal anchors) is dropped.
 */
export function hyperlinkTargets(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<Relationship\s([^>]*)>/g)) {
    const attrs = match[1] ?? '';
    const type = /\bType="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const target = decodeEntities(/\bTarget="([^"]*)"/.exec(attrs)?.[1] ?? '').trim();
    if (!/\/hyperlink$/.test(type)) continue;
    if (target.length > 2048 || !/^https?:\/\//i.test(target)) continue;
    if (!out.includes(target)) out.push(target);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

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
  /**
   * Depth inside <mc:Fallback>. Word stores a text box twice — the modern shape
   * in mc:Choice and a VML copy in mc:Fallback — so reading both duplicates the
   * contact block a designed resume keeps there.
   */
  let fallbackDepth = 0;

  while ((match = tag.exec(xml)) !== null) {
    if (inTextRun && fallbackDepth === 0) {
      out += decodeEntities(xml.slice(lastIndex, match.index));
    }
    lastIndex = tag.lastIndex;

    const raw = match[1] ?? '';
    const name = raw.replace(/^\//, '').split(/[\s/>]/)[0] ?? '';
    const closing = raw.startsWith('/');
    const selfClosing = raw.endsWith('/');

    if (name === 'mc:Fallback') {
      if (closing) fallbackDepth = Math.max(0, fallbackDepth - 1);
      else if (!selfClosing) fallbackDepth++;
      continue;
    }
    if (fallbackDepth > 0) continue;

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
    .map((line) =>
      line
        .replace(/\t+/g, '\t')
        .replace(/[ \t]+$/, '')
        .trimEnd(),
    )
    .filter(
      (line, index, all) => line.trim().length > 0 || (all[index - 1] ?? '').trim().length > 0,
    )
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
