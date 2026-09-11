/**
 * Fillwright profile schema.
 *
 * Everything the extension knows about the user lives in this shape. It is
 * stored only in IndexedDB on this device and is never transmitted.
 *
 * Two cross-cutting ideas:
 *  - `Provenance` records WHERE a value came from and HOW sure we are. The UI
 *    surfaces this so the user can audit anything the parser inferred.
 *  - "Sensitive" answers (demographics, work authorization, salary, ...) live in
 *    a separate branch that the resume parser is structurally forbidden to write
 *    to. They only ever come from explicit user input.
 */

export type FieldSource = 'resume' | 'user' | 'inferred' | 'default';

/** 0..1. Below AUTOFILL_CONFIDENCE_THRESHOLD we suggest rather than fill. */
export type Confidence = number;

export interface Provenance {
  source: FieldSource;
  confidence: Confidence;
  /** ISO-8601. When this value was last written. */
  updatedAt: string;
  /** Optional human-readable note, e.g. "matched 'B.Tech' in education block". */
  note?: string;
}

/** A single value plus its audit trail. */
export interface TrackedValue<T = string> {
  value: T;
  provenance: Provenance;
}

export interface PersonalInfo {
  firstName: TrackedValue;
  middleName: TrackedValue;
  lastName: TrackedValue;
  fullName: TrackedValue;
  preferredName: TrackedValue;
  pronouns: TrackedValue;
  email: TrackedValue;
  alternateEmail: TrackedValue;
  phone: TrackedValue;
  phoneCountryCode: TrackedValue;
  dateOfBirth: TrackedValue;
}

export interface AddressInfo {
  line1: TrackedValue;
  line2: TrackedValue;
  city: TrackedValue;
  state: TrackedValue;
  postalCode: TrackedValue;
  country: TrackedValue;
  /** Free-form "City, State, Country" as it appears on the resume. */
  formatted: TrackedValue;
}

export interface Links {
  linkedin: TrackedValue;
  github: TrackedValue;
  portfolio: TrackedValue;
  website: TrackedValue;
  twitter: TrackedValue;
  stackoverflow: TrackedValue;
  other: TrackedValue<string[]>;
}

export interface EducationEntry {
  id: string;
  institution: string;
  degree: string;
  major: string;
  minor: string;
  location: string;
  startDate: string;
  endDate: string;
  /** Expected or actual graduation date, ISO-ish ("2026-05" or "2026"). */
  graduationDate: string;
  gpa: string;
  gpaScale: string;
  honors: string;
  coursework: string[];
  current: boolean;
  provenance: Provenance;
}

export interface ExperienceEntry {
  id: string;
  company: string;
  title: string;
  employmentType: 'full-time' | 'part-time' | 'internship' | 'contract' | 'freelance' | 'other' | '';
  location: string;
  locationType: 'onsite' | 'remote' | 'hybrid' | '';
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  highlights: string[];
  technologies: string[];
  provenance: Provenance;
}

export interface ProjectEntry {
  id: string;
  name: string;
  role: string;
  description: string;
  highlights: string[];
  technologies: string[];
  url: string;
  repositoryUrl: string;
  startDate: string;
  endDate: string;
  provenance: Provenance;
}

export interface SkillEntry {
  id: string;
  name: string;
  category: string;
  /** Only ever set by the user — never guessed from a resume. */
  proficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert' | '';
  yearsOfExperience: string;
  provenance: Provenance;
}

export interface CertificationEntry {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  credentialId: string;
  credentialUrl: string;
  provenance: Provenance;
}

export interface AchievementEntry {
  id: string;
  title: string;
  description: string;
  date: string;
  issuer: string;
  provenance: Provenance;
}

export interface LanguageEntry {
  id: string;
  name: string;
  proficiency: 'basic' | 'conversational' | 'professional' | 'fluent' | 'native' | '';
  provenance: Provenance;
}

export interface PublicationEntry {
  id: string;
  title: string;
  venue: string;
  date: string;
  url: string;
  provenance: Provenance;
}

/**
 * Ternary answer. `unset` is meaningfully different from `no`: it means the user
 * has not told us, and Fillwright must not answer the question.
 */
export type TriState = 'yes' | 'no' | 'unset';

/**
 * High-risk answers. The resume parser MUST NOT populate any field here.
 * See `assertNoSensitiveInference` in src/security/sensitive.ts.
 */
export interface SensitiveAnswers {
  workAuthorization: {
    /** Keyed by country code, e.g. "US", "IN", "GB". */
    authorizedIn: Record<string, TriState>;
    requiresSponsorship: Record<string, TriState>;
    visaStatus: string;
    workPermitNotes: string;
  };
  demographics: {
    gender: string;
    raceEthnicity: string;
    disabilityStatus: string;
    veteranStatus: string;
    /** Master switch. When false, demographic questions are never answered. */
    shareDemographics: boolean;
  };
  background: {
    criminalHistory: TriState;
    securityClearance: string;
    drugTestConsent: TriState;
    backgroundCheckConsent: TriState;
  };
  compensation: {
    currentSalary: string;
    expectedSalary: string;
    salaryCurrency: string;
    /** Answer salary questions at all? Off by default. */
    shareCompensation: boolean;
  };
  relocation: {
    willingToRelocate: TriState;
    preferredLocations: string[];
    willingToTravel: TriState;
    travelPercentage: string;
  };
  /** ISO-8601 of the last time the user reviewed this whole branch. */
  lastReviewedAt: string;
}

export interface JobPreferences {
  desiredTitles: string[];
  desiredIndustries: string[];
  employmentTypes: string[];
  earliestStartDate: string;
  noticePeriod: string;
  workModePreference: 'onsite' | 'remote' | 'hybrid' | 'no-preference' | '';
  referredBy: string;
  howDidYouHear: string;
  /** Reusable answers to recurring essay questions, keyed by a slug. */
  savedAnswers: SavedAnswer[];
}

export interface SavedAnswer {
  id: string;
  /** e.g. "why-this-company" */
  key: string;
  label: string;
  text: string;
  updatedAt: string;
}

/** Anything the user wants available that the schema does not model. */
export interface CustomField {
  id: string;
  key: string;
  label: string;
  value: string;
  provenance: Provenance;
}

export interface ResumeAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  importedAt: string;
  /** Raw bytes, kept so the user can re-attach the file to applications. */
  data: ArrayBuffer;
  /** Extracted plain text, kept for re-parsing without the original file. */
  text: string;
}

export interface Profile {
  id: string;
  /** User-facing label, e.g. "Software Engineering" or "Cybersecurity". */
  name: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;

  personal: PersonalInfo;
  address: AddressInfo;
  links: Links;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: SkillEntry[];
  certifications: CertificationEntry[];
  achievements: AchievementEntry[];
  languages: LanguageEntry[];
  publications: PublicationEntry[];
  summary: TrackedValue;

  preferences: JobPreferences;
  sensitive: SensitiveAnswers;
  custom: CustomField[];

  /** Resume files attached to this profile (id references stored blobs). */
  resumeIds: string[];
}

export const PROFILE_SCHEMA_VERSION = 1;
