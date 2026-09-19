import { containsWords, sameByAlias } from './aliases';
import type { CanonicalField, DetectedField, FieldOption } from '@/types/fields';
import type { Profile, TriState } from '@/types/profile';
import { formatDate } from '@/parser/dates';
import { isSensitiveField } from '@/security/sensitive';

export interface ResolvedValue {
  value: string;
  /** How sure we are the stored value is right for this field, 0..1. */
  confidence: number;
  /** Why this value, in plain English. */
  note: string;
  /**
   * True when the field is high-risk and the user has not given an answer.
   * The planner turns this into "needs your confirmation" rather than a blank.
   */
  needsConsent: boolean;
}

const none = (note = ''): ResolvedValue => ({
  value: '',
  confidence: 0,
  note,
  needsConsent: false,
});

/**
 * Produces the value Fillwright would write into a given canonical field.
 *
 * Two rules hold without exception:
 *
 *  1. A sensitive field resolves to a value ONLY if the user explicitly set one
 *     in Application preferences. `unset` is never turned into "No".
 *  2. Nothing is fabricated. A field with no stored value resolves to empty, and
 *     the planner reports it as missing rather than inventing something.
 */
export function resolveValue(
  field: CanonicalField,
  profile: Profile,
  entryIndex = 0,
): ResolvedValue {
  const education = educationAt(profile, entryIndex);
  const experience = experienceAt(profile, entryIndex);

  // A repeated block beyond what the profile holds must not silently fall back
  // to the first entry — that is how a form ends up claiming the candidate
  // attended the same university twice.
  if (entryIndex > 0 && groupIsExhausted(field, profile, entryIndex)) {
    return none(
      field.startsWith('education.')
        ? `your profile has ${profile.education.length} education ${plural(profile.education.length, 'entry', 'entries')}, and this is block ${entryIndex + 1}`
        : `your profile has ${profile.experience.length} ${plural(profile.experience.length, 'role', 'roles')}, and this is block ${entryIndex + 1}`,
    );
  }

  switch (field) {
    /* ------------------------------------------------------------ identity */
    case 'personal.firstName':
      return fromTracked(profile.personal.firstName);
    case 'personal.middleName':
      return fromTracked(profile.personal.middleName);
    case 'personal.lastName':
      return fromTracked(profile.personal.lastName);
    case 'personal.fullName': {
      const stored = fromTracked(profile.personal.fullName);
      if (stored.value) return stored;
      // Compose it, but say so — a composed name can be wrong for people whose
      // legal name is ordered differently.
      const parts = [profile.personal.firstName.value, profile.personal.lastName.value].filter(
        Boolean,
      );
      return parts.length === 2
        ? {
            value: parts.join(' '),
            confidence: 0.8,
            note: 'built from your first and last name',
            needsConsent: false,
          }
        : none('no name is stored');
    }
    case 'personal.preferredName': {
      const preferred = fromTracked(profile.personal.preferredName);
      return preferred.value ? preferred : fromTracked(profile.personal.firstName);
    }
    case 'personal.pronouns':
      return fromTracked(profile.personal.pronouns);
    case 'personal.email':
      return fromTracked(profile.personal.email);
    case 'personal.phone':
      return fromTracked(profile.personal.phone);
    case 'personal.dateOfBirth':
      return fromTracked(profile.personal.dateOfBirth);

    /* ------------------------------------------------------------- address */
    case 'address.line1':
      return fromTracked(profile.address.line1);
    case 'address.line2':
      return fromTracked(profile.address.line2);
    case 'address.city':
      return fromTracked(profile.address.city);
    case 'address.state':
      return fromTracked(profile.address.state);
    case 'address.postalCode':
      return fromTracked(profile.address.postalCode);
    case 'address.country':
      return fromTracked(profile.address.country);
    case 'address.formatted': {
      const stored = fromTracked(profile.address.formatted);
      if (stored.value) return stored;
      const parts = [
        profile.address.city.value,
        profile.address.state.value,
        profile.address.country.value,
      ]
        .filter(Boolean)
        .join(', ');
      return parts
        ? {
            value: parts,
            confidence: 0.82,
            note: 'built from your city, state and country',
            needsConsent: false,
          }
        : none('no location is stored');
    }

    /* --------------------------------------------------------------- links */
    case 'links.linkedin':
      return fromTracked(profile.links.linkedin);
    case 'links.github':
      return fromTracked(profile.links.github);
    case 'links.twitter':
      return fromTracked(profile.links.twitter);
    case 'links.stackoverflow':
      return fromTracked(profile.links.stackoverflow);
    case 'links.portfolio': {
      const portfolio = fromTracked(profile.links.portfolio);
      return portfolio.value ? portfolio : fromTracked(profile.links.website);
    }
    case 'links.website': {
      const website = fromTracked(profile.links.website);
      return website.value ? website : fromTracked(profile.links.portfolio);
    }

    /* ----------------------------------------------------------- education */
    case 'education.institution':
      return fromEntry(education?.institution, education, 'your most recent education entry');
    case 'education.degree':
      return fromEntry(education?.degree, education, 'your most recent education entry');
    case 'education.major':
      return fromEntry(education?.major, education, 'your most recent education entry');
    case 'education.minor':
      return fromEntry(education?.minor, education, 'your most recent education entry');
    case 'education.gpa':
      return fromEntry(education?.gpa, education, 'your most recent education entry');
    case 'education.startDate':
      return fromEntry(education?.startDate, education, 'your most recent education entry');
    case 'education.endDate':
    case 'education.graduationDate':
      return fromEntry(
        education?.graduationDate || education?.endDate,
        education,
        'your most recent education entry',
      );

    /* ---------------------------------------------------------- experience */
    case 'experience.company':
      return fromEntry(experience?.company, experience, 'your current or most recent role');
    case 'experience.title':
      return fromEntry(experience?.title, experience, 'your current or most recent role');
    case 'experience.startDate':
      return fromEntry(experience?.startDate, experience, 'your current or most recent role');
    case 'experience.endDate':
      return fromEntry(experience?.endDate, experience, 'your current or most recent role');
    case 'experience.description':
      return fromEntry(experience?.description, experience, 'your current or most recent role');
    case 'experience.yearsOfExperience': {
      const months = totalMonthsOfExperience(profile);
      if (months === 0) return none('no work history is stored');
      // Whole years completed, never rounded up. Under a year there is no
      // honest number to write, so the question goes to review.
      if (months < 12) {
        return {
          ...none('your work history adds up to less than one year'),
          needsConsent: true,
        };
      }
      return {
        value: String(Math.floor(months / 12)),
        confidence: 0.7,
        note: 'calculated from your work history',
        needsConsent: false,
      };
    }

    /* ------------------------------------------------------------- profile */
    case 'profile.summary':
      return fromTracked(profile.summary);
    case 'profile.skills': {
      const skills = profile.skills.map((skill) => skill.name).filter(Boolean);
      return skills.length
        ? {
            value: skills.join(', '),
            confidence: 0.85,
            note: 'from your skills list',
            needsConsent: false,
          }
        : none('no skills are stored');
    }

    /* --------------------------------------------------------- preferences */
    case 'preferences.startDate':
      return fromPreference(profile.preferences.earliestStartDate, 'your earliest start date');
    case 'preferences.noticePeriod':
      return fromPreference(profile.preferences.noticePeriod, 'your notice period');
    case 'preferences.workMode':
      return fromPreference(profile.preferences.workModePreference, 'your work mode preference');
    case 'preferences.referredBy':
      return fromPreference(profile.preferences.referredBy, 'your referral');
    case 'preferences.howDidYouHear':
      return fromPreference(profile.preferences.howDidYouHear, 'how you heard about the role');

    /* ----------------------------------------------------------- sensitive */
    case 'preferences.desiredSalary': {
      if (!profile.sensitive.compensation.shareCompensation) {
        return {
          ...none('salary answers are switched off in your preferences'),
          needsConsent: true,
        };
      }
      return fromPreference(profile.sensitive.compensation.expectedSalary, 'your expected salary');
    }

    case 'sensitive.workAuthorization':
    case 'sensitive.requiresSponsorship':
      // Country-specific, so these are resolved by resolveForField, which can
      // see the question text. Without a country there is nothing to answer.
      return { ...none('needs the country from the question'), needsConsent: true };

    case 'sensitive.visaStatus':
      return sensitiveText(profile.sensitive.workAuthorization.visaStatus, 'your visa status');

    case 'sensitive.gender':
      return demographic(profile, profile.sensitive.demographics.gender, 'your gender answer');
    case 'sensitive.raceEthnicity':
      return demographic(
        profile,
        profile.sensitive.demographics.raceEthnicity,
        'your ethnicity answer',
      );
    case 'sensitive.disabilityStatus':
      return demographic(
        profile,
        profile.sensitive.demographics.disabilityStatus,
        'your disability answer',
      );
    case 'sensitive.veteranStatus':
      return demographic(
        profile,
        profile.sensitive.demographics.veteranStatus,
        'your veteran status answer',
      );

    case 'sensitive.securityClearance':
      return sensitiveText(profile.sensitive.background.securityClearance, 'your clearance answer');
    case 'sensitive.criminalHistory':
      return fromTriState(profile.sensitive.background.criminalHistory, 'your declaration');
    case 'sensitive.drugTestConsent':
      return fromTriState(profile.sensitive.background.drugTestConsent, 'your consent answer');
    case 'sensitive.backgroundCheckConsent':
      return fromTriState(
        profile.sensitive.background.backgroundCheckConsent,
        'your consent answer',
      );
    case 'sensitive.willingToRelocate':
      return fromTriState(profile.sensitive.relocation.willingToRelocate, 'your relocation answer');
    case 'sensitive.willingToTravel':
      return fromTriState(profile.sensitive.relocation.willingToTravel, 'your travel answer');

    default:
      return none();
  }
}

/**
 * Resolves a value for a specific detected field.
 *
 * Adds the context the plain field-level resolver cannot see: which country a
 * work-authorisation question is about, and which of a select's options the
 * stored value corresponds to.
 */
export function resolveForField(
  field: CanonicalField,
  detected: DetectedField,
  profile: Profile,
  entryIndex = 0,
): ResolvedValue & { optionValue?: string } {
  let resolved =
    field === 'sensitive.workAuthorization' || field === 'sensitive.requiresSponsorship'
      ? resolveAuthorization(field, detected, profile)
      : resolveValue(field, profile, entryIndex);

  if (!resolved.value) return resolved;

  // Dates: match the precision the control actually wants.
  if (detected.kind === 'date' || detected.kind === 'month') {
    resolved = { ...resolved, value: formatForDateInput(resolved.value, detected.kind) };
    if (!resolved.value) {
      return {
        ...none('the stored date is not precise enough for this field'),
        needsConsent: resolved.needsConsent,
      };
    }
  } else if (/date|graduation/i.test(field) && /^\d{4}(?:-\d{2})?$/.test(resolved.value)) {
    // A text field reads better as "May 2026" than "2026-05".
    resolved = { ...resolved, value: formatDate(resolved.value) };
  }

  if (detected.options.length > 0) {
    const match = matchOption(resolved.value, detected.options);
    if (!match) {
      return {
        ...resolved,
        value: '',
        confidence: 0,
        note: `none of the available options match "${resolved.value}"`,
      };
    }
    return {
      ...resolved,
      value: match.option.label,
      optionValue: match.option.value,
      confidence: Math.min(resolved.confidence, match.confidence),
      note: match.exact ? resolved.note : `${resolved.note} (closest matching option)`,
    };
  }

  return resolved;
}

/* ---------------------------------------------------------- authorisation */

/**
 * Work authorisation is always about a specific country, so the country is read
 * from the question text. If the question names a country the user has not
 * answered for, nothing is filled — an answer for the US says nothing about
 * the UK.
 */
function resolveAuthorization(
  field: 'sensitive.workAuthorization' | 'sensitive.requiresSponsorship',
  detected: DetectedField,
  profile: Profile,
): ResolvedValue {
  const question = `${detected.signals.labelText} ${detected.signals.ariaLabel} ${detected.signals.precedingText}`;
  const country = detectCountry(question);
  const answers =
    field === 'sensitive.workAuthorization'
      ? profile.sensitive.workAuthorization.authorizedIn
      : profile.sensitive.workAuthorization.requiresSponsorship;

  if (!country) {
    const codes = Object.keys(answers);
    // Exactly one country answered and no country named in the question: still
    // not safe to assume they are the same one.
    return {
      ...none(
        codes.length === 0
          ? 'you have not answered work authorisation for any country'
          : 'this question does not say which country it is about',
      ),
      needsConsent: true,
    };
  }

  const answer = answers[country];
  if (!answer || answer === 'unset') {
    return {
      ...none(`you have not answered this for ${country}`),
      needsConsent: true,
    };
  }

  return {
    value: answer === 'yes' ? 'Yes' : 'No',
    confidence: 0.9,
    note: `your saved answer for ${country}`,
    needsConsent: false,
  };
}

const COUNTRY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:united states|usa|u\.s\.a|u\.s\.|america|us\b)/i, 'US'],
  [/\b(?:india|indian)\b/i, 'IN'],
  [/\b(?:united kingdom|uk\b|britain|england)\b/i, 'GB'],
  [/\bcanada|canadian\b/i, 'CA'],
  [/\baustralia\b/i, 'AU'],
  [/\bgermany\b/i, 'DE'],
  [/\bireland\b/i, 'IE'],
  [/\bnetherlands\b/i, 'NL'],
  [/\bsingapore\b/i, 'SG'],
  [/\b(?:uae|united arab emirates)\b/i, 'AE'],
];

export function detectCountry(text: string): string | null {
  for (const [pattern, code] of COUNTRY_PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return null;
}

/* --------------------------------------------------------- option matching */

export interface OptionMatch {
  option: FieldOption;
  confidence: number;
  exact: boolean;
}

const YES_RE = /^(?:yes|y|true|1|i am|i do|affirmative)$/i;
const NO_RE = /^(?:no|n|false|0|i am not|i do not|negative)$/i;

/**
 * Finds the option corresponding to a stored value.
 *
 * Deliberately conservative: it will return nothing rather than pick a loosely
 * similar option, because selecting the wrong option on an application is worse
 * than leaving it blank for the user to handle.
 */
export function matchOption(value: string, options: FieldOption[]): OptionMatch | null {
  const target = value.trim().toLowerCase();
  if (!target) return null;

  const usable = options.filter((option) => option.value !== '' || option.label.trim() !== '');

  // 1. Exact match on label or value.
  for (const option of usable) {
    if (
      option.label.trim().toLowerCase() === target ||
      option.value.trim().toLowerCase() === target
    ) {
      return { option, confidence: 0.95, exact: true };
    }
  }

  // 2. A known alias: "USA" for "United States of America", "B.Tech" for
  //    "Bachelor of Technology", "Sep" for "September". Only if unique.
  const aliased = usable.filter(
    (option) => sameByAlias(option.label, target) || sameByAlias(option.value, target),
  );
  if (aliased.length === 1) {
    return { option: aliased[0]!, confidence: 0.9, exact: true };
  }

  // 3. Yes/No equivalence, which is how most compliance questions are shaped.
  if (YES_RE.test(target) || NO_RE.test(target)) {
    const wantYes = YES_RE.test(target);
    for (const option of usable) {
      const label = option.label.trim().toLowerCase();
      if ((wantYes && YES_RE.test(label)) || (!wantYes && NO_RE.test(label))) {
        return { option, confidence: 0.92, exact: true };
      }
    }
  }

  // 4. One option contains the value as a whole phrase ("India" in
  //    "India (IN)"), or the value contains the option.
  const contained = usable.filter((option) => containsWords(option.label, target));
  // Ambiguous containment is not a match: "Bachelor" matching both
  // "Bachelor of Arts" and "Bachelor of Science" must not silently pick one.
  if (contained.length === 1) {
    return { option: contained[0]!, confidence: 0.72, exact: false };
  }

  return null;
}

/* ------------------------------------------------------------------ helpers */

function fromTracked(tracked: {
  value: string;
  provenance: { confidence: number; source: string };
}): ResolvedValue {
  if (!tracked.value.trim()) return none('not stored in your profile');
  return {
    value: tracked.value,
    // A value the user typed is certain; a parsed one carries its parse score.
    confidence:
      tracked.provenance.source === 'user' ? 1 : Math.max(0.6, tracked.provenance.confidence),
    note: tracked.provenance.source === 'user' ? 'you entered this' : 'read from your resume',
    needsConsent: false,
  };
}

function fromEntry<T extends { provenance: { confidence: number; source: string } }>(
  value: string | undefined,
  entry: T | undefined,
  note: string,
): ResolvedValue {
  if (!value?.trim() || !entry) return none('not stored in your profile');
  return {
    value,
    confidence: entry.provenance.source === 'user' ? 1 : Math.max(0.6, entry.provenance.confidence),
    note: `from ${note}`,
    needsConsent: false,
  };
}

function fromPreference(value: string, note: string): ResolvedValue {
  if (!value.trim()) return none('not set in your preferences');
  return { value, confidence: 1, note: `from ${note}`, needsConsent: false };
}

/** Sensitive free text: present only if the user typed it. */
function sensitiveText(value: string, note: string): ResolvedValue {
  if (!value.trim()) return { ...none('you have not answered this'), needsConsent: true };
  return { value, confidence: 1, note: `from ${note}`, needsConsent: false };
}

/**
 * Demographic answers need two things: the master switch on, and an actual
 * answer. Either missing means the question is left for the user.
 */
function demographic(profile: Profile, value: string, note: string): ResolvedValue {
  if (!profile.sensitive.demographics.shareDemographics) {
    return {
      ...none('demographic answers are switched off in your preferences'),
      needsConsent: true,
    };
  }
  if (!value.trim()) return { ...none('you have not answered this'), needsConsent: true };
  return { value, confidence: 1, note: `from ${note}`, needsConsent: false };
}

/** `unset` is never silently converted into "No". */
function fromTriState(state: TriState, note: string): ResolvedValue {
  if (state === 'unset') return { ...none('you have not answered this'), needsConsent: true };
  return {
    value: state === 'yes' ? 'Yes' : 'No',
    confidence: 1,
    note: `from ${note}`,
    needsConsent: false,
  };
}

/**
 * Education entries in the order a form expects them: most recent first, which
 * is how resumes are written and how "Education #1" is nearly always read.
 */
function educationAt(profile: Profile, index: number) {
  return profile.education[index];
}

/**
 * Experience entries, current role first. The parser already sorts this way;
 * re-applying it here means a hand-edited profile behaves the same.
 */
function experienceAt(profile: Profile, index: number) {
  const ordered = [...profile.experience].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return 0;
  });
  return ordered[index];
}

function groupIsExhausted(field: CanonicalField, profile: Profile, index: number): boolean {
  if (field.startsWith('education.')) return index >= profile.education.length;
  if (field.startsWith('experience.')) return index >= profile.experience.length;
  return false;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Total months across all roles, with overlapping roles (two concurrent
 * internships) merged so no month is counted twice.
 */
function totalMonthsOfExperience(profile: Profile): number {
  const intervals: [number, number][] = [];
  for (const entry of profile.experience) {
    const start = parseYearMonth(entry.startDate);
    if (!start) continue;
    const end = entry.current ? new Date() : parseYearMonth(entry.endDate);
    if (!end) continue;
    const from = start.getFullYear() * 12 + start.getMonth();
    const to = end.getFullYear() * 12 + end.getMonth();
    if (to > from) intervals.push([from, to]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let current: [number, number] | null = null;
  for (const [from, to] of intervals) {
    if (current && from <= current[1]) {
      current[1] = Math.max(current[1], to);
    } else {
      if (current) months += current[1] - current[0];
      current = [from, to];
    }
  }
  if (current) months += current[1] - current[0];
  return months;
}

function parseYearMonth(value: string): Date | null {
  const match = value.match(/^(\d{4})(?:-(\d{1,2}))?$/);
  if (!match) return null;
  return new Date(Number(match[1]), match[2] ? Number(match[2]) - 1 : 0, 1);
}

/** Converts a stored "YYYY" / "YYYY-MM" into what a date input requires. */
export function formatForDateInput(value: string, kind: 'date' | 'month'): string {
  const match = value.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!match) return '';
  const [, year, month, day] = match;
  if (kind === 'month') {
    // A year alone cannot become a month without inventing one.
    return month ? `${year}-${month.padStart(2, '0')}` : '';
  }
  return month && day ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : '';
}

export { isSensitiveField };
