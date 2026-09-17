import { newId, provenance, now } from './factory';
import type {
  AchievementEntry,
  CertificationEntry,
  CustomField,
  EducationEntry,
  ExperienceEntry,
  LanguageEntry,
  ProjectEntry,
  PublicationEntry,
  SavedAnswer,
  SkillEntry,
} from '@/types/profile';

/** Blank list entries, created by the editor and used to repair imported data. */

const userProv = () => provenance('user', 1, 'entered by you');

export function emptyEducation(): EducationEntry {
  return {
    id: newId('edu'),
    institution: '',
    degree: '',
    major: '',
    minor: '',
    location: '',
    startDate: '',
    endDate: '',
    graduationDate: '',
    gpa: '',
    gpaScale: '',
    honors: '',
    coursework: [],
    current: false,
    provenance: userProv(),
  };
}

export function emptyExperience(): ExperienceEntry {
  return {
    id: newId('exp'),
    company: '',
    title: '',
    employmentType: '',
    location: '',
    locationType: '',
    startDate: '',
    endDate: '',
    current: false,
    description: '',
    highlights: [],
    technologies: [],
    provenance: userProv(),
  };
}

export function emptyProject(): ProjectEntry {
  return {
    id: newId('prj'),
    name: '',
    role: '',
    description: '',
    highlights: [],
    technologies: [],
    url: '',
    repositoryUrl: '',
    startDate: '',
    endDate: '',
    provenance: userProv(),
  };
}

export function emptySkill(): SkillEntry {
  return {
    id: newId('skl'),
    name: '',
    category: '',
    proficiency: '',
    yearsOfExperience: '',
    provenance: userProv(),
  };
}

export function emptyCertification(): CertificationEntry {
  return {
    id: newId('cert'),
    name: '',
    issuer: '',
    issueDate: '',
    expiryDate: '',
    credentialId: '',
    credentialUrl: '',
    provenance: userProv(),
  };
}

export function emptyAchievement(): AchievementEntry {
  return {
    id: newId('ach'),
    title: '',
    description: '',
    date: '',
    issuer: '',
    provenance: userProv(),
  };
}

export function emptyLanguage(): LanguageEntry {
  return { id: newId('lang'), name: '', proficiency: '', provenance: userProv() };
}

export function emptyPublication(): PublicationEntry {
  return { id: newId('pub'), title: '', venue: '', date: '', url: '', provenance: userProv() };
}

export function emptySavedAnswer(): SavedAnswer {
  return { id: newId('ans'), key: '', label: '', text: '', updatedAt: now() };
}

export function emptyCustomField(): CustomField {
  return { id: newId('cf'), key: '', label: '', value: '', provenance: userProv() };
}
