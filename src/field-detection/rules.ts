import type { CanonicalField } from '@/types/fields';

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
  /**
   * The rule only applies inside a section whose heading matches. Used for
   * labels that mean nothing on their own — a bare "Start Month" or
   * "Location" is only an entry's field when it sits in that entry's block.
   */
  section?: RegExp;
  /** The rule only applies to these input types. */
  onlyTypes?: string[];
}

/** Words that mean the field is about somebody other than the candidate. */
export const THIRD_PARTY_RE =
  /\b(?:referr?er|referee|reference|emergency|contact person|recruiter|manager|supervisor|guardian|parent|spouse|friend|colleague|witness|next of kin)\b/;

/** Headings of an education block, and of a work-history block. */
const EDUCATION_SECTION_RE =
  /\b(?:education|academic|school|university|college|degree|qualifications?)\b/i;
const EXPERIENCE_SECTION_RE =
  /\b(?:experience|employment|work history|job history|career history|positions? held)\b/i;

/** A month or year part, which the whole-date rules must leave alone. */
const DATE_PART_RE = /\b(?:month|year|mm|yyyy|yy)\b/;

const START_MONTH = {
  exact: ['start month', 'from month', 'month started', 'start date month', 'from date month'],
  patterns: [/\b(?:start|started|from|begin|began)\b.*\bmonth\b/],
  not: [/\b(?:end|to|until|finish|finished|year)\b/],
};
const START_YEAR = {
  exact: ['start year', 'from year', 'year started', 'start date year', 'from date year'],
  patterns: [/\b(?:start|started|from|begin|began)\b.*\byear\b/],
  not: [/\b(?:end|to|until|finish|finished|month|years)\b/],
};
const END_MONTH = {
  exact: ['end month', 'to month', 'month ended', 'end date month', 'to date month'],
  patterns: [/\b(?:end|ended|to|until|finish|finished)\b.*\bmonth\b/],
  not: [/\b(?:start|from|begin|year)\b/],
};
const END_YEAR = {
  exact: ['end year', 'to year', 'year ended', 'end date year', 'to date year'],
  patterns: [/\b(?:end|ended|to|until|finish|finished)\b.*\byear\b/],
  not: [/\b(?:start|from|begin|month|years)\b/],
};

/** Words that mean the field is about a company, not a person. */
const COMPANY_CONTEXT_RE =
  /\b(?:company|employer|organization|organisation|business|firm|agency|school|university|college|institution)\b/;

/** Words that mark a pay question as about the pay the candidate has now. */
const CURRENT_PAY_RE = /\b(?:current|present|last drawn|existing|currently)\b/;

/** Words that mark a pay question as about the pay the candidate wants. */
const EXPECTED_PAY_RE = /\b(?:expected|expecting|expectations?|desired|hike|increment)\b/;

export const FIELD_RULES: FieldRule[] = [
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
    not: [THIRD_PARTY_RE, /\b(?:confirm|verify|re enter|repeat)\b/],
  },
  {
    field: 'personal.phone',
    exact: ['phone', 'mobile', 'contact number', 'primary phone', 'mobile phone', 'phone no'],
    includes: ['phone', 'mobile'],
    autocomplete: ['tel'],
    types: ['tel'],
    not: [THIRD_PARTY_RE, /\b(?:country code|phone code|dial code|calling code|extension|ext)\b/],
  },
  {
    field: 'personal.phoneCountryCode',
    exact: [
      'country code',
      'phone country code',
      'country phone code',
      'country calling code',
      'calling code',
      'dial code',
      'dialing code',
      'dialling code',
      'isd code',
      'phone code',
      'phone prefix',
    ],
    includes: [
      'country code',
      'phone code',
      'calling code',
      'dial code',
      'dialing code',
      'isd code',
    ],
    autocomplete: ['tel-country-code'],
    not: [THIRD_PARTY_RE, /\b(?:postal|zip|iso)\b/],
  },
  {
    field: 'personal.phoneNational',
    exact: ['national number', 'local number', 'phone without country code'],
    includes: ['without country code', 'excluding country code'],
    autocomplete: ['tel-national', 'tel-local'],
    types: ['tel'],
    not: [THIRD_PARTY_RE],
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
    patterns: [/\bexpected\b.*\b(?:graduation|completion|date)\b/],
    not: [DATE_PART_RE],
  },
  {
    field: 'education.startDate',
    exact: ['start date education', 'education start date'],
    patterns: [/\b(?:education|school|college|university|degree)\b.*\bstart\b/],
    not: [DATE_PART_RE],
  },
  {
    field: 'education.endDate',
    exact: ['end date education', 'education end date'],
    patterns: [/\b(?:education|school|college|university|degree)\b.*\bend\b/],
    not: [DATE_PART_RE],
  },
  // Month and year asked separately. The bare labels only count inside an
  // education block; the explicit ones count anywhere.
  { field: 'education.startMonth', ...START_MONTH, section: EDUCATION_SECTION_RE },
  { field: 'education.startYear', ...START_YEAR, section: EDUCATION_SECTION_RE },
  { field: 'education.endMonth', ...END_MONTH, section: EDUCATION_SECTION_RE },
  { field: 'education.endYear', ...END_YEAR, section: EDUCATION_SECTION_RE },
  {
    field: 'education.startMonth',
    patterns: [
      /\b(?:education|school|college|university|degree|course)\b.*\bstart\w*\b.*\bmonth\b/,
    ],
    not: [/\byear\b/],
  },
  {
    field: 'education.startYear',
    exact: ['year of admission', 'admission year', 'year of joining', 'first year attended'],
    patterns: [/\b(?:education|school|college|university|degree|course)\b.*\bstart\w*\b.*\byear\b/],
    not: [/\bmonth\b/],
  },
  {
    field: 'education.endMonth',
    exact: ['graduation month', 'month of graduation', 'expected graduation month'],
    patterns: [/\b(?:education|school|college|university|degree|course)\b.*\bend\w*\b.*\bmonth\b/],
    not: [/\byear\b/],
  },
  {
    field: 'education.endYear',
    exact: [
      'graduation year',
      'year of graduation',
      'expected graduation year',
      'passing year',
      'year of passing',
      'passout year',
      'pass out year',
      'last year attended',
    ],
    includes: ['graduation year', 'year of graduation', 'year of passing'],
    patterns: [/\b(?:education|school|college|university|degree|course)\b.*\bend\w*\b.*\byear\b/],
    not: [/\bmonth\b/],
  },
  {
    field: 'education.location',
    exact: ['location', 'school location', 'university location', 'college location'],
    weight: 0.9,
    section: EDUCATION_SECTION_RE,
  },
  {
    field: 'education.location',
    exact: ['school location', 'university location', 'college location', 'institution location'],
    weight: 0.9,
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
    not: [DATE_PART_RE],
  },
  {
    field: 'experience.endDate',
    patterns: [/\b(?:employment|job|role|position|work)\b.*\bend\b/],
    exact: ['employment end date'],
    not: [DATE_PART_RE],
  },
  { field: 'experience.startMonth', ...START_MONTH, section: EXPERIENCE_SECTION_RE },
  { field: 'experience.startYear', ...START_YEAR, section: EXPERIENCE_SECTION_RE },
  { field: 'experience.endMonth', ...END_MONTH, section: EXPERIENCE_SECTION_RE },
  { field: 'experience.endYear', ...END_YEAR, section: EXPERIENCE_SECTION_RE },
  {
    field: 'experience.startMonth',
    patterns: [/\b(?:employment|job|role|position|work)\b.*\bstart\w*\b.*\bmonth\b/],
    not: [/\byear\b/],
  },
  {
    field: 'experience.startYear',
    patterns: [/\b(?:employment|job|role|position|work)\b.*\bstart\w*\b.*\byear\b/],
    not: [/\bmonth\b/, /\byears\b/],
  },
  {
    field: 'experience.endMonth',
    patterns: [/\b(?:employment|job|role|position|work)\b.*\bend\w*\b.*\bmonth\b/],
    not: [/\byear\b/],
  },
  {
    field: 'experience.endYear',
    patterns: [/\b(?:employment|job|role|position|work)\b.*\bend\w*\b.*\byear\b/],
    not: [/\bmonth\b/, /\byears\b/],
  },
  {
    // "I currently work here" ticks a box; a text field labelled "Current
    // role" is a job title, so only checkboxes qualify.
    field: 'experience.current',
    exact: [
      'i currently work here',
      'currently work here',
      'i am currently working here',
      'current job',
      'current role',
      'current employer',
      'present',
      'currently employed here',
      'i currently work in this role',
    ],
    includes: ['currently work here', 'currently working here', 'still work here'],
    onlyTypes: ['checkbox'],
  },
  {
    field: 'experience.location',
    exact: ['location', 'company location', 'employer location', 'work location'],
    weight: 0.9,
    section: EXPERIENCE_SECTION_RE,
  },
  {
    field: 'experience.location',
    exact: ['company location', 'employer location'],
    weight: 0.9,
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
      'expected ctc',
    ],
    includes: ['salary', 'compensation', 'ctc'],
    // Current pay is a different number. A label that asks about it — alone or
    // alongside the expected figure — must never receive the expected one.
    not: [CURRENT_PAY_RE],
  },
  {
    field: 'sensitive.currentSalary',
    exact: [
      'current salary',
      'current ctc',
      'current compensation',
      'present salary',
      'present ctc',
      'last drawn salary',
      'last drawn ctc',
      'existing salary',
      'existing ctc',
    ],
    patterns: [
      /\b(?:current|present|last drawn|existing)\b.*\b(?:salary|compensation|ctc|pay|package)\b/,
    ],
    not: [EXPECTED_PAY_RE, COMPANY_CONTEXT_RE],
  },
];

/**
 * Fields Fillwright must never fill without the user explicitly confirming on
 * this application, even when a saved answer exists.
 */
export const CONSENT_REQUIRED_HINT_RE =
  /\b(?:certify|acknowledge|agree|consent|declare|confirm that|attest|i understand)\b/;
