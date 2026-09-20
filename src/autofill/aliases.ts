/**
 * Equivalent spellings for dropdown options.
 *
 * Trust boundary: pure data and string functions; no DOM, no profile.
 *
 * Deliberately limited to three vocabularies where the equivalence is a fact,
 * not a judgement: countries ("USA" is "United States of America"), degree
 * abbreviations ("B.Tech" is "Bachelor of Technology") and month names ("Sep"
 * is "September"), including their names in the supported locales ("Deutschland",
 * "Septembre"). Anything else that does not match exactly stays ambiguous
 * and goes to review — a near-miss on a job application is worse than a gap.
 */

import { countryAliasGroups } from './countries';
import { foldText } from '@/utils/fold';

/**
 * Country names in the supported form languages (de, fr, es, pt, nl, it).
 * Each group joins the country table's group that shares a member.
 */
const COUNTRY_TRANSLATIONS: string[][] = [
  [
    'united states',
    'united states of america',
    'usa',
    'us',
    'u s',
    'u s a',
    'america',
    'vereinigte staaten',
    'vereinigte staaten von amerika',
    'etats unis',
    'etats unis d amerique',
    'estados unidos',
    'estados unidos de america',
    'verenigde staten',
    'stati uniti',
    'stati uniti d america',
  ],
  [
    'united kingdom',
    'uk',
    'u k',
    'great britain',
    'britain',
    'united kingdom of great britain and northern ireland',
    'vereinigtes konigreich',
    'grossbritannien',
    'royaume uni',
    'grande bretagne',
    'reino unido',
    'gran bretana',
    'gra bretanha',
    'verenigd koninkrijk',
    'groot brittannie',
    'regno unito',
    'gran bretagna',
  ],
  [
    'united arab emirates',
    'uae',
    'u a e',
    'vereinigte arabische emirate',
    'emirats arabes unis',
    'emiratos arabes unidos',
    'emirados arabes unidos',
    'verenigde arabische emiraten',
    'emirati arabi uniti',
  ],
  [
    'south korea',
    'korea republic of',
    'republic of korea',
    'korea south',
    'sudkorea',
    'coree du sud',
    'corea del sur',
    'coreia do sul',
    'zuid korea',
    'corea del sud',
  ],
  [
    'netherlands',
    'the netherlands',
    'holland',
    'niederlande',
    'pays bas',
    'paises bajos',
    'paises baixos',
    'nederland',
    'paesi bassi',
  ],
  ['czechia', 'czech republic', 'tschechien', 'tchequie', 'chequia', 'tsjechie', 'repubblica ceca'],
  ['russia', 'russian federation', 'russland', 'russie', 'rusia', 'rusland'],
  ['viet nam', 'vietnam'],
  ['india', 'republic of india', 'bharat', 'indien', 'inde', 'indie'],
  ['germany', 'deutschland', 'allemagne', 'alemania', 'alemanha', 'duitsland', 'germania'],
  ['france', 'frankreich', 'francia', 'franca', 'frankrijk'],
  ['spain', 'spanien', 'espagne', 'espana', 'espanha', 'spanje', 'spagna'],
  ['portugal', 'portogallo'],
  ['italy', 'italien', 'italie', 'italia'],
  ['brazil', 'brasilien', 'bresil', 'brasil', 'brazilie', 'brasile'],
  ['mexico', 'mexiko', 'mexique', 'messico'],
  ['belgium', 'belgien', 'belgique', 'belgica', 'belgie', 'belgio'],
  ['switzerland', 'schweiz', 'suisse', 'suiza', 'suica', 'zwitserland', 'svizzera'],
  ['austria', 'osterreich', 'autriche', 'oostenrijk'],
  ['canada', 'kanada'],
];

function withTranslations(groups: string[][]): string[][] {
  const out = groups.map((group) => [...group]);
  for (const extra of COUNTRY_TRANSLATIONS) {
    const home = out.find((group) => extra.some((name) => group.includes(name)));
    if (home) home.push(...extra.filter((name) => !home.includes(name)));
    else out.push([...extra]);
  }
  return out;
}

const GROUPS: string[][] = [
  // countries: shared with work-authorisation detection, see ./countries,
  // plus their names in the supported form languages
  ...withTranslations(countryAliasGroups()),
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
  [
    'january',
    'jan',
    'januar',
    'janner',
    'janvier',
    'janv',
    'enero',
    'ene',
    'janeiro',
    'januari',
    'gennaio',
  ],
  [
    'february',
    'feb',
    'februar',
    'fevrier',
    'fevr',
    'febrero',
    'fevereiro',
    'fev',
    'februari',
    'febbraio',
  ],
  ['march', 'mar', 'marz', 'maerz', 'mrz', 'mars', 'marzo', 'marco', 'maart', 'mrt'],
  ['april', 'apr', 'avril', 'avr', 'abril', 'abr', 'aprile'],
  ['may', 'mai', 'mayo', 'maio', 'mei', 'maggio'],
  ['june', 'jun', 'juni', 'juin', 'junio', 'junho', 'giugno'],
  ['july', 'jul', 'juli', 'juillet', 'juil', 'julio', 'julho', 'luglio'],
  ['august', 'aug', 'aout', 'agosto', 'augustus'],
  ['september', 'sep', 'sept', 'septembre', 'septiembre', 'setiembre', 'setembro', 'settembre'],
  ['october', 'oct', 'oktober', 'okt', 'octobre', 'octubre', 'outubro', 'ottobre'],
  ['november', 'nov', 'novembre', 'noviembre', 'novembro'],
  ['december', 'dec', 'dezember', 'dez', 'decembre', 'diciembre', 'dic', 'dezembro', 'dicembre'],
];

/**
 * Lower-case, diacritics folded, punctuation to spaces, collapsed.
 * "B.Tech." → "b tech", "España" → "espana".
 */
export function normalizeOptionText(text: string): string {
  return foldText(text)
    .replace(/['’]s\b/g, 's')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
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

/**
 * Yes and No in the supported languages (de, fr, es, pt, nl, it), folded.
 * English stays with each caller's own list; these only add the translations
 * so a stored "Yes" can select "Ja", "Oui", "Sí", "Sim" or "Sì".
 */
const LOCALE_YES = new Set(['ja', 'oui', 'si', 'sim']);
const LOCALE_NO = new Set(['nein', 'non', 'no', 'nao', 'nee']);

/** 'yes' / 'no' when the text is a translated Yes or No, otherwise null. */
export function localeYesNo(text: string): 'yes' | 'no' | null {
  const key = normalizeOptionText(text);
  if (LOCALE_YES.has(key)) return 'yes';
  if (LOCALE_NO.has(key)) return 'no';
  return null;
}
