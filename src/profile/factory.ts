import {
  PROFILE_SCHEMA_VERSION,
  type Confidence,
  type FieldSource,
  type Profile,
  type Provenance,
  type TrackedValue,
} from '@/types/profile';

export function now(): string {
  return new Date().toISOString();
}

/** Crypto-quality ids; `Math.random` is not used anywhere in this codebase. */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
}

export function provenance(
  source: FieldSource = 'default',
  confidence: Confidence = 0,
  note?: string,
): Provenance {
  return note ? { source, confidence, updatedAt: now(), note } : { source, confidence, updatedAt: now() };
}

/** Build a TrackedValue. Defaults to an empty, zero-confidence placeholder. */
export function tv<T = string>(
  value: T,
  source: FieldSource = 'default',
  confidence: Confidence = 0,
  note?: string,
): TrackedValue<T> {
  return { value, provenance: provenance(source, confidence, note) };
}

const emptyText = () => tv('');

export function createEmptyProfile(name = 'My Profile'): Profile {
  return {
    id: newId('prof'),
    name,
    createdAt: now(),
    updatedAt: now(),
    schemaVersion: PROFILE_SCHEMA_VERSION,

    personal: {
      firstName: emptyText(),
      middleName: emptyText(),
      lastName: emptyText(),
      fullName: emptyText(),
      preferredName: emptyText(),
      pronouns: emptyText(),
      email: emptyText(),
      alternateEmail: emptyText(),
      phone: emptyText(),
      phoneCountryCode: emptyText(),
      dateOfBirth: emptyText(),
    },
    address: {
      line1: emptyText(),
      line2: emptyText(),
      city: emptyText(),
      state: emptyText(),
      postalCode: emptyText(),
      country: emptyText(),
      formatted: emptyText(),
    },
    links: {
      linkedin: emptyText(),
      github: emptyText(),
      portfolio: emptyText(),
      website: emptyText(),
      twitter: emptyText(),
      stackoverflow: emptyText(),
      other: tv<string[]>([]),
    },
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
    languages: [],
    publications: [],
    summary: emptyText(),

    preferences: {
      desiredTitles: [],
      desiredIndustries: [],
      employmentTypes: [],
      earliestStartDate: '',
      noticePeriod: '',
      workModePreference: '',
      referredBy: '',
      howDidYouHear: '',
      savedAnswers: [],
    },

    sensitive: {
      workAuthorization: {
        authorizedIn: {},
        requiresSponsorship: {},
        visaStatus: '',
        workPermitNotes: '',
      },
      demographics: {
        gender: '',
        raceEthnicity: '',
        disabilityStatus: '',
        veteranStatus: '',
        shareDemographics: false,
      },
      background: {
        criminalHistory: 'unset',
        securityClearance: '',
        drugTestConsent: 'unset',
        backgroundCheckConsent: 'unset',
      },
      compensation: {
        currentSalary: '',
        expectedSalary: '',
        salaryCurrency: '',
        shareCompensation: false,
      },
      relocation: {
        willingToRelocate: 'unset',
        preferredLocations: [],
        willingToTravel: 'unset',
        travelPercentage: '',
      },
      lastReviewedAt: '',
    },

    custom: [],
    resumeIds: [],
  };
}
