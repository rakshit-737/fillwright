import {
  BARE_PROFILE_RE,
  EMAIL_RE,
  PHONE_RE,
  URL_RE,
  normalizeWhitespace,
  stripBullet,
} from './patterns';
import type { ResumeSection } from './sections';

export interface ParsedContact {
  firstName: Candidate;
  middleName: Candidate;
  lastName: Candidate;
  fullName: Candidate;
  email: Candidate;
  phone: Candidate;
  location: Candidate;
  city: Candidate;
  state: Candidate;
  country: Candidate;
  postalCode: Candidate;
  links: {
    linkedin: Candidate;
    github: Candidate;
    portfolio: Candidate;
    website: Candidate;
    twitter: Candidate;
    stackoverflow: Candidate;
    other: string[];
  };
}

export interface Candidate {
  value: string;
  confidence: number;
  note: string;
}

const none = (): Candidate => ({ value: '', confidence: 0, note: '' });
const found = (value: string, confidence: number, note: string): Candidate => ({
  value,
  confidence,
  note,
});

/** Words that disqualify a line from being someone's name. */
const NOT_A_NAME_RE =
  /\b(?:resume|curriculum\s+vitae|cv|profile|summary|objective|contact|phone|email|address|linkedin|github|portfolio|engineer|developer|student|intern|manager|analyst|designer|scientist|university|college|institute)\b/i;

const NAME_PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'della',
  'da',
  'di',
  'du',
  'la',
  'le',
  'bin',
  'binti',
  'al',
  'ibn',
  'mac',
  'mc',
  "o'",
]);

const SUFFIXES = new Set([
  'jr',
  'jr.',
  'sr',
  'sr.',
  'ii',
  'iii',
  'iv',
  'phd',
  'ph.d.',
  'md',
  'mba',
]);
const TITLES = new Set(['mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'dr', 'dr.', 'prof', 'prof.']);

/**
 * Reads the contact block.
 *
 * Only the header section (everything above the first recognised heading) is
 * considered for the name. Scanning the whole document finds a hiring manager's
 * name in a reference line just as happily as the candidate's.
 */
export function parseContact(
  sections: ResumeSection[],
  fullText: string,
  fileLinks: readonly string[] = [],
): ParsedContact {
  const header = sections.find((section) => section.kind === 'header');
  const headerLines = (header?.lines ?? []).map((line) => normalizeWhitespace(stripBullet(line)));

  const email = findEmail(fullText, headerLines);
  const phone = findPhone(headerLines, fullText);
  const links = findLinks(fullText, fileLinks);
  const name = findName(headerLines, email.value);
  const location = findLocation(headerLines);

  return {
    ...name,
    email,
    phone,
    ...location,
    links,
  };
}

/* ---------------------------------------------------------------- email */

function findEmail(fullText: string, headerLines: string[]): Candidate {
  const inHeader = matchAll(headerLines.join('\n'), EMAIL_RE);
  if (inHeader.length > 0) {
    return found(inHeader[0]!.toLowerCase(), 0.97, 'found in the contact block');
  }
  const anywhere = matchAll(fullText, EMAIL_RE);
  if (anywhere.length === 0) return none();
  // Outside the header an address could belong to a referee, so confidence drops.
  return found(anywhere[0]!.toLowerCase(), 0.75, 'found in the resume body');
}

/* ---------------------------------------------------------------- phone */

function findPhone(headerLines: string[], fullText: string): Candidate {
  const fromHeader = pickPhone(headerLines.join('\n'));
  if (fromHeader) return found(fromHeader, 0.92, 'found in the contact block');
  const anywhere = pickPhone(fullText);
  return anywhere ? found(anywhere, 0.6, 'found in the resume body') : none();
}

function pickPhone(text: string): string {
  for (const raw of matchAll(text, PHONE_RE)) {
    const candidate = raw.trim();
    const digits = candidate.replace(/\D/g, '');
    // 7 digits is the shortest real subscriber number; 15 is the E.164 ceiling.
    if (digits.length < 7 || digits.length > 15) continue;
    // A bare 4-digit year or a date range slipped through the separator rule.
    if (/^(?:19|20)\d{2}$/.test(digits)) continue;
    if (/\b(?:19|20)\d{2}\s*[–—-]\s*(?:19|20)\d{2}\b/.test(candidate)) continue;
    // GPA-like "8.72/10" and version numbers.
    if (/^\d{1,2}[./]\d{1,2}$/.test(candidate)) continue;
    return normalizePhone(candidate);
  }
  return '';
}

function normalizePhone(value: string): string {
  const trimmed = value.trim().replace(/\s{2,}/g, ' ');
  // Keep the user's own formatting; forms accept it and it stays recognisable.
  return trimmed.replace(/^00/, '+');
}

/* ----------------------------------------------------------------- links */

/**
 * Links written in the text come first; `fileLinks` (PDF link annotations,
 * DOCX hyperlink targets) fill in what a clickable "LinkedIn" hid. Both are
 * untrusted and go through the same cleanUrl() validation.
 */
function findLinks(fullText: string, fileLinks: readonly string[] = []): ParsedContact['links'] {
  const urls = [
    ...matchAll(fullText, URL_RE),
    ...matchAll(fullText, BARE_PROFILE_RE),
    ...fileLinks.slice(0, 50).filter((link) => typeof link === 'string' && link.length <= 2048),
  ]
    .map(cleanUrl)
    .filter(Boolean);

  const unique = Array.from(new Set(urls));
  const links: ParsedContact['links'] = {
    linkedin: none(),
    github: none(),
    portfolio: none(),
    website: none(),
    twitter: none(),
    stackoverflow: none(),
    other: [],
  };

  const leftovers: string[] = [];

  for (const url of unique) {
    const host = hostOf(url);
    if (!host) continue;

    if (/(?:^|\.)linkedin\.com$/.test(host) && !links.linkedin.value) {
      links.linkedin = found(url, /\/in\//.test(url) ? 0.97 : 0.8, 'linkedin.com profile URL');
    } else if (/(?:^|\.)github\.com$/.test(host) && !links.github.value) {
      links.github = found(url, 0.97, 'github.com profile URL');
    } else if (/(?:^|\.)(?:twitter|x)\.com$/.test(host) && !links.twitter.value) {
      links.twitter = found(url, 0.9, 'social profile URL');
    } else if (/(?:^|\.)stackoverflow\.com$/.test(host) && !links.stackoverflow.value) {
      links.stackoverflow = found(url, 0.9, 'stackoverflow.com profile URL');
    } else {
      leftovers.push(url);
    }
  }

  // A personal site is a guess, not a fact: anything left over could be a link
  // to a project, an article, or a former employer. Mark it low confidence so
  // the UI asks rather than fills.
  const personal = leftovers.find((url) => isLikelyPersonalSite(url));
  if (personal) {
    links.portfolio = found(personal, 0.55, 'looks like a personal site — please confirm');
    links.website = found(personal, 0.5, 'same link as the portfolio guess');
  }
  links.other = leftovers.filter((url) => url !== personal).slice(0, 20);

  return links;
}

function isLikelyPersonalSite(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (
    /(?:^|\.)(?:google|drive|docs|dropbox|youtube|youtu\.be|medium|notion|vercel\.app|netlify\.app|herokuapp)\.com$/.test(
      host,
    )
  ) {
    return false;
  }
  if (/\.(?:dev|me|io|xyz|page|site|tech|portfolio)$/.test(host)) return true;
  // A root-level URL on a domain we do not recognise is the usual shape of a
  // personal site; a deep path is usually an article or a repository.
  return new URL(url).pathname.replace(/\/+$/, '').length === 0;
}

function cleanUrl(raw: string): string {
  let value = raw.trim().replace(/[),.;:'"\]]+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ name */

type NameParts = Pick<ParsedContact, 'firstName' | 'middleName' | 'lastName' | 'fullName'>;

function findName(headerLines: string[], email: string): NameParts {
  const empty: NameParts = {
    firstName: none(),
    middleName: none(),
    lastName: none(),
    fullName: none(),
  };

  // The name is almost always in the first few lines of the header.
  const candidates = headerLines.slice(0, 6).filter(isNameShaped);
  if (candidates.length === 0) return empty;

  const line = candidates[0]!;
  const position = headerLines.indexOf(line);
  // Corroborate against the email local part: "ada.lovelace@…" agreeing with
  // "Ada Lovelace" is strong evidence we picked the right line.
  const corroborated = email ? emailAgreesWithName(email, line) : false;

  let confidence = position === 0 ? 0.88 : 0.72;
  if (corroborated) confidence = Math.min(0.97, confidence + 0.09);
  const note = corroborated
    ? 'first line of the resume, and it matches your email address'
    : 'first line of the resume';

  return splitName(line, confidence, note);
}

/** A name word in any script: letters, combining marks, apostrophes, hyphens. */
const NAME_WORD_RE = /^\p{L}[\p{L}\p{M}'’-]*$/u;
/** "S." or "S.R." — initials, each an upper-case letter followed by a dot. */
const INITIALS_RE = /^(?:\p{Lu}\.)+$/u;

function isNameShaped(line: string): boolean {
  const value = line.replace(/[|·•].*$/, '').trim();
  if (!value || value.length > 48) return false;
  if (/\d/.test(value) || value.includes('@')) return false;
  if (/https?:|www\./i.test(value)) return false;
  if (NOT_A_NAME_RE.test(value)) return false;

  const words = value.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;

  // At least one word must be more than an initial: "S. R." alone is not a name.
  if (words.every((word) => INITIALS_RE.test(word))) return false;

  // Every word should read as a name: capitalised, all-caps, an initial, or a
  // particle. Letters are any script's (\p{L}), so "José Álvarez" is a name.
  return words.every((word) => {
    const bare = word.replace(/[.,']/g, '').toLowerCase();
    if (NAME_PARTICLES.has(bare) || SUFFIXES.has(bare) || TITLES.has(bare)) return true;
    if (INITIALS_RE.test(word)) return true;
    if (!NAME_WORD_RE.test(word)) return false;
    return word === word.toUpperCase() || /^\p{Lu}/u.test(word);
  });
}

function emailAgreesWithName(email: string, name: string): boolean {
  const local =
    email
      .split('@')[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? '';
  if (local.length < 4) return false;
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3)
    .some((part) => local.includes(part.replace(/[^a-z]/g, '')));
}

export function splitName(raw: string, confidence: number, note: string): NameParts {
  let value = normalizeWhitespace(raw.replace(/[|·•].*$/, ''));

  // "LOVELACE, Ada" — surname first.
  let surnameFirst = false;
  if (/^[^,]+,\s*\S/.test(value) && value.split(',').length === 2) {
    const [last = '', rest = ''] = value.split(',');
    value = `${rest.trim()} ${last.trim()}`;
    surnameFirst = true;
  }

  let words = value.split(/\s+/).filter(Boolean);
  words = words.filter((word) => !TITLES.has(word.replace(/[.,]/g, '').toLowerCase()));
  const suffixIndex = words.findIndex((word) =>
    SUFFIXES.has(word.replace(/[.,]/g, '').toLowerCase()),
  );
  if (suffixIndex > 1) words = words.slice(0, suffixIndex);

  if (words.length === 0) {
    return { firstName: none(), middleName: none(), lastName: none(), fullName: none() };
  }

  const fullName = words.join(' ');
  const display = toDisplayCase(fullName);

  if (words.length === 1) {
    // A single token is a mononym; guessing a surname would invent data.
    return {
      firstName: found(toDisplayCase(words[0]!), confidence, note),
      middleName: none(),
      lastName: none(),
      fullName: found(display, confidence, note),
    };
  }

  // Keep particles attached to the surname: "van der Berg", "de Souza".
  let lastStart = words.length - 1;
  while (lastStart > 1 && NAME_PARTICLES.has(words[lastStart - 1]!.toLowerCase())) lastStart--;

  const first = words[0]!;
  const last = words.slice(lastStart).join(' ');
  const middle = words.slice(1, lastStart).join(' ');

  return {
    firstName: found(toDisplayCase(first), confidence, note),
    middleName: middle ? found(toDisplayCase(middle), confidence - 0.1, note) : none(),
    lastName: found(
      toDisplayCase(last),
      confidence,
      surnameFirst ? `${note} (written surname first)` : note,
    ),
    fullName: found(display, confidence, note),
  };
}

/** ALL-CAPS names are a styling choice; forms want the real casing. */
function toDisplayCase(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (NAME_PARTICLES.has(word)) return word;
      return word.replace(
        /(^|[-'’])(\p{Ll})/gu,
        (_, prefix: string, letter: string) => prefix + letter.toUpperCase(),
      );
    })
    .join(' ');
}

/* -------------------------------------------------------------- location */

type LocationParts = Pick<ParsedContact, 'location' | 'city' | 'state' | 'country' | 'postalCode'>;

const US_STATES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
]);

const COUNTRY_RE =
  /\b(?:India|United\s+States(?:\s+of\s+America)?|USA|U\.S\.A\.|U\.S\.|Canada|United\s+Kingdom|UK|Germany|France|Australia|Singapore|Netherlands|Ireland|Japan|China|Brazil|Spain|Italy|Sweden|Switzerland|Poland|Mexico|New\s+Zealand|UAE|United\s+Arab\s+Emirates)\b/i;

function findLocation(headerLines: string[]): LocationParts {
  const empty: LocationParts = {
    location: none(),
    city: none(),
    state: none(),
    country: none(),
    postalCode: none(),
  };

  for (const rawLine of headerLines.slice(0, 8)) {
    // Contact lines are often "email | phone | City, ST"; test each piece.
    for (const piece of rawLine.split(/\s*[|·•▪]\s*|\t+/)) {
      const line = normalizeWhitespace(piece);
      if (!line || line.length > 70) continue;
      if (line.includes('@') || /https?:|www\./i.test(line)) continue;
      if (!line.includes(',') && !COUNTRY_RE.test(line)) continue;
      // Reject anything dominated by digits — that is a phone or a date.
      const digits = line.replace(/\D/g, '').length;
      if (digits > 7) continue;

      const parts = line
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0 || parts.length > 4) continue;
      if (!parts.every((part) => /^[A-Za-z][A-Za-z .'’-]*(?:\s+\d{4,6})?$/.test(part))) continue;

      return interpretLocation(parts, line);
    }
  }

  return empty;
}

function interpretLocation(parts: string[], line: string): LocationParts {
  const result: LocationParts = {
    location: found(line, 0.8, 'found in the contact block'),
    city: none(),
    state: none(),
    country: none(),
    postalCode: none(),
  };

  const postal = line.match(/\b\d{5}(?:-\d{4})?\b|\b\d{6}\b/);
  if (postal) result.postalCode = found(postal[0], 0.75, 'postal code in the contact block');

  // "Austin, TX 78701" — the postal code rides along with the state. Remove it
  // before the parts are interpreted, or the state comes out as "TX 78701".
  parts = parts
    .map((part) => part.replace(/\s*\b\d{5}(?:-\d{4})?\b|\s*\b\d{6}\b/g, '').trim())
    .filter(Boolean);

  const tail = parts[parts.length - 1] ?? '';
  const countryMatch = tail.match(COUNTRY_RE);

  if (countryMatch) {
    result.country = found(canonicalCountry(countryMatch[0]), 0.85, 'named in the contact block');
    parts = parts.slice(0, -1);
  }

  if (parts.length >= 2) {
    result.city = found(parts[0]!, 0.8, 'first part of the location line');
    const region = parts[1]!;
    const upper = region.toUpperCase();
    if (US_STATES.has(upper)) {
      result.state = found(upper, 0.9, 'two-letter state code');
      if (!result.country.value) {
        result.country = found('United States', 0.7, 'implied by the state code');
      }
    } else {
      result.state = found(region, 0.68, 'second part of the location line');
    }
  } else if (parts.length === 1 && !result.country.value) {
    result.city = found(parts[0]!, 0.6, 'only one location token was present');
  } else if (parts.length === 1) {
    result.city = found(parts[0]!, 0.75, 'first part of the location line');
  }

  return result;
}

function canonicalCountry(value: string): string {
  const normalized = value.replace(/\./g, '').toUpperCase();
  if (normalized === 'USA' || normalized === 'US' || /UNITED STATES/.test(normalized)) {
    return 'United States';
  }
  if (normalized === 'UK') return 'United Kingdom';
  if (normalized === 'UAE') return 'United Arab Emirates';
  return value.replace(/\s+/g, ' ').trim();
}

/* ----------------------------------------------------------------- utils */

function matchAll(text: string, pattern: RegExp): string[] {
  // Clone so the shared /g regexes never carry lastIndex between calls.
  const re = new RegExp(pattern.source, pattern.flags);
  return Array.from(text.matchAll(re), (match) => match[0]);
}
