import {
  DATE_RANGE_RE,
  DATE_RE,
  isBullet,
  normalizeKeepTabs,
  normalizeWhitespace,
  stripBullet,
} from './patterns';
import { parseDateRange } from './dates';
import type { ResumeSection } from './sections';

export interface ParsedExperience {
  company: string;
  title: string;
  employmentType: 'full-time' | 'part-time' | 'internship' | 'contract' | 'freelance' | 'other' | '';
  location: string;
  locationType: 'onsite' | 'remote' | 'hybrid' | '';
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  highlights: string[];
  technologies: string[];
  confidence: number;
  note: string;
}

const TITLE_RE =
  /\b(?:intern(?:ship)?|engineer|developer|programmer|analyst|manager|designer|scientist|consultant|architect|administrator|specialist|associate|assistant|lead|head|director|officer|researcher|trainee|apprentice|freelancer|contractor|founder|co-?founder|president|coordinator|strategist|technician|instructor|teaching\s+assistant|ta\b)/i;

/**
 * Legal-entity markers. These are decisive: a cell containing one is an
 * employer, even if it also contains a role keyword.
 */
const STRONG_COMPANY_RE =
  /\b(?:inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|pvt|private\s+limited|s\.a|b\.v|ag|nv|oy|ab|pte)\.?(?:\s|$|,)/i;

/**
 * Weaker company signals. "Software", "Systems" and "Tech" appear in company
 * names but also in job titles ("Software Engineer"), so these only decide a
 * cell when no role keyword is present.
 */
const WEAK_COMPANY_RE =
  /\b(?:technologies|technology|tech|labs?|solutions?|systems?|software|services?|consulting|group|studios?|ventures?|holdings?|partners?|associates?|foundation|institute|bank|media|networks?|university)\b/i;

const LOCATION_TYPE_RE = /\b(remote|hybrid|on-?site|work\s+from\s+home|wfh)\b/i;

const EMPLOYMENT_TYPE_RE: Array<[RegExp, ParsedExperience['employmentType']]> = [
  [/\b(?:intern|internship|summer\s+analyst|trainee|apprentice|co-?op)\b/i, 'internship'],
  [/\b(?:part[\s-]?time)\b/i, 'part-time'],
  [/\b(?:contract|contractor|consultant\s+\(contract\))\b/i, 'contract'],
  [/\b(?:freelance|self[\s-]?employed)\b/i, 'freelance'],
  [/\b(?:full[\s-]?time|permanent)\b/i, 'full-time'],
];

const TECH_LINE_RE =
  /^\s*(?:tech(?:nologies)?|tech\s+stack|stack|tools?|skills?\s+used|environment)\s*[:\-–]\s*(.+)$/i;

/**
 * Parses work history.
 *
 * Entries are delimited by "header" lines — a non-bullet line that carries a
 * date range or names a role. Bullets and continuation lines attach to whatever
 * header preceded them, which matches how every resume layout actually works.
 */
export function parseExperience(sections: ResumeSection[]): ParsedExperience[] {
  const blocks = groupIntoBlocks(
    sections
      .filter((section) => section.kind === 'experience' || section.kind === 'volunteer')
      .flatMap((section) => section.lines),
  );

  return blocks.map(interpretBlock).filter((entry) => entry.company || entry.title);
}

function groupIntoBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let currentHasBody = false;

  for (const raw of lines) {
    const line = normalizeWhitespace(raw);
    if (!line) continue;

    const bullet = isBullet(raw);
    // A "Tech: Go, Kafka" line names technologies, not an employer. Without
    // this guard the company-keyword rule claims it as a new entry header and
    // the entry that follows is absorbed into it.
    const header = !bullet && !TECH_LINE_RE.test(line) && isHeaderLine(line);

    // A header line starts a new entry only once the current one has body text,
    // or when both carry their own date range. Role and employer are routinely
    // written on two consecutive header lines ("Software Engineering Intern" /
    // "Zeta Payments Pvt Ltd"), and splitting between them loses one of them.
    const bothDated = hasDate(line) && hasDate(current.join('\n'));
    if (header && current.length > 0 && (currentHasBody || bothDated)) {
      blocks.push(current);
      current = [raw];
      currentHasBody = false;
      continue;
    }

    current.push(raw);
    if (bullet) currentHasBody = true;
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function isHeaderLine(line: string): boolean {
  if (line.length >= 110) return hasDate(line);
  return hasDate(line) || TITLE_RE.test(line) || isCompanyish(line);
}

function isCompanyish(value: string): boolean {
  return STRONG_COMPANY_RE.test(value) || WEAK_COMPANY_RE.test(value);
}

function hasDate(text: string): boolean {
  return new RegExp(DATE_RANGE_RE.source, 'i').test(text);
}

function interpretBlock(block: string[]): ParsedExperience {
  const entry: ParsedExperience = {
    company: '',
    title: '',
    employmentType: '',
    location: '',
    locationType: '',
    startDate: '',
    endDate: '',
    current: false,
    description: '',
    highlights: [],
    technologies: [],
    confidence: 0.4,
    note: '',
  };

  const notes: string[] = [];
  const headerLines: string[] = [];

  for (const raw of block) {
    // Tabs are load-bearing here: they separate the cells of a flattened
    // two-column row, so they survive until splitCells consumes them.
    const line = normalizeKeepTabs(raw);
    if (!line) continue;

    if (isBullet(raw)) {
      const text = stripBullet(raw);
      const tech = text.match(TECH_LINE_RE);
      if (tech?.[1]) entry.technologies.push(...splitList(tech[1]));
      else if (text.length > 2) entry.highlights.push(normalizeWhitespace(text));
      continue;
    }

    const tech = line.match(TECH_LINE_RE);
    if (tech?.[1]) {
      entry.technologies.push(...splitList(tech[1]));
      continue;
    }

    if (headerLines.length < 4) headerLines.push(line);
    // Long prose under a header is a description, not another header.
    else if (line.length > 80) entry.highlights.push(line);
  }

  const headerText = headerLines.join('\n');

  /* --- dates ------------------------------------------------------------ */
  const range = parseDateRange(headerText);
  if (range) {
    entry.startDate = range.start;
    entry.endDate = range.end;
    entry.current = range.current;
    notes.push('read a date range from the entry header');
  }

  /* --- company and title ------------------------------------------------ */
  const cells = headerLines
    .flatMap(splitCells)
    .flatMap(splitRoleAtCompany)
    .map((cell) => cell.replace(stripDatesRe(), '').trim())
    .map((cell) => cell.replace(/^[,;|–—\-\s]+|[,;|–—\-\s]+$/g, ''))
    .filter((cell) => cell.length > 1 && cell.length < 90);

  // Classify in two passes. A legal-entity marker is decisive, so those cells
  // are claimed as the employer first; only then is a role keyword allowed to
  // claim a cell. Doing it in one pass lets "Software Engineering Intern" be
  // taken for a company because "software" appears in company names too.
  for (const cell of cells) {
    if (!entry.company && STRONG_COMPANY_RE.test(cell)) {
      entry.company = cell;
      notes.push('matched a company-name suffix');
    }
  }
  for (const cell of cells) {
    if (cell === entry.company) continue;
    if (!entry.title && TITLE_RE.test(cell)) {
      entry.title = cell;
      notes.push('matched a role keyword');
    }
  }
  for (const cell of cells) {
    if (cell === entry.company || cell === entry.title) continue;
    if (!entry.company && WEAK_COMPANY_RE.test(cell) && !isLocationish(cell)) {
      entry.company = cell;
      notes.push('matched a company-name keyword');
    }
  }

  // Fall back to position: resumes overwhelmingly write role then employer, or
  // employer then role on the following line. Either way the two leading cells
  // are the pair, so assign whichever slot is still empty — and say so, because
  // this is positional guesswork rather than a real signal.
  const remaining = cells.filter((cell) => cell !== entry.title && cell !== entry.company);
  if (!entry.title && remaining.length > 0) {
    entry.title = remaining.shift()!;
    notes.push('inferred the role from its position — please check');
  }
  if (!entry.company && remaining.length > 0) {
    entry.company = remaining.shift()!;
    notes.push('inferred the employer from its position — please check');
  }

  /* --- location and type ------------------------------------------------ */
  const locationType = headerText.match(LOCATION_TYPE_RE);
  if (locationType?.[1]) {
    const value = locationType[1].toLowerCase();
    entry.locationType = /remote|wfh|work\s+from\s+home/.test(value)
      ? 'remote'
      : value.startsWith('hybrid')
        ? 'hybrid'
        : 'onsite';
  }

  const location = cells.find(
    (cell) => cell !== entry.company && cell !== entry.title && isLocationish(cell),
  );
  if (location) entry.location = location;

  const wholeBlock = block.join('\n');
  for (const [re, type] of EMPLOYMENT_TYPE_RE) {
    if (re.test(entry.title) || re.test(headerText)) {
      entry.employmentType = type;
      break;
    }
  }
  if (!entry.employmentType && /\bintern\b/i.test(wholeBlock)) entry.employmentType = 'internship';

  entry.technologies = dedupe(entry.technologies).slice(0, 40);
  entry.highlights = entry.highlights.slice(0, 12);
  entry.description = entry.highlights.join('\n');

  /* --- confidence ------------------------------------------------------- */
  let confidence = 0.3;
  if (entry.company) confidence += 0.25;
  if (entry.title) confidence += 0.25;
  if (entry.startDate || entry.current) confidence += 0.12;
  if (entry.highlights.length > 0) confidence += 0.05;
  // Positional guesses should never reach the auto-fill threshold on their own.
  if (notes.some((note) => note.includes('position'))) confidence = Math.min(confidence, 0.62);
  entry.confidence = Math.min(0.95, confidence);
  entry.note = notes.join('; ');

  return entry;
}

/**
 * "Senior Software Engineer, Halcyon Systems Inc." — one cell holding both the
 * role and the employer. Split it only when the tail is clearly a company, so
 * "Austin, TX" and "Engineer, Backend" are left intact.
 */
function splitRoleAtCompany(cell: string): string[] {
  const match = cell.match(/^(.{3,60}?),\s*(.{3,60})$/);
  if (!match?.[1] || !match[2]) return [cell];
  const [, role, company] = match;
  if (!TITLE_RE.test(role) || !STRONG_COMPANY_RE.test(company)) return [cell];
  return [role.trim(), company.trim()];
}

function isLocationish(cell: string): boolean {
  if (/\d/.test(cell)) return false;
  if (TITLE_RE.test(cell) || STRONG_COMPANY_RE.test(cell)) return false;
  if (LOCATION_TYPE_RE.test(cell)) return true;
  return /^[A-Z][A-Za-z .'’-]*(?:,\s*[A-Z][A-Za-z.'’-]*)+$/.test(cell);
}

function stripDatesRe(): RegExp {
  return new RegExp(`(?:${DATE_RANGE_RE.source})|(?:${DATE_RE.source})`, 'gi');
}

export function splitCells(line: string): string[] {
  return line
    .split(/\t+|\s*[|•·]\s*|\s{3,}|\s+[–—]\s+/)
    .map(normalizeWhitespace)
    .filter(Boolean);
}

export function splitList(value: string): string[] {
  return value
    .split(/[,;|•·]|\s+\/\s+/)
    .map((item) => normalizeWhitespace(item).replace(/\.$/, ''))
    .filter((item) => item.length > 0 && item.length < 50);
}

export function dedupe(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return Array.from(seen.values());
}
