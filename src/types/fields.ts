/**
 * The canonical vocabulary that both the field detector and the profile
 * resolver speak. Website labels are normalized INTO these ids; profile values
 * are resolved OUT of them. Neither side knows about the other.
 */
export type CanonicalField =
  // identity
  | 'personal.firstName'
  | 'personal.middleName'
  | 'personal.lastName'
  | 'personal.fullName'
  | 'personal.preferredName'
  | 'personal.pronouns'
  | 'personal.email'
  | 'personal.phone'
  /** Dialling code alone, e.g. "+91" — only derived from a stored "+CC …" phone. */
  | 'personal.phoneCountryCode'
  /** The phone number without its dialling code. */
  | 'personal.phoneNational'
  | 'personal.dateOfBirth'
  // address
  | 'address.line1'
  | 'address.line2'
  | 'address.city'
  | 'address.state'
  | 'address.postalCode'
  | 'address.country'
  | 'address.formatted'
  // links
  | 'links.linkedin'
  | 'links.github'
  | 'links.portfolio'
  | 'links.website'
  | 'links.twitter'
  | 'links.stackoverflow'
  // education
  | 'education.institution'
  | 'education.degree'
  | 'education.major'
  | 'education.minor'
  | 'education.gpa'
  | 'education.startDate'
  | 'education.endDate'
  | 'education.graduationDate'
  | 'education.startMonth'
  | 'education.startYear'
  | 'education.endMonth'
  | 'education.endYear'
  | 'education.location'
  // experience
  | 'experience.company'
  | 'experience.title'
  | 'experience.startDate'
  | 'experience.endDate'
  | 'experience.startMonth'
  | 'experience.startYear'
  | 'experience.endMonth'
  | 'experience.endYear'
  /** "I currently work here". */
  | 'experience.current'
  | 'experience.location'
  | 'experience.description'
  | 'experience.yearsOfExperience'
  // documents & free text
  | 'documents.resume'
  | 'documents.coverLetter'
  | 'profile.summary'
  | 'profile.skills'
  // preferences
  | 'preferences.desiredSalary'
  | 'sensitive.currentSalary'
  | 'preferences.startDate'
  | 'preferences.noticePeriod'
  | 'preferences.workMode'
  | 'preferences.referredBy'
  | 'preferences.howDidYouHear'
  // high-risk — never inferred from a resume
  | 'sensitive.workAuthorization'
  | 'sensitive.requiresSponsorship'
  | 'sensitive.visaStatus'
  | 'sensitive.gender'
  | 'sensitive.raceEthnicity'
  | 'sensitive.disabilityStatus'
  | 'sensitive.veteranStatus'
  | 'sensitive.criminalHistory'
  | 'sensitive.securityClearance'
  | 'sensitive.willingToRelocate'
  | 'sensitive.willingToTravel'
  | 'sensitive.drugTestConsent'
  | 'sensitive.backgroundCheckConsent'
  // catch-alls
  | 'custom'
  | 'unknown';

/** Control kinds we know how to read and write. */
export type ControlKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'month'
  | 'textarea'
  | 'select'
  | 'radio-group'
  | 'checkbox'
  | 'checkbox-group'
  | 'file'
  | 'contenteditable'
  | 'combobox'
  | 'unsupported';

export interface FieldOption {
  /** The value the form expects. */
  value: string;
  /** The text the user sees. */
  label: string;
  /** For radio/checkbox groups: the element backing this option. */
  elementId?: string;
}

/**
 * Every signal we harvested for one control. Deliberately plain data so the
 * classifier is a pure function and can be unit-tested without a DOM.
 */
export interface FieldSignals {
  labelText: string;
  ariaLabel: string;
  ariaDescription: string;
  placeholder: string;
  name: string;
  id: string;
  autocomplete: string;
  inputType: string;
  title: string;
  /** Heading of the nearest fieldset/section. */
  sectionHeading: string;
  /** Visible text immediately preceding the control. */
  precedingText: string;
  /** Option labels for selects / radio groups. */
  optionLabels: string[];
  required: boolean;
  maxLength: number | null;
  /**
   * BCP 47 language of the control, from the nearest `lang` attribute
   * ("de-DE"). Chooses which locale vocabulary packs apply. Empty or absent
   * when the page declares none.
   */
  lang?: string;
}

export interface DetectedField {
  /** Stable within one scan; used to address the element across messages. */
  id: string;
  kind: ControlKind;
  signals: FieldSignals;
  options: FieldOption[];
  /** Current value in the page, used for the no-overwrite rule. */
  currentValue: string;
  hasExistingValue: boolean;
  visible: boolean;
  /**
   * Why a field was judged not visible ("transparent", "off-screen", …).
   * Stays in the page: a hidden field is never sent to the worker.
   */
  hiddenReason?: string | null;
  disabled: boolean;
  readOnly: boolean;
  /** Index in document order — used to order the review list. */
  order: number;
  /** CSS-ish path, for the "remember this mapping" feature. */
  selectorHint: string;
  /**
   * Shape of the nearest repeating ancestor, used to detect repeated blocks
   * ("Education #1", "Education #2"). Null when nothing above this control
   * looks like a repeated container.
   */
  groupSignature: string | null;
  /** Position among identically-shaped siblings, zero-based. */
  groupOrdinal: number | null;
}

export type MappingStatus =
  /** Confident and safe to fill. */
  | 'ready'
  /** Matched, but confidence is below the threshold — user must confirm. */
  | 'review'
  /** High-risk question; only the user can answer it. */
  | 'needs-consent'
  /** We know what it is but the profile has no value. */
  | 'missing-value'
  /** Field already contains data and overwrite is off. */
  | 'skipped-existing'
  /** No confident classification. */
  | 'unmapped'
  /** Open-ended question requiring a written answer. */
  | 'manual-required';

export interface FieldMapping {
  fieldId: string;
  canonical: CanonicalField;
  confidence: number;
  status: MappingStatus;
  /** The value we would write. Empty when status is not fillable. */
  proposedValue: string;
  /** For selects/radios: which option we would choose. */
  proposedOptionValue?: string;
  /** Short, user-facing explanation, e.g. "label 'College' → education.institution". */
  rationale: string;
  /** True when this mapping came from a user-saved rule for this site. */
  fromSavedRule: boolean;
  /** The id of that saved rule, so a fill can count its use. */
  savedMappingId?: string;
  /** True when the user chose this mapping, saved or for this form only. */
  corrected?: boolean;
  /**
   * Which repeated block this field belongs to, and therefore which profile
   * entry it draws from. 0 for non-repeating fields.
   */
  entryIndex: number;
}

export interface ScanResult {
  url: string;
  /** Origin + path only — query strings are stripped before this leaves the tab. */
  pageKey: string;
  adapterId: string | null;
  scannedAt: string;
  fields: DetectedField[];
  mappings: FieldMapping[];
}

/** What the preview shows before anything is written. */
export interface FillPlan {
  scanId: string;
  entries: FillPlanEntry[];
  readyCount: number;
  reviewCount: number;
  skippedCount: number;
  /**
   * How many repeated education/experience blocks the form appears to have.
   * Compared against the profile so the user can be told when a form has room
   * for fewer entries than they have.
   */
  blocks: { education: number; experience: number };
  /** Entries the profile holds, for the same comparison. */
  available: { education: number; experience: number };
}

export interface FillPlanEntry {
  fieldId: string;
  label: string;
  canonical: CanonicalField;
  currentValue: string;
  newValue: string;
  status: MappingStatus;
  confidence: number;
  rationale: string;
  /** User toggled this entry on/off in the review UI. */
  selected: boolean;
  /**
   * Stable identity for this field on this site, so a correction the user makes
   * can be remembered and reapplied on the next visit.
   */
  fingerprint: string;
  /** True when this mapping came from a correction the user already taught. */
  remembered: boolean;
  /** The saved rule behind a remembered entry. An id, never a value. */
  savedMappingId?: string;
  /** True when the user picked this mapping, saved or not. */
  corrected?: boolean;
  /** The form marks this field as required. */
  required?: boolean;
}

export interface FillOutcome {
  fieldId: string;
  ok: boolean;
  /** Value present before we wrote, so the user can undo. */
  previousValue: string;
  error?: string;
}

/** A user-taught mapping, scoped to one site. */
export interface SavedMapping {
  id: string;
  /** Origin, e.g. "https://jobs.example.com". */
  origin: string;
  /** Normalized signal fingerprint the rule matches on. */
  fingerprint: string;
  /** Human-readable label captured when the rule was created. */
  label: string;
  canonical: CanonicalField;
  /** For a `custom` mapping, which custom key to use. */
  customKey?: string;
  createdAt: string;
  useCount: number;
  /** A paused rule is kept but not applied. */
  disabled?: boolean;
}
