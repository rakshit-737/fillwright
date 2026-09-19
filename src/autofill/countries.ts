/**
 * One table of countries, used both to read which country a work-authorisation
 * question is about and to match country dropdown options ("USA" is "United
 * States").
 *
 * Trust boundary: pure data and string functions; no DOM, no profile.
 *
 * Matching rules, because a wrong country here means a sensitive answer given
 * for the wrong jurisdiction:
 * - `names` and `demonyms` match case-insensitively as whole words.
 * - `abbreviations` match case-SENSITIVELY as whole tokens. "US" is the United
 *   States; "us" in "let us know" is a pronoun. Bare "US" is also ignored
 *   next to an all-caps word, where "TELL US" is still a pronoun.
 * - Names that are part of a larger place ("New Mexico", "South America",
 *   "Indiana") do not count as the country.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, as stored in profile.sensitive.workAuthorization. */
  code: string;
  /** How a rationale names it: "the United States". */
  display: string;
  /** Full names, lower case. The first is the canonical dropdown key. */
  names: string[];
  demonyms?: string[];
  /** Parts of the country that a question may name; not dropdown aliases. */
  regions?: string[];
  /** Case-sensitive tokens. */
  abbreviations?: string[];
  /** Extra dropdown-only spellings (after punctuation is normalised). */
  optionAliases?: string[];
}

export const COUNTRIES: Country[] = [
  {
    code: 'US',
    display: 'the United States',
    names: ['united states', 'united states of america', 'america'],
    demonyms: ['american'],
    abbreviations: ['US', 'U.S.', 'U.S', 'USA', 'U.S.A.', 'U.S.A'],
    optionAliases: ['usa', 'us', 'u s', 'u s a'],
  },
  {
    code: 'GB',
    display: 'the United Kingdom',
    names: [
      'united kingdom',
      'great britain',
      'britain',
      'united kingdom of great britain and northern ireland',
    ],
    regions: ['england', 'scotland', 'wales'],
    demonyms: ['british'],
    abbreviations: ['UK', 'U.K.', 'U.K'],
    optionAliases: ['uk', 'u k'],
  },
  {
    code: 'AE',
    display: 'the United Arab Emirates',
    names: ['united arab emirates', 'emirates'],
    demonyms: ['emirati'],
    abbreviations: ['UAE', 'U.A.E.'],
    optionAliases: ['uae', 'u a e'],
  },
  {
    code: 'KR',
    display: 'South Korea',
    names: ['south korea', 'korea republic of', 'republic of korea', 'korea south'],
    demonyms: ['south korean'],
  },
  {
    code: 'NL',
    display: 'the Netherlands',
    names: ['netherlands', 'the netherlands', 'holland'],
    demonyms: ['dutch'],
  },
  { code: 'CZ', display: 'Czechia', names: ['czechia', 'czech republic'], demonyms: ['czech'] },
  { code: 'RU', display: 'Russia', names: ['russia', 'russian federation'], demonyms: ['russian'] },
  { code: 'VN', display: 'Vietnam', names: ['viet nam', 'vietnam'], demonyms: ['vietnamese'] },
  {
    code: 'IN',
    display: 'India',
    names: ['india', 'republic of india', 'bharat'],
    demonyms: ['indian'],
  },
  { code: 'CA', display: 'Canada', names: ['canada'], demonyms: ['canadian'] },
  { code: 'AU', display: 'Australia', names: ['australia'], demonyms: ['australian'] },
  {
    code: 'NZ',
    display: 'New Zealand',
    names: ['new zealand', 'aotearoa'],
    demonyms: ['new zealander'],
    abbreviations: ['NZ'],
  },
  {
    code: 'IE',
    display: 'Ireland',
    names: ['ireland', 'republic of ireland'],
    demonyms: ['irish'],
  },
  { code: 'DE', display: 'Germany', names: ['germany', 'deutschland'], demonyms: ['german'] },
  { code: 'FR', display: 'France', names: ['france'], demonyms: ['french'] },
  { code: 'ES', display: 'Spain', names: ['spain'], demonyms: ['spanish'] },
  { code: 'IT', display: 'Italy', names: ['italy'], demonyms: ['italian'] },
  { code: 'PT', display: 'Portugal', names: ['portugal'], demonyms: ['portuguese'] },
  { code: 'BE', display: 'Belgium', names: ['belgium'], demonyms: ['belgian'] },
  { code: 'LU', display: 'Luxembourg', names: ['luxembourg'] },
  { code: 'CH', display: 'Switzerland', names: ['switzerland'], demonyms: ['swiss'] },
  { code: 'AT', display: 'Austria', names: ['austria'], demonyms: ['austrian'] },
  { code: 'SE', display: 'Sweden', names: ['sweden'], demonyms: ['swedish'] },
  { code: 'NO', display: 'Norway', names: ['norway'], demonyms: ['norwegian'] },
  { code: 'DK', display: 'Denmark', names: ['denmark'] },
  { code: 'FI', display: 'Finland', names: ['finland'], demonyms: ['finnish'] },
  { code: 'PL', display: 'Poland', names: ['poland'] },
  { code: 'IL', display: 'Israel', names: ['israel'], demonyms: ['israeli'] },
  { code: 'JP', display: 'Japan', names: ['japan'], demonyms: ['japanese'] },
  { code: 'CN', display: 'China', names: ['china', "people's republic of china"] },
  { code: 'HK', display: 'Hong Kong', names: ['hong kong'] },
  { code: 'TW', display: 'Taiwan', names: ['taiwan'], demonyms: ['taiwanese'] },
  { code: 'SG', display: 'Singapore', names: ['singapore'], demonyms: ['singaporean'] },
  { code: 'MY', display: 'Malaysia', names: ['malaysia'], demonyms: ['malaysian'] },
  { code: 'ID', display: 'Indonesia', names: ['indonesia'], demonyms: ['indonesian'] },
  {
    code: 'PH',
    display: 'the Philippines',
    names: ['philippines', 'the philippines'],
    demonyms: ['filipino'],
  },
  { code: 'TH', display: 'Thailand', names: ['thailand'] },
  { code: 'SA', display: 'Saudi Arabia', names: ['saudi arabia'], demonyms: ['saudi'] },
  { code: 'QA', display: 'Qatar', names: ['qatar'], demonyms: ['qatari'] },
  { code: 'ZA', display: 'South Africa', names: ['south africa'], demonyms: ['south african'] },
  { code: 'NG', display: 'Nigeria', names: ['nigeria'], demonyms: ['nigerian'] },
  { code: 'KE', display: 'Kenya', names: ['kenya'], demonyms: ['kenyan'] },
  { code: 'EG', display: 'Egypt', names: ['egypt'], demonyms: ['egyptian'] },
  { code: 'BR', display: 'Brazil', names: ['brazil', 'brasil'], demonyms: ['brazilian'] },
  { code: 'MX', display: 'Mexico', names: ['mexico'], demonyms: ['mexican'] },
  {
    code: 'AR',
    display: 'Argentina',
    names: ['argentina'],
    demonyms: ['argentine', 'argentinian'],
  },
  { code: 'CL', display: 'Chile', names: ['chile'], demonyms: ['chilean'] },
  { code: 'CO', display: 'Colombia', names: ['colombia'], demonyms: ['colombian'] },
  { code: 'PK', display: 'Pakistan', names: ['pakistan'], demonyms: ['pakistani'] },
  { code: 'BD', display: 'Bangladesh', names: ['bangladesh'], demonyms: ['bangladeshi'] },
  { code: 'LK', display: 'Sri Lanka', names: ['sri lanka'], demonyms: ['sri lankan'] },
  { code: 'NP', display: 'Nepal', names: ['nepal'], demonyms: ['nepali', 'nepalese'] },
];

/**
 * Places whose name contains a country name but which are a different place.
 * Each is rewritten to the country it belongs to (or to nothing) before the
 * scan, so "New Mexico" is not Mexico and "Northern Ireland" is not Ireland.
 */
const PLACES: Record<string, string> = {
  'new mexico': 'united states',
  'new england': 'united states',
  'new south wales': 'australia',
  'british columbia': 'canada',
  'northern ireland': 'united kingdom',
  'north america': '',
  'south america': '',
  'central america': '',
  'latin america': '',
  'north korea': '',
};
const PLACE_RE = new RegExp(
  `\\b(?:${Object.keys(PLACES)
    .map((p) => p.replace(/ /g, '\\s+'))
    .join('|')})(?:ns?)?\\b`,
  'gi',
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Matcher {
  code: string;
  re: RegExp;
  /** Bare "US": skipped in all-caps text. */
  shoutSensitive: boolean;
}

const MATCHERS: Matcher[] = [];
for (const country of COUNTRIES) {
  const words = [...country.names, ...(country.regions ?? []), ...(country.demonyms ?? [])]
    .sort((a, b) => b.length - a.length)
    .map((w) => escape(w).replace(/\\?'/g, "['’]").replace(/ /g, '\\s+'));
  MATCHERS.push({
    code: country.code,
    re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})s?(?![\\p{L}\\p{N}])`, 'giu'),
    shoutSensitive: false,
  });
  for (const abbr of country.abbreviations ?? []) {
    MATCHERS.push({
      code: country.code,
      // Whole token: no letter, digit or dot directly around it.
      re: new RegExp(`(?<![\\p{L}\\p{N}.])${escape(abbr)}(?![\\p{L}\\p{N}]|\\.[\\p{L}])`, 'gu'),
      shoutSensitive: abbr === 'US',
    });
  }
}

/**
 * True when bare "US" sits next to an all-caps word ("TELL US", "US KNOW"),
 * where it is the pronoun shouted, not the country. Judged per occurrence, so
 * a shouted helper line cannot turn a normal-case label into a US question.
 */
function inShoutedText(text: string, index: number, length: number): boolean {
  const before = /(\p{L}+)[^\p{L}]*$/u.exec(text.slice(0, index))?.[1];
  const after = /^[^\p{L}]*(\p{L}+)/u.exec(text.slice(index + length))?.[1];
  const shouted = (w: string | undefined) => !!w && w.length > 1 && !/\p{Ll}/u.test(w);
  if (!before && !after) return true;
  return shouted(before) || shouted(after);
}

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** How a rationale names a country: "the United States". Unknown codes pass through. */
export function countryDisplayName(code: string): string {
  return BY_CODE.get(code)?.display ?? code;
}

/**
 * Every country the text mentions, in the order they first appear, without
 * duplicates. Empty when none is named.
 */
export function detectCountries(text: string): string[] {
  const cleaned = text.replace(PLACE_RE, (m) => {
    const key = m.toLowerCase().replace(/\s+/g, ' ').replace(/ns?$/, '');
    return ` ${PLACES[key] ?? ''} `;
  });
  const found: Array<[number, string]> = [];
  for (const matcher of MATCHERS) {
    matcher.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.re.exec(cleaned))) {
      if (matcher.shoutSensitive && inShoutedText(cleaned, match.index, match[0].length)) continue;
      found.push([match.index, matcher.code]);
      break;
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const codes: string[] = [];
  for (const [, code] of found) if (!codes.includes(code)) codes.push(code);
  return codes;
}

/** The dropdown alias groups for countries: names, abbreviations and option spellings. */
export function countryAliasGroups(): string[][] {
  return COUNTRIES.map((c) => [
    ...c.names,
    ...(c.abbreviations ?? []).map((a) => a.toLowerCase()),
    ...(c.optionAliases ?? []),
  ]);
}
