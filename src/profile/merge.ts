import { newId, now, provenance, tv } from './factory';
import { preserveSensitive } from '@/security/sensitive';
import type { Candidate } from '@/parser/contact';
import type { ParsedResume } from '@/parser';
import type {
  AchievementEntry,
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
  LanguageEntry,
  Profile,
  ProjectEntry,
  SkillEntry,
  TrackedValue,
} from '@/types/profile';

export interface MergeOptions {
  /**
   * 'fill-gaps' (default) keeps everything already in the profile and only
   * writes empty fields. 'replace' rebuilds the resume-derived sections but
   * still never touches values the user edited by hand.
   */
  strategy?: 'fill-gaps' | 'replace';
}

export interface MergeReport {
  profile: Profile;
  /** Human-readable list of what changed, shown on the review screen. */
  changes: MergeChange[];
  /** Fields the parser found but did not write because the user owns them. */
  preserved: string[];
}

export interface MergeChange {
  path: string;
  label: string;
  previous: string;
  next: string;
  confidence: number;
  note: string;
}

/**
 * Applies parsed resume data to a profile.
 *
 * Three invariants, in priority order:
 *
 *  1. Anything the user typed wins. A value whose provenance says `user` is
 *     never overwritten by resume data, in either strategy.
 *  2. `profile.sensitive` is carried over wholesale and never written to.
 *  3. Every written value records where it came from and how confident the
 *     parser was, so the profile editor can show its own reasoning.
 */
export function mergeResumeIntoProfile(
  existing: Profile,
  parsed: ParsedResume,
  options: MergeOptions = {},
): MergeReport {
  const strategy = options.strategy ?? 'fill-gaps';
  const changes: MergeChange[] = [];
  const preserved: string[] = [];

  const profile: Profile = structuredClone(existing);
  // Invariant 2: taken from the stored profile, so no parser output can reach it.
  profile.sensitive = preserveSensitive(existing);

  const apply = (
    path: string,
    label: string,
    current: TrackedValue,
    candidate: Candidate,
  ): TrackedValue => {
    if (!candidate.value) return current;

    if (current.provenance.source === 'user' && current.value) {
      preserved.push(label);
      return current;
    }
    if (strategy === 'fill-gaps' && current.value) {
      if (current.value !== candidate.value) preserved.push(label);
      return current;
    }
    if (current.value === candidate.value) return current;

    changes.push({
      path,
      label,
      previous: current.value,
      next: candidate.value,
      confidence: candidate.confidence,
      note: candidate.note,
    });
    return tv(candidate.value, 'resume', candidate.confidence, candidate.note);
  };

  /* --- personal --------------------------------------------------------- */
  const { contact } = parsed;
  profile.personal.firstName = apply('personal.firstName', 'First name', profile.personal.firstName, contact.firstName);
  profile.personal.middleName = apply('personal.middleName', 'Middle name', profile.personal.middleName, contact.middleName);
  profile.personal.lastName = apply('personal.lastName', 'Last name', profile.personal.lastName, contact.lastName);
  profile.personal.fullName = apply('personal.fullName', 'Full name', profile.personal.fullName, contact.fullName);
  profile.personal.email = apply('personal.email', 'Email', profile.personal.email, contact.email);
  profile.personal.phone = apply('personal.phone', 'Phone', profile.personal.phone, contact.phone);

  /* --- address ---------------------------------------------------------- */
  profile.address.formatted = apply('address.formatted', 'Location', profile.address.formatted, contact.location);
  profile.address.city = apply('address.city', 'City', profile.address.city, contact.city);
  profile.address.state = apply('address.state', 'State or region', profile.address.state, contact.state);
  profile.address.country = apply('address.country', 'Country', profile.address.country, contact.country);
  profile.address.postalCode = apply('address.postalCode', 'Postal code', profile.address.postalCode, contact.postalCode);

  /* --- links ------------------------------------------------------------ */
  profile.links.linkedin = apply('links.linkedin', 'LinkedIn', profile.links.linkedin, contact.links.linkedin);
  profile.links.github = apply('links.github', 'GitHub', profile.links.github, contact.links.github);
  profile.links.portfolio = apply('links.portfolio', 'Portfolio', profile.links.portfolio, contact.links.portfolio);
  profile.links.website = apply('links.website', 'Website', profile.links.website, contact.links.website);
  profile.links.twitter = apply('links.twitter', 'Twitter / X', profile.links.twitter, contact.links.twitter);
  profile.links.stackoverflow = apply('links.stackoverflow', 'Stack Overflow', profile.links.stackoverflow, contact.links.stackoverflow);

  if (contact.links.other.length > 0 && profile.links.other.value.length === 0) {
    profile.links.other = tv(contact.links.other, 'resume', 0.5, 'other links found in the resume');
  }

  /* --- summary ---------------------------------------------------------- */
  if (parsed.summary.text) {
    profile.summary = apply('summary', 'Summary', profile.summary, {
      value: parsed.summary.text,
      confidence: parsed.summary.confidence,
      note: 'read from the summary section',
    });
  }

  /* --- list sections ---------------------------------------------------- */
  // List sections are replaced as a unit rather than merged item by item:
  // pairing up two versions of "the same" role without stable ids produces
  // duplicates and silent overwrites, both worse than an explicit replace.
  const listChanged = (label: string, before: number, after: number) => {
    if (after === 0) return;
    changes.push({
      path: label.toLowerCase(),
      label,
      previous: before === 0 ? 'none' : `${before} entries`,
      next: `${after} entries`,
      confidence: 0.8,
      note: 'read from the resume',
    });
  };

  const shouldWriteList = (current: unknown[]) => strategy === 'replace' || current.length === 0;

  if (shouldWriteList(profile.education) && parsed.education.length > 0) {
    listChanged('Education', profile.education.length, parsed.education.length);
    profile.education = parsed.education.map(toEducationEntry);
  } else if (parsed.education.length > 0 && profile.education.length > 0) {
    preserved.push('Education');
  }

  if (shouldWriteList(profile.experience) && parsed.experience.length > 0) {
    listChanged('Experience', profile.experience.length, parsed.experience.length);
    profile.experience = parsed.experience.map(toExperienceEntry);
  } else if (parsed.experience.length > 0 && profile.experience.length > 0) {
    preserved.push('Experience');
  }

  if (shouldWriteList(profile.projects) && parsed.projects.length > 0) {
    listChanged('Projects', profile.projects.length, parsed.projects.length);
    profile.projects = parsed.projects.map(toProjectEntry);
  }

  if (shouldWriteList(profile.skills) && parsed.skills.length > 0) {
    listChanged('Skills', profile.skills.length, parsed.skills.length);
    profile.skills = parsed.skills.map(toSkillEntry);
  }

  if (shouldWriteList(profile.certifications) && parsed.certifications.length > 0) {
    listChanged('Certifications', profile.certifications.length, parsed.certifications.length);
    profile.certifications = parsed.certifications.map(toCertificationEntry);
  }

  if (shouldWriteList(profile.achievements) && parsed.achievements.length > 0) {
    listChanged('Achievements', profile.achievements.length, parsed.achievements.length);
    profile.achievements = parsed.achievements.map(toAchievementEntry);
  }

  if (shouldWriteList(profile.languages) && parsed.languages.length > 0) {
    listChanged('Languages', profile.languages.length, parsed.languages.length);
    profile.languages = parsed.languages.map(toLanguageEntry);
  }

  profile.updatedAt = now();

  return { profile, changes, preserved: Array.from(new Set(preserved)) };
}

/* ------------------------------------------------------------- converters */

function toEducationEntry(parsed: ParsedResume['education'][number]): EducationEntry {
  return {
    id: newId('edu'),
    institution: parsed.institution,
    degree: parsed.degree,
    major: parsed.major,
    minor: parsed.minor,
    location: parsed.location,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    graduationDate: parsed.graduationDate,
    gpa: parsed.gpa,
    gpaScale: parsed.gpaScale,
    honors: parsed.honors,
    coursework: parsed.coursework,
    current: parsed.current,
    provenance: provenance('resume', parsed.confidence, parsed.note),
  };
}

function toExperienceEntry(parsed: ParsedResume['experience'][number]): ExperienceEntry {
  return {
    id: newId('exp'),
    company: parsed.company,
    title: parsed.title,
    employmentType: parsed.employmentType,
    location: parsed.location,
    locationType: parsed.locationType,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    current: parsed.current,
    description: parsed.description,
    highlights: parsed.highlights,
    technologies: parsed.technologies,
    provenance: provenance('resume', parsed.confidence, parsed.note),
  };
}

function toProjectEntry(parsed: ParsedResume['projects'][number]): ProjectEntry {
  return {
    id: newId('prj'),
    name: parsed.name,
    role: parsed.role,
    description: parsed.description,
    highlights: parsed.highlights,
    technologies: parsed.technologies,
    url: parsed.url,
    repositoryUrl: parsed.repositoryUrl,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    provenance: provenance('resume', parsed.confidence, parsed.note),
  };
}

function toSkillEntry(parsed: ParsedResume['skills'][number]): SkillEntry {
  return {
    id: newId('skl'),
    name: parsed.name,
    category: parsed.category,
    // Proficiency is never inferred: "listed on a resume" says nothing about level.
    proficiency: '',
    yearsOfExperience: '',
    provenance: provenance('resume', parsed.confidence, 'listed in the skills section'),
  };
}

function toCertificationEntry(parsed: ParsedResume['certifications'][number]): CertificationEntry {
  return {
    id: newId('cert'),
    name: parsed.name,
    issuer: parsed.issuer,
    issueDate: parsed.issueDate,
    expiryDate: '',
    credentialId: '',
    credentialUrl: parsed.credentialUrl,
    provenance: provenance('resume', parsed.confidence, 'listed in the certifications section'),
  };
}

function toAchievementEntry(parsed: ParsedResume['achievements'][number]): AchievementEntry {
  return {
    id: newId('ach'),
    title: parsed.title,
    description: parsed.description,
    date: parsed.date,
    issuer: '',
    provenance: provenance('resume', parsed.confidence, 'listed in the achievements section'),
  };
}

function toLanguageEntry(parsed: ParsedResume['languages'][number]): LanguageEntry {
  return {
    id: newId('lang'),
    name: parsed.name,
    proficiency: parsed.proficiency,
    provenance: provenance(
      'resume',
      parsed.confidence,
      parsed.proficiency ? 'proficiency stated on the resume' : 'listed without a stated level',
    ),
  };
}
