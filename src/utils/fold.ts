/**
 * Diacritic folding for matching.
 *
 * Trust boundary: pure string function; no DOM, no profile.
 *
 * "Prénom" and "Prenom", "Straße" and "Strasse", "Não" and "Nao" must compare
 * equal, because sites write the same word both ways. NFKD splits an accented
 * letter into its base letter plus combining marks, and the marks are then
 * dropped. The few Latin letters that NFKD does not decompose are spelled out.
 * Letters of other scripts are kept as they are.
 */
const LIGATURES: Array<[RegExp, string]> = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/þ/g, 'th'],
];

/** Lower-cases and removes diacritics: "Città" → "citta". */
export function foldText(value: string): string {
  let out = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '');
  for (const [pattern, replacement] of LIGATURES) out = out.replace(pattern, replacement);
  return out;
}
