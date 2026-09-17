/**
 * Shared lexical patterns for resume parsing.
 *
 * Every matcher here is conservative on purpose. A wrong value that looks
 * plausible is worse than no value: the user has to notice it to correct it,
 * whereas a blank field is obvious. When a pattern is unsure it should decline.
 */

/* ------------------------------------------------------------------ contact */

// Deliberately narrower than RFC 5322: resumes contain ordinary addresses, and
// a permissive pattern happily swallows "v1.2@see" style noise.
export const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;

/**
 * Phone numbers, in the shapes resumes actually use:
 *   +91 98765 43210 · (415) 555-0132 · 415-555-0132 · +1 415 555 0132
 * Requires a separator-rich layout or a leading +, so bare 10-digit IDs and
 * years-with-digits do not match.
 */
export const PHONE_RE =
  /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]\d{2,5}){1,4}\b/g;

export const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+/gi;

/** Bare domains for the profiles people list without a scheme. */
export const BARE_PROFILE_RE =
  /\b(?:linkedin\.com|github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com|medium\.com|behance\.net|dribbble\.com|kaggle\.com|leetcode\.com|x\.com|twitter\.com)\/[^\s<>()[\]{},;"']+/gi;

/* -------------------------------------------------------------------- dates */

export const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join('|');

/** "May 2026", "Sept. 2024", "05/2026", "2026-05", or a bare "2026". */
export const DATE_RE = new RegExp(
  String.raw`\b(?:(?:${MONTH_NAMES})\.?\s+\d{4}|\d{1,2}[/-]\d{4}|\d{4}[/-]\d{1,2}|(?:19|20)\d{2})\b`,
  'gi',
);

export const PRESENT_RE = /\b(?:present|current|ongoing|now|till\s+date|to\s+date)\b/i;

/** "Aug 2022 – May 2026", "2022 to Present", "08/2022-05/2026". */
export const DATE_RANGE_RE = new RegExp(
  String.raw`(${DATE_RE.source})\s*(?:–|—|-|to|until|through)\s*(${DATE_RE.source}|present|current|ongoing|now)`,
  'i',
);

export const EXPECTED_RE =
  /\b(?:expected|anticipated|expected\s+graduation|graduating|to\s+be\s+completed)\b/i;

/* ---------------------------------------------------------------- education */

/**
 * Degree tokens, longest first so "Bachelor of Technology" wins over "Bachelor".
 * Abbreviations are matched with explicit dots/case handling because "MS" is a
 * degree but "ms" inside a word is not.
 */
export const DEGREE_PATTERNS: Array<{ re: RegExp; canonical: string }> = [
  { re: /\bbachelor(?:'s)?\s+of\s+technology\b/i, canonical: 'Bachelor of Technology' },
  { re: /\bbachelor(?:'s)?\s+of\s+engineering\b/i, canonical: 'Bachelor of Engineering' },
  { re: /\bbachelor(?:'s)?\s+of\s+science\b/i, canonical: 'Bachelor of Science' },
  { re: /\bbachelor(?:'s)?\s+of\s+arts\b/i, canonical: 'Bachelor of Arts' },
  { re: /\bbachelor(?:'s)?\s+of\s+commerce\b/i, canonical: 'Bachelor of Commerce' },
  { re: /\bbachelor(?:'s)?\b/i, canonical: "Bachelor's" },
  { re: /\bmaster(?:'s)?\s+of\s+technology\b/i, canonical: 'Master of Technology' },
  { re: /\bmaster(?:'s)?\s+of\s+science\b/i, canonical: 'Master of Science' },
  { re: /\bmaster(?:'s)?\s+of\s+business\s+administration\b/i, canonical: 'MBA' },
  { re: /\bmaster(?:'s)?\s+of\s+arts\b/i, canonical: 'Master of Arts' },
  { re: /\bmaster(?:'s)?\b/i, canonical: "Master's" },
  { re: /\bdoctor\s+of\s+philosophy\b/i, canonical: 'PhD' },
  { re: /\bassociate(?:'s)?\s+degree\b/i, canonical: "Associate's" },
  { re: /\bhigh\s+school\s+diploma\b/i, canonical: 'High School Diploma' },
  { re: /\bB\.?\s?Tech\b/, canonical: 'B.Tech' },
  { re: /\bM\.?\s?Tech\b/, canonical: 'M.Tech' },
  { re: /\bB\.?\s?E\.?(?=\s|,|$)/, canonical: 'B.E.' },
  { re: /\bM\.?\s?E\.?(?=\s|,|$)/, canonical: 'M.E.' },
  { re: /\bB\.?\s?Sc\b/, canonical: 'B.Sc' },
  { re: /\bM\.?\s?Sc\b/, canonical: 'M.Sc' },
  { re: /\bB\.?\s?A\.?(?=\s|,|$)/, canonical: 'B.A.' },
  { re: /\bM\.?\s?A\.?(?=\s|,|$)/, canonical: 'M.A.' },
  { re: /\bB\.?\s?Com\b/, canonical: 'B.Com' },
  { re: /\bBBA\b/, canonical: 'BBA' },
  { re: /\bMBA\b/, canonical: 'MBA' },
  { re: /\bBCA\b/, canonical: 'BCA' },
  { re: /\bMCA\b/, canonical: 'MCA' },
  { re: /\bPh\.?\s?D\b/i, canonical: 'PhD' },
];

export const INSTITUTION_HINT_RE =
  /\b(?:university|college|institute|institution|school|academy|polytechnic|universit[aeiy]\w*|iit|nit|iiit|vit|bits)\b/i;

/** "CGPA: 8.72/10", "GPA 3.8", "GPA: 3.85 / 4.0", "Percentage: 87%". */
export const GPA_RE =
  /\b(?:c?gpa|grade\s*point\s*average|percentage|aggregate)\b\s*[:\-–]?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/\s*(\d{1,3}(?:\.\d{1,2})?)|%)?/i;

export const MAJOR_HINT_RE =
  /\b(?:in|major(?:ing)?\s+in|specialization\s+in|specialisation\s+in|branch|stream)\b\s*[:\-–]?\s*(.+)$/i;

/* ------------------------------------------------------------------ headings */

/**
 * Whether a line could be a section heading.
 *
 * This is a cheap gate in front of the heading vocabulary, and it has to be
 * strict: resumes are full of short Title Case lines ("Software Engineer",
 * "Tech: Go, Docker") that are body content. Treating one as a heading splits a
 * section in half and silently loses the entry underneath it.
 */
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim().replace(/[:\s]+$/, '');
  if (!trimmed || trimmed.length > 48) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  // Punctuation that only appears in content: separators, list commas, dates.
  if (/[|•·@/\\]|\t|\d/.test(trimmed)) return false;

  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;

  if (isAllCaps(trimmed)) return true;

  // Title Case fallback: at most four words, each capitalised, no commas.
  if (trimmed.includes(',')) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  return words.every((word) => /^(?:&|and|of|in|[A-Z][a-z'’-]*)$/.test(word));
}

/** ALL-CAPS headings are the one unambiguous heading signal in a resume. */
export function isAllCaps(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
}

/* --------------------------------------------------------------- normalising */

/**
 * Non-breaking, figure and narrow no-break spaces.
 *
 * Built from char codes rather than written literally: an invisible character
 * inside a regex is unreviewable, and a stray one is impossible to spot in a
 * diff. PDF and DOCX extraction produce all three regularly.
 */
const UNICODE_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2007, 0x202f)}]`, 'g');

export function normalizeWhitespace(value: string): string {
  return value.replace(UNICODE_SPACES, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Collapses runs of spaces but keeps tabs intact.
 *
 * Tabs are the only surviving trace of a two-column layout once a PDF or DOCX
 * has been flattened to text, and they are what separates "Company" from
 * "Location" on a single line. Normalising them away merges the two cells.
 */
export function normalizeKeepTabs(value: string): string {
  return value
    .replace(UNICODE_SPACES, ' ')
    .replace(/[^\S\t\n]+/g, ' ')
    .replace(/ *\t+ */g, '\t')
    .trim();
}

/** Bullet glyphs and list markers people start resume lines with. */
export const BULLET_RE = /^\s*(?:[-•▪◦‣∙*·–—]|\d{1,2}[.)])\s+/;

export function stripBullet(line: string): string {
  return line.replace(BULLET_RE, '').trim();
}

export function isBullet(line: string): boolean {
  return BULLET_RE.test(line);
}
