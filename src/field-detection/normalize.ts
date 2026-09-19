/**
 * Text normalisation for field matching.
 *
 * Website labels are written by thousands of different developers. Before any
 * rule can match, the text has to be reduced to a comparable shape: "Legal
 * First Name *", "legal_first_name", "legalFirstName" and "Legal first name
 * (required)" must all collapse to "legal first name".
 */

/** Markers that decorate a label but carry no meaning for matching. */
const DECORATION_RE =
  /\((?:required|optional|mandatory|if applicable|please specify|max \d+[^)]*)\)|\*|\brequired\b|\boptional\b|\bmandatory\b/gi;

/**
 * Splits camelCase and PascalCase into words.
 * "legalFirstName" → "legal First Name", "URLField" → "URL Field".
 */
export function splitCamelCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/**
 * Canonical form used by every matching rule.
 *
 * Punctuation is replaced by spaces rather than removed: "e-mail" must become
 * "e mail" (which the synonym pass maps to "email"), not "email" by accident,
 * and "first/given name" must split into words rather than fusing.
 */
export function normalizeLabel(raw: string): string {
  if (!raw) return '';
  return applySynonyms(
    splitCamelCase(raw)
      .replace(DECORATION_RE, ' ')
      .toLowerCase()
      // Keep letters, digits and spaces; everything else becomes a separator.
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Vocabulary levelling.
 *
 * Only unambiguous equivalences belong here. Anything context-dependent is left
 * to the rules, where it can be weighed against other signals — rewriting it
 * this early would destroy information the classifier needs.
 */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\be mail\b/g, 'email'],
  [/\bemail address\b/g, 'email'],
  [/\bphone number\b/g, 'phone'],
  [/\btelephone\b/g, 'phone'],
  [/\bmobile number\b/g, 'mobile'],
  [/\bcell phone\b/g, 'mobile'],
  [/\bcell\b/g, 'mobile'],
  [/\bgiven name\b/g, 'first name'],
  [/\bforename\b/g, 'first name'],
  [/\bchristian name\b/g, 'first name'],
  [/\bsurname\b/g, 'last name'],
  [/\bfamily name\b/g, 'last name'],
  [/\bpost code\b/g, 'postal code'],
  [/\bpostcode\b/g, 'postal code'],
  [/\bzip code\b/g, 'postal code'],
  [/\bzip\b/g, 'postal code'],
  [/\bpin code\b/g, 'postal code'],
  [/\bprovince\b/g, 'state'],
  [/\bcounty\b/g, 'state'],
  [/\bcv\b/g, 'resume'],
  [/\bcurriculum vitae\b/g, 'resume'],
  [/\buniversity college\b/g, 'university'],
  [/\bschool name\b/g, 'school'],
  [/\bemployer name\b/g, 'employer'],
  [/\bcompany name\b/g, 'company'],
  [/\bjob title\b/g, 'title'],
  [/\bwebsite url\b/g, 'website'],
  [/\bweb site\b/g, 'website'],
  [/\bhome page\b/g, 'website'],
  [/\blinked in\b/g, 'linkedin'],
  [/\bgit hub\b/g, 'github'],
  [/\bstack overflow\b/g, 'stackoverflow'],
  [/\bdate of birth\b/g, 'birth date'],
  [/\bdob\b/g, 'birth date'],
  [/\bgpa\b/g, 'gpa'],
  [/\bc gpa\b/g, 'gpa'],
  [/\bcgpa\b/g, 'gpa'],
  [/\bgrade point average\b/g, 'gpa'],
  [/\bfield of study\b/g, 'major'],
  [/\bcourse of study\b/g, 'major'],
  [/\bdiscipline\b/g, 'major'],
  [/\bspecialisation\b/g, 'specialization'],
  [/\bgrad(?:uation)? (?:date|year)\b/g, 'graduation date'],
  [/\bauthorised\b/g, 'authorized'],
  [/\bauthorisation\b/g, 'authorization'],
  [/\bwilling to relocate\b/g, 'relocate'],
  [/\bn\/a\b/g, ''],
];

export function applySynonyms(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SYNONYMS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Whole-word containment: "name" must not match inside "username". */
export function containsPhrase(haystack: string, phrase: string): boolean {
  if (!haystack || !phrase) return false;
  // Check every occurrence: "username or first name" contains "name" as a
  // whole phrase even though the first hit is inside "username".
  for (
    let index = haystack.indexOf(phrase);
    index !== -1;
    index = haystack.indexOf(phrase, index + 1)
  ) {
    const before = index === 0 ? ' ' : haystack[index - 1];
    const afterIndex = index + phrase.length;
    const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];
    if (before === ' ' && after === ' ') return true;
  }
  return false;
}

/** True when the text reads as an open question rather than a field label. */
export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  // "Tell us why you…", "Describe a time when…", "In 200 words, explain…"
  return /^(?:tell us|describe|explain|why |what |how |share |walk us|in your own words|please describe|please explain|please tell)/i.test(
    trimmed,
  );
}

/** Rough word count, used to distinguish a label from an essay prompt. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
