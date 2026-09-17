export type ResumeFormat = 'pdf' | 'docx' | 'txt' | 'unknown';

export interface ExtractedText {
  format: ResumeFormat;
  /** Plain text, one logical line per line, in reading order. */
  text: string;
  /** Non-fatal problems worth showing the user, e.g. "page 3 had no text". */
  warnings: string[];
  /** Page count for PDFs; 1 otherwise. */
  pageCount: number;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly code:
      'EUNSUPPORTED' | 'EEMPTY' | 'ECORRUPT' | 'EENCRYPTED' | 'ETOOLARGE' | 'EIMAGEONLY',
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Resumes are a few hundred KB at most; anything larger is not a resume. */
export const MAX_RESUME_BYTES = 15 * 1024 * 1024;
