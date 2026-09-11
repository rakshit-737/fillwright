import { DATE_RANGE_RE, MONTHS, PRESENT_RE } from './patterns';

export interface ParsedRange {
  /** ISO-ish: "2026-05" when the month is known, "2026" when it is not. */
  start: string;
  end: string;
  current: boolean;
}

/**
 * Normalises a single resume date to "YYYY-MM" or "YYYY".
 *
 * Precision is never invented: a resume that says "2024" produces "2024", not
 * "2024-01". Application forms that want a month will show the field for review
 * rather than being filled with a made-up January.
 */
export function parseDate(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (PRESENT_RE.test(value)) return '';

  // "May 2026" / "Sept. 2024"
  const monthName = value.match(/^([A-Za-z]{3,9})\.?\s+((?:19|20)\d{2})$/);
  if (monthName) {
    const month = MONTHS[monthName[1]!.toLowerCase()];
    if (month) return `${monthName[2]}-${String(month).padStart(2, '0')}`;
    return monthName[2]!;
  }

  // "05/2026" or "5-2026"
  const numericMonthFirst = value.match(/^(\d{1,2})[/-]((?:19|20)\d{2})$/);
  if (numericMonthFirst) {
    const month = Number(numericMonthFirst[1]);
    if (month >= 1 && month <= 12) {
      return `${numericMonthFirst[2]}-${String(month).padStart(2, '0')}`;
    }
    return numericMonthFirst[2]!;
  }

  // "2026-05" or "2026/5"
  const yearFirst = value.match(/^((?:19|20)\d{2})[/-](\d{1,2})$/);
  if (yearFirst) {
    const month = Number(yearFirst[2]);
    if (month >= 1 && month <= 12) return `${yearFirst[1]}-${String(month).padStart(2, '0')}`;
    return yearFirst[1]!;
  }

  const yearOnly = value.match(/^((?:19|20)\d{2})$/);
  if (yearOnly) return yearOnly[1]!;

  return '';
}

/** Finds the first "start – end" range in a block of text. */
export function parseDateRange(text: string): ParsedRange | null {
  const match = text.match(new RegExp(DATE_RANGE_RE.source, 'i'));
  if (!match) return null;

  const start = parseDate(match[1] ?? '');
  const rawEnd = match[2] ?? '';
  const current = PRESENT_RE.test(rawEnd);
  const end = current ? '' : parseDate(rawEnd);

  if (!start && !end && !current) return null;

  // A range that runs backwards is a mis-parse, not a real date span.
  if (start && end && compare(start, end) > 0) return null;

  return { start, end, current };
}

/** Orders two "YYYY" / "YYYY-MM" values. An empty value sorts last. */
export function compare(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const [ay = '0', am = '0'] = a.split('-');
  const [by = '0', bm = '0'] = b.split('-');
  if (ay !== by) return Number(ay) - Number(by);
  return Number(am) - Number(bm);
}

/** Human-readable form for the profile editor, e.g. "May 2026". */
export function formatDate(value: string): string {
  if (!value) return '';
  const [year, month] = value.split('-');
  if (!month) return year ?? '';
  const name = Object.entries(MONTHS).find(
    ([key, index]) => index === Number(month) && key.length > 3,
  )?.[0];
  if (!name) return value;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}
