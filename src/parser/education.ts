import {
  DATE_RANGE_RE,
  DATE_RE,
  DEGREE_PATTERNS,
  EXPECTED_RE,
  GPA_RE,
  INSTITUTION_HINT_RE,
  MAJOR_HINT_RE,
  PRESENT_RE,
  isBullet,
  normalizeWhitespace,
  stripBullet,
} from './patterns';
import { parseDate, parseDateRange } from './dates';
import type { ResumeSection } from './sections';

export interface ParsedEducation {
  institution: string;
  degree: string;
  major: string;
  minor: string;
  location: string;
  startDate: string;
  endDate: string;
  graduationDate: string;
  gpa: string;
  gpaScale: string;
  honors: string;
  coursework: string[];
  current: boolean;
  confidence: number;
  note: string;
}

/**
 * Education entries have no reliable delimiter, so entries are split on the
 * strongest available signal: a line naming an institution. Degree lines,
 * grade lines and bullets attach to whichever institution came last.
 */
export function parseEducation(sections: ResumeSection[]): ParsedEducation[] {
  const lines = sections
    .filter((section) => section.kind === 'education')
    .flatMap((section) => section.lines);

  const blocks = groupIntoBlocks(lines);
  return blocks.map(interpretBlock).filter((entry) => entry.institution || entry.degree);
}

function groupIntoBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const raw of lines) {
    const line = normalizeWhitespace(raw);
    if (!line) continue;

    const startsEntry =
      !isBullet(raw) &&
      hasInstitution(line) &&
      // Only break when the block already has an institution of its own,
      // so "University of X" followed by "B.Tech, X University" stays together.
      current.some(hasInstitution);

    if (startsEntry) {
      blocks.push(current);
      current = [raw];
    } else {
      current.push(raw);
    }
  }

  if (current.length > 0) blocks.push(current);
  return blocks.filter((block) => block.length > 0);
}

function hasInstitution(line: string): boolean {
  return INSTITUTION_HINT_RE.test(line);
}

function interpretBlock(block: string[]): ParsedEducation {
  const entry: ParsedEducation = {
    institution: '',
    degree: '',
    major: '',
    minor: '',
    location: '',
    startDate: '',
    endDate: '',
    graduationDate: '',
    gpa: '',
    gpaScale: '',
    honors: '',
    coursework: [],
    current: false,
    confidence: 0.5,
    note: '',
  };

  const notes: string[] = [];
  const joined = block.map((line) => normalizeWhitespace(stripBullet(line))).join('\n');

  /* --- institution ------------------------------------------------------ */
  for (const raw of block) {
    const line = normalizeWhitespace(stripBullet(raw));
    if (!hasInstitution(line)) continue;
    // Drop trailing date and location fragments from the institution cell.
    const cell = splitCells(raw).find((part) => hasInstitution(part)) ?? line;
    entry.institution = tidy(cell.replace(stripDateRe(), '').replace(/[,;|–—-]\s*$/, ''));
    notes.push('matched a line naming a university, college or institute');
    break;
  }

  /* --- degree and major ------------------------------------------------- */
  for (const { re, canonical } of DEGREE_PATTERNS) {
    if (!re.test(joined)) continue;
    entry.degree = canonical;
    notes.push(`recognised the degree "${canonical}"`);
    break;
  }

  const degreeLine =
    block.find((raw) => DEGREE_PATTERNS.some(({ re }) => re.test(raw))) ??
    block.find((raw) => MAJOR_HINT_RE.test(normalizeWhitespace(stripBullet(raw))));

  if (degreeLine) {
    const cleaned = normalizeWhitespace(stripBullet(degreeLine));
    const major = extractMajor(cleaned, entry.degree);
    if (major) {
      entry.major = major;
      notes.push('read the major from the degree line');
    }
  }

  const minorMatch = joined.match(/\bminor(?:\s+in)?\s*[:\-–]?\s*([A-Za-z][A-Za-z &/,'-]{2,60})/i);
  if (minorMatch?.[1]) entry.minor = tidy(minorMatch[1]);

  /* --- grade ------------------------------------------------------------ */
  const gpaMatch = joined.match(GPA_RE);
  if (gpaMatch?.[1]) {
    entry.gpa = gpaMatch[1];
    if (gpaMatch[2]) entry.gpaScale = gpaMatch[2];
    else if (/%/.test(gpaMatch[0])) entry.gpaScale = '100';
    else if (Number(gpaMatch[1]) > 5) entry.gpaScale = '10';
    else entry.gpaScale = '4';
    notes.push('found a GPA or percentage');
  }

  /* --- dates ------------------------------------------------------------ */
  const range = parseDateRange(joined);
  if (range) {
    entry.startDate = range.start;
    entry.endDate = range.end;
    entry.current = range.current;
    notes.push('read a date range');
  } else {
    const dates = matchAll(joined, DATE_RE);
    if (dates.length > 0) {
      // A lone date on an education entry is the graduation date.
      entry.endDate = parseDate(dates[dates.length - 1]!);
      notes.push('found a single date and treated it as the completion date');
    }
  }

  entry.graduationDate = entry.endDate;
  if (EXPECTED_RE.test(joined) || PRESENT_RE.test(joined)) {
    entry.current = !PRESENT_RE.test(joined) ? entry.current : true;
    if (EXPECTED_RE.test(joined)) notes.push('marked as an expected graduation date');
  }

  /* --- honours and coursework ------------------------------------------- */
  const honorsMatch = joined.match(
    /\b((?:summa|magna)\s+cum\s+laude|cum\s+laude|with\s+(?:distinction|honou?rs)|first\s+class(?:\s+with\s+distinction)?|dean'?s\s+list)\b/i,
  );
  if (honorsMatch?.[1]) entry.honors = tidy(honorsMatch[1]);

  const courseworkMatch = joined.match(/\b(?:relevant\s+)?coursework\s*[:\-–]\s*(.+)/i);
  if (courseworkMatch?.[1]) {
    entry.coursework = courseworkMatch[1]
      .split(/[,;•|]/)
      .map((item) => tidy(item))
      .filter((item) => item.length > 1 && item.length < 60)
      .slice(0, 20);
  }

  /* --- location --------------------------------------------------------- */
  const locationMatch = joined.match(
    /\b([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+)*),\s*([A-Z]{2}|[A-Z][A-Za-z]+)\b(?!\s*\d{4})/,
  );
  if (locationMatch && !hasInstitution(locationMatch[0])) {
    entry.location = tidy(locationMatch[0]);
  }

  /* --- confidence ------------------------------------------------------- */
  // Confidence reflects how much of the entry we actually recognised, not how
  // much text was present.
  let confidence = 0.35;
  if (entry.institution) confidence += 0.3;
  if (entry.degree) confidence += 0.2;
  if (entry.endDate) confidence += 0.1;
  if (entry.major) confidence += 0.05;
  entry.confidence = Math.min(0.95, confidence);
  entry.note = notes.join('; ');

  return entry;
}

/** Pulls the field of study out of a degree line, without inventing one. */
export function extractMajor(line: string, degree: string): string {
  const hinted = line.match(MAJOR_HINT_RE);
  if (hinted?.[1]) {
    const candidate = tidy(
      hinted[1]
        .replace(stripDateRe(), '')
        .replace(GPA_RE, '')
        .split(/[,;|•]|\s{2,}|\t/)[0] ?? '',
    );
    if (isPlausibleMajor(candidate)) return candidate;
  }

  // "B.Tech, Computer Science" — the segment after the degree token.
  if (degree) {
    const pattern = DEGREE_PATTERNS.find(({ canonical }) => canonical === degree);
    if (pattern) {
      const match = line.match(new RegExp(`${pattern.re.source}\\s*[,:\\-–]?\\s*(.+)`, 'i'));
      if (match?.[1]) {
        const candidate = tidy(
          match[1]
            .replace(stripDateRe(), '')
            .replace(GPA_RE, '')
            .split(/[,;|•]|\s{2,}|\t/)[0] ?? '',
        );
        if (isPlausibleMajor(candidate)) return candidate;
      }
    }
  }

  return '';
}

function isPlausibleMajor(value: string): boolean {
  if (value.length < 3 || value.length > 60) return false;
  if (/\d/.test(value)) return false;
  if (INSTITUTION_HINT_RE.test(value)) return false;
  return /^[A-Za-z][A-Za-z &/'’-]*$/.test(value);
}

/* ----------------------------------------------------------------- utils */

function stripDateRe(): RegExp {
  return new RegExp(`(?:${DATE_RANGE_RE.source})|(?:${DATE_RE.source})`, 'gi');
}

function splitCells(line: string): string[] {
  return line
    .split(/\t+|\s*[|•·]\s*|\s{3,}/)
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function tidy(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^[\s,;:|–—-]+/, '')
    .replace(/[\s,;:|–—-]+$/, '')
    .trim();
}

function matchAll(text: string, pattern: RegExp): string[] {
  const re = new RegExp(pattern.source, pattern.flags);
  return Array.from(text.matchAll(re), (match) => match[0]);
}
