// @vitest-environment node
import { describe, expect, it, vi, beforeAll } from 'vitest';
import {
  buildAnnotationLinkPdf,
  buildTextBoxDocx,
  buildTwoColumnPdf,
  buildZipBomb,
} from './fixtures/resume-files.mjs';
import { ExtractionError } from '@/parser/extract/types';
import { itemsToLines } from '@/parser/extract/pdf';
import { parseResume } from '@/parser';

/**
 * Resume reading against generated files: real pdf.js (its Node build) and the
 * real DOCX scanner, so these fail for the reasons a user's import would.
 */

vi.mock('pdfjs-dist', async () => import('pdfjs-dist/legacy/build/pdf.mjs'));

beforeAll(async () => {
  // src/parser/extract/pdf.ts points the worker at the extension package; in
  // Node, pdf.js runs its worker in-process from the file on disk instead.
  const worker = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    .href;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
});

const buffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

async function readPdf(bytes: Uint8Array) {
  const { extractPdf } = await import('@/parser/extract/pdf');
  return extractPdf(buffer(bytes));
}

async function readDocx(bytes: Uint8Array) {
  const { extractDocx } = await import('@/parser/extract/docx');
  return extractDocx(buffer(bytes));
}

describe('a two-column PDF', () => {
  it('is read column by column, so headings stay on their own lines', async () => {
    const extracted = await readPdf(buildTwoColumnPdf());
    const lines = extracted.text.split('\n');

    expect(lines.some((line) => line.includes('\t'))).toBe(false);
    expect(lines).toContain('SKILLS');
    expect(lines).toContain('EXPERIENCE');
    // The header, spanning both columns, still comes first.
    expect(lines[0]).toBe('MEERA KRISHNAN');
    // The sidebar is read as a whole before the main column.
    expect(lines.indexOf('Marathi')).toBeLessThan(lines.indexOf('EXPERIENCE'));
  });

  it('parses into sections rather than one header block', async () => {
    const extracted = await readPdf(buildTwoColumnPdf());
    const parsed = parseResume(extracted.text);
    const kinds = parsed.sections.map((section) => section.kind);

    expect(kinds).toContain('experience');
    expect(kinds).toContain('education');
    expect(kinds).toContain('skills');
    expect(parsed.contact.fullName.value).toBe('Meera Krishnan');
    expect(parsed.experience[0]?.title ?? '').toContain('Backend Engineer');
  });
});

describe('gutter detection keeps single-column layouts intact', () => {
  const item = (text: string, x: number, y: number, width: number) => ({
    text,
    x,
    y,
    width,
    height: 10,
  });

  it('does not split right-aligned dates from their rows', () => {
    const lines = itemsToLines([
      item('Acme Corp', 50, 700, 60),
      item('2021 - 2023', 480, 700, 60),
      item('Globex', 50, 680, 40),
      item('2019 - 2021', 480, 680, 60),
      item('Initech', 50, 660, 45),
      item('2017 - 2019', 480, 660, 60),
      item('Built things', 60, 645, 70),
    ]);
    expect(lines).toEqual([
      'Acme Corp\t2021 - 2023',
      'Globex\t2019 - 2021',
      'Initech\t2017 - 2019',
      'Built things',
    ]);
  });
});

describe('links that exist only as annotations or relationships', () => {
  it('are collected from PDF link annotations and reach the parser', async () => {
    const extracted = await readPdf(buildAnnotationLinkPdf());
    expect(extracted.text).not.toContain('linkedin.com');
    expect(extracted.links).toEqual([
      'https://www.linkedin.com/in/arjun-mehta-example',
      'https://github.com/arjunmehta-example',
    ]);

    const parsed = parseResume(extracted.text, { links: extracted.links });
    expect(parsed.contact.links.linkedin.value).toBe(
      'https://www.linkedin.com/in/arjun-mehta-example',
    );
    expect(parsed.contact.links.github.value).toBe('https://github.com/arjunmehta-example');
  });

  it('are collected from DOCX hyperlink relationships, web links only', async () => {
    const extracted = await readDocx(buildTextBoxDocx());
    expect(extracted.links).toEqual([
      'https://www.linkedin.com/in/sofia-ramirez-example',
      'https://sofiaramirez.example.dev/?a=1&b=2',
    ]);
    const parsed = parseResume(extracted.text, { links: extracted.links });
    expect(parsed.contact.links.linkedin.value).toBe(
      'https://www.linkedin.com/in/sofia-ramirez-example',
    );
  });
});

describe('a DOCX with a text box', () => {
  it('reads the text box once, skipping mc:Fallback', async () => {
    const extracted = await readDocx(buildTextBoxDocx());
    expect(extracted.text.match(/sofia\.ramirez@example\.com/g)).toHaveLength(1);
    expect(extracted.text.match(/Sofía Ramírez/g)).toHaveLength(1);

    const parsed = parseResume(extracted.text);
    expect(parsed.contact.firstName.value).toBe('Sofía');
    expect(parsed.contact.lastName.value).toBe('Ramírez');
  });
});

describe('a DOCX zip bomb', () => {
  it('is refused from its declared size, quickly', async () => {
    const bomb = buildZipBomb(64);
    const started = Date.now();
    await expect(readDocx(bomb)).rejects.toMatchObject({ code: 'ETOOLARGE' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('never inflates past its declared size when the header lies', async () => {
    const bomb = buildZipBomb(64, true);
    const started = Date.now();
    let error: unknown;
    try {
      await readDocx(bomb);
    } catch (cause) {
      error = cause;
    }
    // A lying entry yields no usable text (zeros) or is refused; either way it
    // is bounded and fast.
    expect(error).toBeInstanceOf(ExtractionError);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('names beyond ASCII', () => {
  const header = (name: string) => `${name}\nperson@example.com\n\nEXPERIENCE\nEngineer\n`;

  it.each([
    ['José Álvarez', 'José', 'Álvarez'],
    ['S. R. Jeevan', 'S.', 'Jeevan'],
    ['Zoë Łukasiewicz', 'Zoë', 'Łukasiewicz'],
  ])('accepts %s', (name, first, last) => {
    const parsed = parseResume(header(name));
    expect(parsed.contact.firstName.value).toBe(first);
    expect(parsed.contact.lastName.value).toBe(last);
  });

  it('still rejects lines that are not names', () => {
    const parsed = parseResume(header('Senior Software Engineer at Globex'));
    expect(parsed.contact.firstName.value).toBe('');
  });
});
