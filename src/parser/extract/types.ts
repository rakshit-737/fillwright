export type ResumeFormat = 'pdf' | 'docx' | 'txt' | 'unknown';

export interface ExtractedText {
  format: ResumeFormat;
  /** Plain text, one logical line per line, in reading order. */
  text: string;
  /** Non-fatal problems worth showing the user, e.g. "page 3 had no text". */
  warnings: string[];
  /** Page count for PDFs; 1 otherwise. */
  pageCount: number;
  /**
   * http(s) URLs the file carries outside its text: PDF link annotations and
   * DOCX hyperlink relationships ("LinkedIn" as a clickable word). Untrusted;
   * the link matcher re-validates every one.
   */
  links: string[];
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
