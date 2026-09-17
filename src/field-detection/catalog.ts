import type { CanonicalField } from '@/types/fields';

/**
 * The field vocabulary, in the user's language.
 *
 * `rules.ts` is how Fillwright reads a website; this is how a person reads
 * Fillwright. It backs the "what is this field?" picker, where someone corrects
 * a mapping the classifier got wrong or could not make at all.
 *
 * Only fields a user could sensibly choose appear here. Internal states like
 * `unknown` are deliberately absent, and the high-risk answers are grouped
 * separately so it is obvious what they are before one is picked.
 */
export interface CatalogEntry {
  field: CanonicalField;
  label: string;
  group: string;
  /** Shown beneath the label when the choice needs a caveat. */
  hint?: string;
}

export const FIELD_CATALOG: CatalogEntry[] = [
  /* ----------------------------------------------------------- about you */
  { field: 'personal.firstName', label: 'First name', group: 'About you' },
  { field: 'personal.middleName', label: 'Middle name', group: 'About you' },
  { field: 'personal.lastName', label: 'Last name', group: 'About you' },
  { field: 'personal.fullName', label: 'Full name', group: 'About you' },
  { field: 'personal.preferredName', label: 'Preferred name', group: 'About you' },
  { field: 'personal.pronouns', label: 'Pronouns', group: 'About you' },
  { field: 'personal.email', label: 'Email', group: 'About you' },
  { field: 'personal.phone', label: 'Phone', group: 'About you' },
  { field: 'personal.dateOfBirth', label: 'Date of birth', group: 'About you' },

  /* ------------------------------------------------------------- address */
  { field: 'address.line1', label: 'Street address', group: 'Address' },
  { field: 'address.line2', label: 'Address line 2', group: 'Address' },
  { field: 'address.city', label: 'City', group: 'Address' },
  { field: 'address.state', label: 'State or region', group: 'Address' },
  { field: 'address.postalCode', label: 'Postal code', group: 'Address' },
  { field: 'address.country', label: 'Country', group: 'Address' },
  { field: 'address.formatted', label: 'Location (one line)', group: 'Address' },

  /* --------------------------------------------------------------- links */
  { field: 'links.linkedin', label: 'LinkedIn', group: 'Links' },
  { field: 'links.github', label: 'GitHub', group: 'Links' },
  { field: 'links.portfolio', label: 'Portfolio', group: 'Links' },
  { field: 'links.website', label: 'Personal website', group: 'Links' },
  { field: 'links.twitter', label: 'Twitter / X', group: 'Links' },
  { field: 'links.stackoverflow', label: 'Stack Overflow', group: 'Links' },

  /* ----------------------------------------------------------- education */
  { field: 'education.institution', label: 'University or college', group: 'Education' },
  { field: 'education.degree', label: 'Degree', group: 'Education' },
  { field: 'education.major', label: 'Major', group: 'Education' },
  { field: 'education.minor', label: 'Minor', group: 'Education' },
  { field: 'education.gpa', label: 'GPA', group: 'Education' },
  { field: 'education.startDate', label: 'Education start date', group: 'Education' },
  { field: 'education.graduationDate', label: 'Graduation date', group: 'Education' },

  /* ---------------------------------------------------------- experience */
  { field: 'experience.company', label: 'Employer', group: 'Experience' },
  { field: 'experience.title', label: 'Job title', group: 'Experience' },
  { field: 'experience.startDate', label: 'Role start date', group: 'Experience' },
  { field: 'experience.endDate', label: 'Role end date', group: 'Experience' },
  { field: 'experience.yearsOfExperience', label: 'Years of experience', group: 'Experience' },
  { field: 'experience.description', label: 'What you did', group: 'Experience' },

  /* ------------------------------------------------------------- profile */
  { field: 'profile.summary', label: 'Professional summary', group: 'Profile' },
  { field: 'profile.skills', label: 'Skills', group: 'Profile' },

  /* --------------------------------------------------------- preferences */
  { field: 'preferences.startDate', label: 'Earliest start date', group: 'Preferences' },
  { field: 'preferences.noticePeriod', label: 'Notice period', group: 'Preferences' },
  { field: 'preferences.workMode', label: 'Work mode preference', group: 'Preferences' },
  { field: 'preferences.referredBy', label: 'Referred by', group: 'Preferences' },
  {
    field: 'preferences.howDidYouHear',
    label: 'How you heard about the role',
    group: 'Preferences',
  },

  /* ----------------------------------------------------------- sensitive */
  {
    field: 'sensitive.workAuthorization',
    label: 'Work authorisation',
    group: 'Only from your saved answers',
    hint: 'Answered per country, and only if you set it in preferences.',
  },
  {
    field: 'sensitive.requiresSponsorship',
    label: 'Visa sponsorship needed',
    group: 'Only from your saved answers',
    hint: 'Answered per country, and only if you set it in preferences.',
  },
  { field: 'sensitive.visaStatus', label: 'Visa status', group: 'Only from your saved answers' },
  {
    field: 'sensitive.willingToRelocate',
    label: 'Willing to relocate',
    group: 'Only from your saved answers',
  },
  {
    field: 'sensitive.willingToTravel',
    label: 'Willing to travel',
    group: 'Only from your saved answers',
  },
  {
    field: 'preferences.desiredSalary',
    label: 'Expected salary',
    group: 'Only from your saved answers',
    hint: 'Left blank unless you switch salary answers on.',
  },
];

const BY_FIELD = new Map(FIELD_CATALOG.map((entry) => [entry.field, entry]));

/** A user-facing name for a canonical field, for labels and explanations. */
export function catalogLabel(field: CanonicalField): string {
  return BY_FIELD.get(field)?.label ?? 'Something else';
}

export function catalogGroups(): string[] {
  return Array.from(new Set(FIELD_CATALOG.map((entry) => entry.group)));
}

/** Fields a user may assign by hand. Demographics are deliberately excluded. */
export function isAssignable(field: CanonicalField): boolean {
  return BY_FIELD.has(field);
}
