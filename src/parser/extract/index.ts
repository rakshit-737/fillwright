import { ExtractionError, MAX_RESUME_BYTES, type ExtractedText, type ResumeFormat } from './types';

export { ExtractionError, MAX_RESUME_BYTES } from './types';
export type { ExtractedText, ResumeFormat } from './types';

/**
 * Detects the format from the file's magic bytes rather than its extension.
 *
 * A resume arrives from the user's disk, but the extension should still not
 * trust a filename: a .pdf that is really a ZIP should be handled as what it is,
 * or rejected, not fed to the wrong parser.
 */
export function detectFormat(bytes: ArrayBuffer, fileName = ''): ResumeFormat {
  const head = new Uint8Array(bytes.slice(0, 8));
  const startsWith = (signature: number[]) => signature.every((byte, i) => head[i] === byte);

  if (startsWith([0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (startsWith([0x50, 0x4b, 0x03, 0x04]) || startsWith([0x50, 0x4b, 0x05, 0x06])) return 'docx';
  // Legacy OLE2 .doc — recognised so we can give a useful message.
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0])) return 'unknown';

  if (/\.txt$|\.md$|\.text$/i.test(fileName)) return 'txt';
  // Anything that decodes as mostly printable text is treated as plain text.
  return looksLikeText(bytes) ? 'txt' : 'unknown';
}

function looksLikeText(bytes: ArrayBuffer): boolean {
  const sample = new Uint8Array(bytes.slice(0, 2048));
  if (sample.length === 0) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte !== 0x7f)) {
      printable++;
    }
  }
  return printable / sample.length > 0.9;
}

// A UTF-8 byte order mark survives decoding and would corrupt the first field.
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

export function extractTxt(bytes: ArrayBuffer): ExtractedText {
  // UTF-8 with a lenient decoder: a stray invalid byte should not lose a resume.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(BOM_RE, '');
  if (!text.trim()) throw new ExtractionError('This file is empty.', 'EEMPTY');
  return { format: 'txt', text, warnings: [], pageCount: 1 };
}

/**
 * Extracts plain text from a resume file. Runs entirely in the page that called
 * it — no bytes are sent anywhere.
 */
export async function extractResumeText(bytes: ArrayBuffer, fileName = ''): Promise<ExtractedText> {
  if (bytes.byteLength === 0) throw new ExtractionError('This file is empty.', 'EEMPTY');
  if (bytes.byteLength > MAX_RESUME_BYTES) {
    throw new ExtractionError(
      `This file is larger than ${Math.round(MAX_RESUME_BYTES / 1024 / 1024)} MB. Resumes are normally well under 1 MB.`,
      'ETOOLARGE',
    );
  }

  switch (detectFormat(bytes, fileName)) {
    case 'pdf': {
      // pdf.js is ~350 KB. Loading it lazily keeps the options page fast for
      // the majority of visits, which never touch a PDF. The chunk is bundled
      // with the extension — this is a local import, not a network fetch.
      const { extractPdf } = await import('./pdf');
      return extractPdf(bytes);
    }
    case 'docx': {
      const { extractDocx } = await import('./docx');
      return extractDocx(bytes);
    }
    case 'txt':
      return extractTxt(bytes);
    default:
      throw new ExtractionError(
        'Fillwright reads PDF, DOCX and plain text. Older .doc files need to be re-saved as .docx, or you can paste the text.',
        'EUNSUPPORTED',
      );
  }
}
