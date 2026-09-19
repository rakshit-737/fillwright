import type { CanonicalField } from '@/types/fields';
import type { Profile, SensitiveAnswers } from '@/types/profile';

/**
 * High-risk data control.
 *
 * Some application questions carry legal and discrimination risk, and a wrong
 * answer can cost someone a job or misrepresent them to an employer. Fillwright
 * therefore treats these as a category that can only ever be answered from an
 * explicit user setting — never from a resume, and never from an inference.
 *
 * The rules here are enforced in two places:
 *   - `stripSensitive` guards the resume merge path, so a parser bug can never
 *     write into `profile.sensitive`.
 *   - `requiresExplicitConsent` guards the autofill path, so a field classified
 *     as sensitive is surfaced for confirmation instead of being filled.
 */

export const SENSITIVE_FIELDS: ReadonlySet<CanonicalField> = new Set<CanonicalField>([
  'sensitive.workAuthorization',
  'sensitive.requiresSponsorship',
  'sensitive.visaStatus',
  'sensitive.gender',
  'sensitive.raceEthnicity',
  'sensitive.disabilityStatus',
  'sensitive.veteranStatus',
  'sensitive.criminalHistory',
  'sensitive.securityClearance',
  'sensitive.willingToRelocate',
  'sensitive.willingToTravel',
  'sensitive.drugTestConsent',
  'sensitive.backgroundCheckConsent',
  'preferences.desiredSalary',
  'sensitive.currentSalary',
]);

/**
 * Fields that must never be auto-filled even when a value exists, because the
 * answer is a legal declaration rather than a fact about the candidate.
 */
export const ALWAYS_CONFIRM: ReadonlySet<CanonicalField> = new Set<CanonicalField>([
  'sensitive.criminalHistory',
  'sensitive.drugTestConsent',
  'sensitive.backgroundCheckConsent',
  'sensitive.securityClearance',
]);

export function isSensitiveField(field: CanonicalField): boolean {
  return SENSITIVE_FIELDS.has(field);
}

export function requiresExplicitConsent(field: CanonicalField): boolean {
  return ALWAYS_CONFIRM.has(field);
}

/**
 * Returns the sensitive branch untouched from the existing profile.
 *
 * Called on every merge of parsed resume data. Because the merge always takes
 * this branch from the stored profile rather than from parser output, there is
 * no code path by which a resume can populate a demographic or authorisation
 * answer, regardless of what the parser produced.
 */
export function preserveSensitive(existing: Profile): SensitiveAnswers {
  return structuredClone(existing.sensitive);
}

/**
 * Development-time assertion that parser output contains no sensitive keys.
 *
 * Runs in tests and in dev builds. It exists to catch a future contributor
 * adding, say, gender detection to the parser: the merge would silently start
 * carrying it, and this makes that failure loud instead.
 */
export function assertNoSensitiveInference(parsed: unknown): void {
  const offenders = findSensitiveKeys(parsed);
  if (offenders.length > 0) {
    throw new Error(
      `Parser output must not contain sensitive fields, but found: ${offenders.join(', ')}. ` +
        'Sensitive answers may only come from explicit user input.',
    );
  }
}

const FORBIDDEN_KEY_RE =
  /^(?:gender|sex|race|ethnicity|raceEthnicity|disability|disabilityStatus|veteran|veteranStatus|citizenship|nationality|workAuthorization|authorizedIn|requiresSponsorship|sponsorship|visaStatus|criminalHistory|conviction|securityClearance|salary|currentSalary|expectedSalary|compensation)$/i;

function findSensitiveKeys(value: unknown, path = '', depth = 0): string[] {
  if (depth > 8 || value === null || typeof value !== 'object') return [];

  const offenders: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      offenders.push(...findSensitiveKeys(item, `${path}[${index}]`, depth + 1));
    });
    return offenders;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEY_RE.test(key)) offenders.push(nextPath);
    offenders.push(...findSensitiveKeys(child, nextPath, depth + 1));
  }
  return offenders;
}
