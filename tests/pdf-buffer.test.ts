import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Regression tests for the "Saving to your profile…" hang.
 *
 * pdf.js transfers the byte buffer it is given to its worker thread, which
 * detaches the caller's ArrayBuffer. The import flow needs those bytes
 * afterwards to store the file, so handing the original over left it holding a
 * dead handle — and the failure only surfaced much later, as a DataCloneError
 * when IndexedDB tried to clone it.
 *
 * The symptom was an infinite spinner: there was no error boundary around the
 * save, so the rejection vanished and the UI never left its loading state.
 */

const getDocument = vi.fn();

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (options: { data: Uint8Array }) => getDocument(options),
}));

beforeEach(() => {
  getDocument.mockReset();
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  });
});

/** Mimics pdf.js: takes ownership of the buffer it is handed. */
function transferringPdfStub(text: string) {
  return (options: { data: Uint8Array }) => {
    // Detaching is what a real transfer to a worker does.
    structuredClone(options.data.buffer, { transfer: [options.data.buffer] });

    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [{ str: text, transform: [1, 0, 0, 1, 50, 700], width: 100, height: 11 }],
          }),
          cleanup: () => undefined,
        }),
        destroy: async () => undefined,
      }),
    };
  };
}

describe('extracting a PDF leaves the caller’s bytes usable', () => {
  it('does not detach the buffer it was given', async () => {
    getDocument.mockImplementation(transferringPdfStub('Aditi Ramachandran'));
    const { extractPdf } = await import('@/parser/extract/pdf');

    const bytes = new ArrayBuffer(2048);
    new Uint8Array(bytes).fill(42);

    const extracted = await extractPdf(bytes);
    expect(extracted.text).toContain('Aditi');

    // The whole point: the caller still needs these bytes to store the file.
    expect(bytes.byteLength).toBe(2048);
    expect(() => new Uint8Array(bytes)[0]).not.toThrow();
    expect(new Uint8Array(bytes)[0]).toBe(42);
  });

  it('leaves the bytes structured-cloneable, which is what IndexedDB needs', async () => {
    getDocument.mockImplementation(transferringPdfStub('Some text'));
    const { extractPdf } = await import('@/parser/extract/pdf');

    const bytes = new ArrayBuffer(1024);
    await extractPdf(bytes);

    // A detached buffer throws DataCloneError here — exactly the failure the
    // user saw, surfacing as an infinite "Saving to your profile…".
    expect(() => structuredClone({ data: bytes })).not.toThrow();
  });

  it('still hands pdf.js the real content', async () => {
    let received: Uint8Array | null = null;
    getDocument.mockImplementation((options: { data: Uint8Array }) => {
      received = options.data.slice();
      return transferringPdfStub('x')(options);
    });
    const { extractPdf } = await import('@/parser/extract/pdf');

    const bytes = new ArrayBuffer(8);
    new Uint8Array(bytes).set([1, 2, 3, 4, 5, 6, 7, 8]);
    await extractPdf(bytes);

    // A copy, not a different buffer with different content.
    expect(received).not.toBeNull();
    expect(Array.from(received!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('a detached buffer is a recognisable failure', () => {
  it('produces the error the UI knows how to explain', () => {
    const bytes = new ArrayBuffer(64);
    structuredClone(bytes, { transfer: [bytes] });

    let message = '';
    try {
      structuredClone({ data: bytes });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }

    // The import pane matches on this wording to give a useful message rather
    // than a raw DOMException.
    expect(message).toMatch(/detached/i);
  });
});
