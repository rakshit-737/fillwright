import type { Profile } from '@/types/profile';

export interface CompletenessSection {
  key: string;
  label: string;
  /** 0..1 */
  score: number;
  weight: number;
  /** Human-readable gaps, e.g. "Phone number". */
  missing: string[];
}

export interface Completeness {
  /** 0..100, rounded. */
  percent: number;
  sections: CompletenessSection[];
  /** Flattened, highest-impact gaps first. */
  topGaps: string[];
}

const filled = (value: string | undefined): boolean => Boolean(value && value.trim());

/**
 * Scores how ready a profile is to fill a typical application.
 *
 * Weights reflect how often a field is actually asked for, not how much data it
 * holds: an email address matters far more than a publications list.
 */
export function computeCompleteness(profile: Profile): Completeness {
  const sections: CompletenessSection[] = [];

  const required: Array<[string, string]> = [
    ['First name', profile.personal.firstName.value],
    ['Last name', profile.personal.lastName.value],
    ['Email', profile.personal.email.value],
    ['Phone', profile.personal.phone.value],
  ];
  sections.push(scoreList('identity', 'Identity', 3, required));

  sections.push(
    scoreList('location', 'Location', 1.5, [
      ['City', profile.address.city.value],
      ['State / region', profile.address.state.value],
      ['Country', profile.address.country.value],
      ['Postal code', profile.address.postalCode.value],
    ]),
  );

  sections.push(
    scoreList('links', 'Links', 1.5, [
      ['LinkedIn', profile.links.linkedin.value],
      ['GitHub', profile.links.github.value],
      ['Portfolio or website', profile.links.portfolio.value || profile.links.website.value],
    ]),
  );

  const education = profile.education[0];
  sections.push(
    scoreList('education', 'Education', 2.5, [
      ['University or college', education?.institution ?? ''],
      ['Degree', education?.degree ?? ''],
      ['Major', education?.major ?? ''],
      ['Graduation date', education?.graduationDate ?? education?.endDate ?? ''],
    ]),
  );

  sections.push({
    key: 'experience',
    label: 'Experience',
    weight: 2,
    score: profile.experience.length > 0 ? 1 : 0,
    missing: profile.experience.length > 0 ? [] : ['At least one role or internship'],
  });

  sections.push({
    key: 'skills',
    label: 'Skills',
    weight: 1,
    score: Math.min(1, profile.skills.length / 5),
    missing: profile.skills.length >= 5 ? [] : ['At least five skills'],
  });

  sections.push({
    key: 'projects',
    label: 'Projects',
    weight: 0.75,
    score: profile.projects.length > 0 ? 1 : 0,
    missing: profile.projects.length > 0 ? [] : ['At least one project'],
  });

  // Work authorization is scored but never guessed — it counts only when the
  // user has explicitly answered for at least one country.
  const authCount = Object.keys(profile.sensitive.workAuthorization.authorizedIn).length;
  sections.push({
    key: 'authorization',
    label: 'Work authorization',
    weight: 2,
    score: authCount > 0 ? 1 : 0,
    missing: authCount > 0 ? [] : ['Work authorization answers'],
  });

  const totalWeight = sections.reduce((sum, s) => sum + s.weight, 0);
  const weighted = sections.reduce((sum, s) => sum + s.score * s.weight, 0);
  const percent = totalWeight === 0 ? 0 : Math.round((weighted / totalWeight) * 100);

  // Rank individual gaps rather than whole sections. Sorting by section
  // shortfall would let one entirely empty low-priority section (education,
  // say) fill the whole list and bury a missing email address.
  const topGaps = sections
    .flatMap((section) => section.missing.map((text) => ({ text, weight: section.weight })))
    .sort((a, b) => b.weight - a.weight)
    .map((gap) => gap.text)
    .slice(0, 6);

  return { percent, sections, topGaps };
}

function scoreList(
  key: string,
  label: string,
  weight: number,
  entries: Array<[string, string]>,
): CompletenessSection {
  const missing = entries.filter(([, value]) => !filled(value)).map(([name]) => name);
  const score = entries.length === 0 ? 1 : (entries.length - missing.length) / entries.length;
  return { key, label, weight, score, missing };
}
