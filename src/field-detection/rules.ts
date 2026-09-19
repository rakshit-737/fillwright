import type { CanonicalField } from '@/types/fields';
import { LOCALE_PACKS, type LocaleCode } from './locales';
import { normalizeLabel } from './normalize';

/**
 * The field vocabulary.
 *
 * Each rule maps website wording onto one canonical profile field. Three kinds
 * of evidence, in descending authority:
 *
 *  - `autocomplete`: the HTML autocomplete token. Standardised and deliberate,
 *    so it is treated as near-proof.
 *  - `exact`: the normalised label matches exactly. Very strong.
 *  - `includes` / `patterns`: the label contains the phrase. Strong, and scored
 *    by how much of the label the phrase accounts for, so "First Name" beats a
 *    stray "name" match inside "Company Name".
 *
 * `not` disqualifies outright. Those entries matter more than they look: they
 * are what stops "Company Name" being read as a person's name, and "Referrer's
 * Email" being read as the candidate's.
 */
export interface FieldRule {
  field: CanonicalField;
  exact?: string[];
  includes?: string[];
  patterns?: RegExp[];
  not?: RegExp[];
  autocomplete?: string[];
  /** Input types that corroborate this field. */
  types?: string[];
  /** Ceiling for this rule, 0..1. Defaults to 0.95. */
  weight?: number;
  /** Set on rules that come from a locale pack (see locales.ts). */
  locale?: LocaleCode;
  /** Locale rule that applies only when the control's language is its pack's. */
  langOnly?: boolean;
}

const ENGLISH_THIRD_PARTY = [
  'referr?er',
  'referee',
  'reference',
  'emergency',
  'contact person',
  'recruiter',
  'manager',
  'supervisor',
  'guardian',
  'parent',
  'spouse',
  'friend',
  'colleague',
  'witness',
  'next of kin',
];

const ENGLISH_COMPANY = [
  'company',
  'employer',
  'organization',
  'organisation',
  'business',
  'firm',
  'agency',
  'school',
  'university',
  'college',
  'institution',
];

/**
 * Safety vocabulary is never gated by language: a German referee field on a
 * page that claims to be English is still someone else's field.
 */
const wordsRe = (words: string[]) => new RegExp(`\\b(?:${words.join('|')})\\b`);

/** Words that mean the field is about somebody other than the candidate, in every supported language. */
export const THIRD_PARTY_RE = wordsRe([
  ...ENGLISH_THIRD_PARTY,
  ...LOCALE_PACKS.flatMap((pack) => pack.thirdParty),
]);

/** Words that mean the field is about a company, not a person, in every supported language. */
const COMPANY_CONTEXT_RE = wordsRe([
  ...ENGLISH_COMPANY,
  ...LOCALE_PACKS.flatMap((pack) => pack.company),
]);

const ENGLISH_RULES: FieldRule[] = [
  /* ------------------------------------------------------------- identity */
  {
    field: 'personal.firstName',
    exact: ['first name', 'legal first name', 'preferred first name', 'fname', 'first'],
    includes: ['first name'],
    autocomplete: ['given-name'],
    not: [COMPANY_CONTEXT_RE, THIRD_PARTY_RE],
  },
  {
    field: 'personal.middleName',
    exact: ['middle name', 'middle initial', 'mname', 'middle'],
    includes: ['middle name', 'middle initial'],
    autocomplete: ['additional-name'],
    not: [THIRD_PARTY_RE],
  },
  {
    field: 'personal.lastName',
    exact: ['last name', 'legal last name', 'lname', 'last'],
    includes: ['last name'],
    autocomplete: ['family-name'],
    not: [COMPANY_CONTEXT_RE, THIRD_PARTY_RE],
  },
  {
    field: 'personal.fullName',
    exact: ['full name', 'legal name', 'full legal name', 'candidate name', 'applicant name'],
    includes: ['full name', 'legal name'],
    autocomplete: ['name'],
    not: [COMPANY_CONTEXT_RE, THIRD_PARTY_RE, /\b(?:user ?name|file|field|domain|display)\b/],
  },
  {
    // A bare "Name" is genuinely ambiguous: the candidate, a referee, a company
    // or a file could all be meant. Deliberately scored below the default
    // autofill threshold so it is always offered for review rather than
    // written automatically.
    field: 'personal.fullName',
    exact: ['name', 'your name'],
    weight: 0.66,
    not: [COMPANY_CONTEXT_RE, THIRD_PARTY_RE, /\b(?:user ?name|file|field|domain|display)\b/],
  },
  {
    field: 'personal.preferredName',
    exact: ['preferred name', 'nickname', 'what should we call you', 'goes by'],
    includes: ['preferred name', 'nickname'],
    not: [/\bfirst name\b/],
  },
  {
    field: 'personal.pronouns',
    exact: ['pronouns', 'preferred pronouns', 'your pronouns'],
    includes: ['pronouns'],
  },
  {
    field: 'personal.email',
    exact: ['email', 'email 1', 'work email', 'personal email', 'contact email', 'your email'],
    includes: ['email'],
    autocomplete: ['email'],
    types: ['email'],
    // "Confirm email" in every supported language: a confirmation box is not
    // where the candidate's address is first asked for.
    not: [
      THIRD_PARTY_RE,
      /\b(?:confirm\w*|verify|re enter|repeat|bestatig\w*|wiederhol\w*|resaisi\w*|repet\w*|repit\w*|bevestig\w*|herhaal\w*|conferma\w*|ripeti\w*)\b/,
    ],
  },
  {
    field: 'personal.phone',
    exact: ['phone', 'mobile', 'contact number', 'primary phone', 'mobile phone', 'phone no'],
    includes: ['phone', 'mobile'],
    autocomplete: ['tel', 'tel-national'],
    types: ['tel'],
    not: [THIRD_PARTY_RE, /\b(?:country code|extension|ext)\b/],
  },
  {
    field: 'personal.dateOfBirth',
    exact: ['birth date', 'birthday'],
    includes: ['birth date', 'date of birth'],
    autocomplete: ['bday'],
  },

  /* -------------------------------------------------------------- address */
  {
    field: 'address.line1',
    exact: [
      'address',
      'street address',
      'address line 1',
      'address 1',
      'street',
      'mailing address',
      'current address',
    ],
    includes: ['address line 1', 'street address'],
    autocomplete: ['street-address', 'address-line1'],
    not: [/\bemail\b/, /\bip\b/, THIRD_PARTY_RE],
  },
  {
    field: 'address.line2',
    exact: ['address line 2', 'address 2', 'apartment suite', 'apt', 'unit', 'suite'],
    includes: ['address line 2'],
    autocomplete: ['address-line2'],
  },
  {
    field: 'address.city',
    // "Location (City)" is common: the parenthetical is the precise intent, so
    // the combined form is listed explicitly rather than left to compete with
    // the broader `address.formatted` rule.
    exact: ['city', 'town', 'city town', 'current city', 'location city', 'city location'],
    includes: ['city'],
    autocomplete: ['address-level2'],
    not: [THIRD_PARTY_RE],
  },
  {
    field: 'address.state',
    exact: ['state', 'region', 'state region', 'state province'],
    includes: ['state'],
    autocomplete: ['address-level1'],
    not: [/\b(?:united states|employment|marital|visa|veteran|disability)\b/],
  },
  {
    field: 'address.postalCode',
    exact: ['postal code'],
    includes: ['postal code'],
    autocomplete: ['postal-code'],
  },
  {
    field: 'address.country',
    exact: ['country', 'country of residence'],
    includes: ['country'],
    autocomplete: ['country', 'country-name'],
    not: [/\b(?:code|citizenship|citizen|authorized|authorization|sponsor)\b/],
  },
  {
    field: 'address.formatted',
    exact: ['location', 'current location', 'where are you based', 'your location'],
    includes: ['current location'],
    weight: 0.82,
    not: [/\b(?:preferred|desired|office|job|work) location\b/],
  },

  /* ---------------------------------------------------------------- links */
  {
    field: 'links.linkedin',
    exact: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin profile url'],
    includes: ['linkedin'],
  },
  {
    field: 'links.github',
    exact: ['github', 'github url', 'github profile', 'git repository'],
    includes: ['github'],
  },
  {
    field: 'links.stackoverflow',
    exact: ['stackoverflow', 'stackoverflow url'],
    includes: ['stackoverflow'],
  },
  {
    field: 'links.twitter',
    exact: ['twitter', 'twitter url', 'twitter handle', 'x url'],
    includes: ['twitter handle'],
  },
  {
    field: 'links.portfolio',
    exact: ['portfolio', 'portfolio url', 'portfolio link', 'portfolio website'],
    includes: ['portfolio'],
  },
  {
    field: 'links.website',
    exact: ['website', 'personal website', 'blog', 'other url', 'other website', 'personal site'],
    includes: ['personal website'],
    patterns: [/\bprofessional (?:website|site|url)\b/],
    // A generic "website" on an application form is at least as likely to mean
    // the portfolio, so this stays below the auto-fill bar deliberately.
    weight: 0.62,
    not: [COMPANY_CONTEXT_RE],
  },

  /* ------------------------------------------------------------ education */
  {
    field: 'education.institution',
    exact: [
      'school',
      'university',
      'college',
      'institution',
      'school name',
      'university college',
      'alma mater',
    ],
    includes: ['university', 'college', 'institution'],
    patterns: [/\bschool\b(?!.*\bhigh\b)/],
    not: [/\b(?:high school diploma|business school essay)\b/],
  },
  {
    field: 'education.degree',
    exact: [
      'degree',
      'degree type',
      'degree earned',
      'qualification',
      'highest degree',
      'education level',
      'level of education',
    ],
    includes: ['degree'],
  },
  {
    field: 'education.major',
    exact: ['major', 'specialization', 'branch', 'stream', 'concentration', 'subject'],
    includes: ['major', 'specialization'],
    not: [/\bminor\b/],
  },
  {
    field: 'education.minor',
    exact: ['minor'],
    includes: ['minor'],
  },
  {
    field: 'education.gpa',
    exact: ['gpa', 'grade', 'percentage', 'marks', 'aggregate', 'gpa out of 4', 'gpa out of 10'],
    includes: ['gpa'],
    not: [/\bscale\b/],
  },
  {
    field: 'education.graduationDate',
    exact: [
      'graduation date',
      'expected graduation date',
      'graduation',
      'completion date',
      'expected completion',
    ],
    includes: ['graduation date'],
    patterns: [/\bexpected\b.*\b(?:graduation|completion|date|year)\b/],
  },
  {
    field: 'education.startDate',
    exact: ['start date education', 'education start date', 'from year'],
    patterns: [/\b(?:education|school|college|university|degree)\b.*\bstart\b/],
  },
  {
    field: 'education.endDate',
    exact: ['end date education', 'education end date', 'to year'],
    patterns: [/\b(?:education|school|college|university|degree)\b.*\bend\b/],
  },

  /* ----------------------------------------------------------- experience */
  {
    field: 'experience.company',
    exact: [
      'company',
      'employer',
      'current employer',
      'most recent employer',
      'current company',
      'previous employer',
      'former employer',
      'past employer',
      'last employer',
      'previous company',
      'organization',
      'organisation',
    ],
    includes: ['employer', 'company'],
    autocomplete: ['organization'],
    // "Company you're applying to" names the hiring company, not the candidate's
    // employer — writing a past employer there would be plainly wrong.
    not: [
      /\b(?:why|about|describe|size|website|url|address)\b/,
      /\b(?:applying|apply|applied|hiring|interviewing)\b/,
      /\b(?:this|our|target|prospective) (?:company|employer|organi[sz]ation)\b/,
      THIRD_PARTY_RE,
    ],
  },
  {
    field: 'experience.title',
    exact: [
      'title',
      'current title',
      'job title',
      'current job title',
      'position',
      'current position',
      'most recent title',
      'role',
    ],
    includes: ['job title', 'current title'],
    autocomplete: ['organization-title'],
    not: [/\b(?:applying|desired|this|the) (?:role|position|title)\b/, /\bmr\b|\bms\b|\bmrs\b/],
  },
  {
    field: 'experience.yearsOfExperience',
    // "Years of experience with Python" asks about one skill, not a career
    // total; answering it from total experience would overstate it.
    not: [/\b(?:with|using)\b/, /\bexperience (?:in|on|of) (?!total|work|professional|years)\w/],
    exact: [
      'years of experience',
      'total experience',
      'total years of experience',
      'relevant experience',
      'experience in years',
    ],
    includes: ['years of experience'],
    patterns: [/\byears\b.*\bexperience\b/],
  },
  {
    field: 'experience.startDate',
    patterns: [/\b(?:employment|job|role|position|work)\b.*\bstart\b/],
    exact: ['employment start date'],
  },
  {
    field: 'experience.endDate',
    patterns: [/\b(?:employment|job|role|position|work)\b.*\bend\b/],
    exact: ['employment end date'],
  },

  /* ------------------------------------------------------------ documents */
  {
    field: 'documents.resume',
    exact: ['resume', 'upload resume', 'attach resume', 'resume file', 'your resume'],
    includes: ['resume'],
    types: ['file'],
    not: [/\bcover letter\b/],
  },
  {
    field: 'documents.coverLetter',
    exact: ['cover letter', 'upload cover letter', 'letter of interest', 'motivation letter'],
    includes: ['cover letter'],
  },

  /* ------------------------------------------------------------- profile */
  {
    field: 'profile.summary',
    exact: [
      'summary',
      'professional summary',
      'about you',
      'about yourself',
      'bio',
      'profile summary',
      'introduce yourself',
    ],
    includes: ['professional summary'],
    patterns: [/\btell us about yourself\b/],
    weight: 0.78,
  },
  {
    field: 'profile.skills',
    exact: [
      'skills',
      'key skills',
      'technical skills',
      'core skills',
      'relevant skills',
      'skill set',
    ],
    includes: ['skills'],
    not: [/\b(?:rate|level|years|proficiency)\b/],
  },

  /* --------------------------------------------------------- preferences */
  {
    field: 'preferences.startDate',
    exact: [
      'available start date',
      'earliest start date',
      'when can you start',
      'availability date',
      'date available',
      'preferred start date',
    ],
    includes: ['start date'],
    patterns: [/\b(?:available|availability|earliest)\b.*\bstart\b/],
    weight: 0.85,
  },
  {
    field: 'preferences.noticePeriod',
    exact: ['notice period', 'notice period in days'],
    includes: ['notice period'],
  },
  {
    field: 'preferences.workMode',
    exact: [
      'work preference',
      'work mode',
      'remote preference',
      'work arrangement',
      'work location preference',
      'work setting',
      'preferred work setting',
      'work model',
      'workplace type',
      'preferred workplace',
    ],
    includes: ['work arrangement', 'work preference', 'work setting', 'workplace type'],
  },
  {
    field: 'preferences.referredBy',
    exact: ['referred by', 'referral', 'referral name', 'who referred you', 'employee referral'],
    includes: ['referred by', 'referral'],
  },
  {
    field: 'preferences.howDidYouHear',
    exact: [
      'how did you hear about us',
      'how did you hear about this role',
      'source',
      'how did you find us',
      'referral source',
    ],
    includes: ['how did you hear'],
  },

  /* ------------------------------------------------------------ sensitive */
  {
    field: 'sensitive.workAuthorization',
    exact: [
      'work authorization',
      'are you legally authorized to work',
      'work eligibility',
      'right to work',
    ],
    includes: [
      'legally authorized',
      'work authorization',
      'authorized to work',
      'right to work',
      'work permit',
    ],
    patterns: [/\bauthorized\b.*\bwork\b/, /\beligible\b.*\bwork\b/, /\blegally\b.*\bwork\b/],
  },
  {
    field: 'sensitive.requiresSponsorship',
    exact: ['require sponsorship', 'visa sponsorship', 'do you require sponsorship'],
    includes: ['sponsorship'],
    patterns: [/\b(?:require|need|request)\b.*\bsponsor/],
  },
  {
    field: 'sensitive.visaStatus',
    exact: [
      'visa status',
      'immigration status',
      'work permit type',
      'citizenship status',
      'visa type',
    ],
    includes: ['visa status', 'immigration status'],
  },
  {
    field: 'sensitive.gender',
    exact: ['gender', 'sex', 'gender identity', 'what is your gender'],
    includes: ['gender identity'],
    patterns: [/\bgender\b/],
  },
  {
    field: 'sensitive.raceEthnicity',
    exact: ['race', 'ethnicity', 'race ethnicity', 'ethnic background', 'racial identity'],
    includes: ['ethnicity', 'race'],
  },
  {
    field: 'sensitive.disabilityStatus',
    exact: ['disability', 'disability status', 'do you have a disability'],
    includes: ['disability'],
  },
  {
    field: 'sensitive.veteranStatus',
    exact: ['veteran status', 'protected veteran', 'military service', 'veteran'],
    includes: ['veteran'],
  },
  {
    field: 'sensitive.criminalHistory',
    exact: ['criminal history', 'criminal record', 'have you ever been convicted'],
    includes: ['criminal', 'convicted', 'felony'],
  },
  {
    field: 'sensitive.securityClearance',
    exact: ['security clearance', 'clearance level', 'do you hold a security clearance'],
    includes: ['security clearance'],
  },
  {
    field: 'sensitive.willingToRelocate',
    exact: ['relocate', 'are you willing to relocate', 'relocation'],
    includes: ['relocate', 'relocation'],
  },
  {
    field: 'sensitive.willingToTravel',
    exact: ['willing to travel', 'travel requirement', 'able to travel'],
    includes: ['willing to travel'],
    patterns: [/\btravel\b.*\b(?:willing|able|percentage)\b/],
  },
  {
    field: 'sensitive.drugTestConsent',
    exact: ['drug test', 'drug screening', 'consent to drug testing'],
    includes: ['drug test', 'drug screening'],
  },
  {
    field: 'sensitive.backgroundCheckConsent',
    exact: ['background check', 'consent to background check'],
    includes: ['background check'],
  },
  {
    field: 'preferences.desiredSalary',
    exact: [
      'desired salary',
      'expected salary',
      'salary expectation',
      'salary expectations',
      'expected compensation',
      'desired compensation',
      'current salary',
      'current ctc',
      'expected ctc',
    ],
    includes: ['salary', 'compensation', 'ctc'],
  },
];

/**
 * Locale rules, merged under the English rules' negative discipline: each one
 * inherits every `not` (and the input types) of the first English rule for
 * its field, then adds its own. A locale can only add vocabulary; it can never
 * lift a disqualification the English rule imposes.
 */
function localeRules(): FieldRule[] {
  const english = new Map<CanonicalField, FieldRule>();
  for (const rule of ENGLISH_RULES) if (!english.has(rule.field)) english.set(rule.field, rule);

  const phrases = (list?: string[]) =>
    list ? [...new Set(list.map((phrase) => normalizeLabel(phrase)).filter(Boolean))] : undefined;

  return LOCALE_PACKS.flatMap((pack) =>
    pack.rules.map((entry): FieldRule => {
      const base = english.get(entry.field);
      return {
        field: entry.field,
        exact: phrases(entry.exact),
        includes: phrases(entry.includes),
        patterns: entry.patterns,
        not: [...(base?.not ?? []), ...(entry.not ?? [])],
        types: base?.types,
        weight: entry.weight ?? base?.weight,
        locale: pack.code,
        langOnly: entry.langOnly,
      };
    }),
  );
}

export const FIELD_RULES: FieldRule[] = [...ENGLISH_RULES, ...localeRules()];

/**
 * Fields whose vocabulary applies whatever language the page declares. These
 * are the ones where a miss is unsafe (a demographic question read as an
 * ordinary field), not merely unhelpful.
 */
export function isSafetyField(field: CanonicalField): boolean {
  return (
    field.startsWith('sensitive.') ||
    field === 'personal.dateOfBirth' ||
    field === 'preferences.desiredSalary'
  );
}

/**
 * Fields Fillwright must never fill without the user explicitly confirming on
 * this application, even when a saved answer exists.
 */
export const CONSENT_REQUIRED_HINT_RE =
  /\b(?:certify|acknowledge|agree|consent|declare|confirm that|attest|i understand)\b/;
