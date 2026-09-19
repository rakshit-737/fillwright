/**
 * Equivalent spellings for dropdown options.
 *
 * Trust boundary: pure data and string functions; no DOM, no profile.
 *
 * Deliberately limited to three vocabularies where the equivalence is a fact,
 * not a judgement: countries ("USA" is "United States of America"), degree
 * abbreviations ("B.Tech" is "Bachelor of Technology") and month names ("Sep"
 * is "September"). Anything else that does not match exactly stays ambiguous
 * and goes to review — a near-miss on a job application is worse than a gap.
 */

import { countryAliasGroups } from './countries';

const GROUPS: string[][] = [
  // countries: shared with work-authorisation detection, see ./countries
  ...countryAliasGroups(),
  // degrees
  ['bachelor of technology', 'b tech', 'btech', 'b tech hons'],
  ['bachelor of engineering', 'b e', 'be', 'b eng', 'beng'],
  ['bachelor of science', 'b s', 'bs', 'b sc', 'bsc'],
  ['bachelor of arts', 'b a', 'ba'],
  ['bachelor of commerce', 'b com', 'bcom'],
  ['bachelor of computer applications', 'bca', 'b c a'],
  ['master of technology', 'm tech', 'mtech'],
  ['master of science', 'm s', 'ms', 'm sc', 'msc'],
  ['master of arts', 'm a', 'ma'],
  ['master of business administration', 'mba', 'm b a'],
  ['master of computer applications', 'mca', 'm c a'],
  ['doctor of philosophy', 'phd', 'ph d', 'doctorate'],
  ['high school diploma', 'high school', 'secondary school', 'hsc', 'ged'],
  [
    'associate degree',
    "associate's degree",
    'associates degree',
    'associate of arts',
    'associate of science',
  ],
  // months
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];

/** Lower-case, punctuation to spaces, collapsed. "B.Tech." → "b tech". */
export function normalizeOptionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CANONICAL = new Map<string, string>();
for (const group of GROUPS) {
  const head = group[0]!;
  for (const member of group) CANONICAL.set(normalizeOptionText(member), head);
}

/** The shared key for a known alias, or null when the text is not in the table. */
export function aliasKey(text: string): string | null {
  return CANONICAL.get(normalizeOptionText(text)) ?? null;
}

/** True when both texts are known spellings of the same thing. */
export function sameByAlias(a: string, b: string): boolean {
  const left = aliasKey(a);
  return left !== null && left === aliasKey(b);
}

/**
 * True when one text contains the other as whole words: "India (IN)" contains
 * "India", but "Indiana" does not, and "Country 99999" does not contain
 * "Country 999".
 */
export function containsWords(a: string, b: string): boolean {
  const left = ` ${normalizeOptionText(a)} `;
  const right = ` ${normalizeOptionText(b)} `;
  if (left.trim() === '' || right.trim() === '') return false;
  return left.includes(right) || right.includes(left);
}

const MONTH_HEADS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * The month a dropdown option or stored text stands for, 1..12, or null.
 * Reads names and abbreviations through the alias table ("Sept" is 9) and
 * plain numbers ("08" and "8" are 8). Anything else is not a month.
 */
export function monthNumber(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d{1,2}$/.test(trimmed)) {
    const number = Number(trimmed);
    return number >= 1 && number <= 12 ? number : null;
  }
  const key = aliasKey(trimmed);
  const index = key === null ? -1 : MONTH_HEADS.indexOf(key);
  return index === -1 ? null : index + 1;
}
