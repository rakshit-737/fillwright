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
   * writes empty fields; new list entries are still added. 'replace' also
   * refreshes values and entries that came from an earlier resume. Neither
   * ever touches a value or list entry the user edited by hand.
   */
  strategy?: 'fill-gaps' | 'replace';
  /**
   * Ids of list-entry changes (EntryChange.id) the user unticked on the review
   * screen. Those entries are left exactly as they are.
   */
  skip?: readonly string[];
}

export type ListSection =
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'certifications'
  | 'achievements'
  | 'languages';

/**
 * What happened to one list entry.
 *  - added:   on the resume, not in the profile: a new entry.
 *  - updated: matched a resume-sourced entry whose fields change.
 *  - kept:    matched an entry the user edited by hand; left untouched.
 *  - missing: a resume-sourced entry this resume no longer lists; kept.
 * Only 'added' and 'updated' are changes the user can untick.
 */
export interface EntryChange {
  /** Stable for the same profile + resume, so it can be passed back in `skip`. */
  id: string;
  section: ListSection;
  kind: 'added' | 'updated' | 'kept' | 'missing';
  label: string;
  /** Field names that change, for 'updated'. */
  fields: string[];
}

export interface MergeReport {
  profile: Profile;
  /** Human-readable list of what changed, shown on the review screen. */
  changes: MergeChange[];
  /** Per-entry outcome for every list section, for the review screen. */
  entries: EntryChange[];
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
 *  1. Anything the user typed wins. A value or list entry whose provenance
 *     says `user` is never overwritten or dropped by resume data, in either
 *     strategy.
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
  const entries: EntryChange[] = [];

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
  profile.personal.firstName = apply(
    'personal.firstName',
    'First name',
    profile.personal.firstName,
    contact.firstName,
  );
  profile.personal.middleName = apply(
    'personal.middleName',
    'Middle name',
    profile.personal.middleName,
    contact.middleName,
  );
  profile.personal.lastName = apply(
    'personal.lastName',
    'Last name',
    profile.personal.lastName,
    contact.lastName,
  );
  profile.personal.fullName = apply(
    'personal.fullName',
    'Full name',
    profile.personal.fullName,
    contact.fullName,
  );
  profile.personal.email = apply('personal.email', 'Email', profile.personal.email, contact.email);
  profile.personal.phone = apply('personal.phone', 'Phone', profile.personal.phone, contact.phone);

  /* --- address ---------------------------------------------------------- */
  profile.address.formatted = apply(
    'address.formatted',
    'Location',
    profile.address.formatted,
    contact.location,
  );
  profile.address.city = apply('address.city', 'City', profile.address.city, contact.city);
  profile.address.state = apply(
    'address.state',
    'State or region',
    profile.address.state,
    contact.state,
  );
  profile.address.country = apply(
    'address.country',
    'Country',
    profile.address.country,
    contact.country,
  );
  profile.address.postalCode = apply(
    'address.postalCode',
    'Postal code',
    profile.address.postalCode,
    contact.postalCode,
  );

  /* --- links ------------------------------------------------------------ */
  profile.links.linkedin = apply(
    'links.linkedin',
    'LinkedIn',
    profile.links.linkedin,
    contact.links.linkedin,
  );
  profile.links.github = apply(
    'links.github',
    'GitHub',
    profile.links.github,
    contact.links.github,
  );
  profile.links.portfolio = apply(
    'links.portfolio',
    'Portfolio',
    profile.links.portfolio,
    contact.links.portfolio,
  );
  profile.links.website = apply(
    'links.website',
    'Website',
    profile.links.website,
    contact.links.website,
  );
  profile.links.twitter = apply(
    'links.twitter',
    'Twitter / X',
    profile.links.twitter,
    contact.links.twitter,
  );
  profile.links.stackoverflow = apply(
    'links.stackoverflow',
    'Stack Overflow',
    profile.links.stackoverflow,
    contact.links.stackoverflow,
  );

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
  // Lists are merged entry by entry. Each parsed entry is paired with at most
  // one existing entry by a normalised key (see ENTRY_KEYS), so a role the user
  // edited by hand is recognised on the next import and left alone.
  const skip = new Set(options.skip ?? []);
  const ctx: ListContext = { strategy, skip, entries, changes, preserved };
  profile.education = mergeList(
    ctx,
    'education',
    profile.education,
    parsed.education.map(toEducationEntry),
  );
  profile.experience = mergeList(
    ctx,
    'experience',
    profile.experience,
    parsed.experience.map(toExperienceEntry),
  );
  profile.projects = mergeList(
    ctx,
    'projects',
    profile.projects,
    parsed.projects.map(toProjectEntry),
  );
  profile.skills = mergeList(ctx, 'skills', profile.skills, parsed.skills.map(toSkillEntry));
  profile.certifications = mergeList(
    ctx,
    'certifications',
    profile.certifications,
    parsed.certifications.map(toCertificationEntry),
  );
  profile.achievements = mergeList(
    ctx,
    'achievements',
    profile.achievements,
    parsed.achievements.map(toAchievementEntry),
  );
  profile.languages = mergeList(
    ctx,
    'languages',
    profile.languages,
    parsed.languages.map(toLanguageEntry),
  );

  profile.updatedAt = now();

  return { profile, changes, entries, preserved: Array.from(new Set(preserved)) };
}

/* ------------------------------------------------------------ list merge */

interface ListContext {
  strategy: 'fill-gaps' | 'replace';
  skip: Set<string>;
  entries: EntryChange[];
  changes: MergeChange[];
  preserved: string[];
}

const SECTION_LABEL: Record<ListSection, string> = {
  education: 'Education',
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  certifications: 'Certifications',
  achievements: 'Achievements',
  languages: 'Languages',
};

/** Normalises a name for matching: case, accents, punctuation, spacing, company suffixes. */
export function normKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\b(the|inc|llc|ltd|limited|pvt|private|corp|corporation|co|gmbh|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Two names match when equal once normalised, equal once spaces are removed
 * ("B.Tech" / "BTech"), or when one contains the other as whole words and the
 * shorter is at least four characters ("IIT Delhi" / "IIT Delhi, India").
 */
export function sameName(a: string, b: string): boolean {
  const x = normKey(a);
  const y = normKey(b);
  if (x === y) return true;
  if (!x || !y) return false;
  if (x.replace(/ /g, '') === y.replace(/ /g, '')) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function datePart(value: string): { year: string; month: number } | null {
  const year = /\b(?:19|20)\d{2}\b/.exec(value)?.[0];
  if (!year) return null;
  let month = 0;
  const isoLike = /\b(?:19|20)\d{2}[-/.](\d{1,2})\b/.exec(value);
  const usLike = /\b(\d{1,2})[-/.](?:19|20)\d{2}\b/.exec(value);
  if (isoLike) month = Number(isoLike[1]);
  else if (usLike) month = Number(usLike[1]);
  else {
    const named = /[a-z]{3}/i.exec(value)?.[0]?.toLowerCase() ?? '';
    month = MONTHS.indexOf(named) + 1;
  }
  return { year, month: month >= 1 && month <= 12 ? month : 0 };
}

/** Start dates match when either is missing, or they give the same year (and month, when both do). */
export function sameStart(a: string, b: string): boolean {
  const pa = datePart(a);
  const pb = datePart(b);
  if (!pa || !pb) return true;
  if (pa.year !== pb.year) return false;
  return !pa.month || !pb.month || pa.month === pb.month;
}

/** Optional parts of a key match when either side leaves them blank. */
const optionalSame = (a: string, b: string) => !a.trim() || !b.trim() || sameName(a, b);

const MATCHERS: { [K in ListSection]: (a: EntryOf<K>, b: EntryOf<K>) => boolean } = {
  education: (a, b) => sameName(a.institution, b.institution) && optionalSame(a.degree, b.degree),
  experience: (a, b) =>
    sameName(a.company, b.company) &&
    sameName(a.title, b.title) &&
    sameStart(a.startDate, b.startDate),
  projects: (a, b) => sameName(a.name, b.name),
  skills: (a, b) => normKey(a.name) === normKey(b.name) && normKey(a.name) !== '',
  certifications: (a, b) => sameName(a.name, b.name) && optionalSame(a.issuer, b.issuer),
  achievements: (a, b) => sameName(a.title, b.title),
  languages: (a, b) => normKey(a.name) === normKey(b.name) && normKey(a.name) !== '',
};

interface EntryMap {
  education: EducationEntry;
  experience: ExperienceEntry;
  projects: ProjectEntry;
  skills: SkillEntry;
  certifications: CertificationEntry;
  achievements: AchievementEntry;
  languages: LanguageEntry;
}
type EntryOf<K extends ListSection> = EntryMap[K];

export function entryLabel<K extends ListSection>(section: K, entry: EntryOf<K>): string {
  const e = entry as unknown as Record<string, string>;
  switch (section) {
    case 'education':
      return [e.degree, e.institution].filter(Boolean).join(', ');
    case 'experience':
      return [e.title, e.company].filter(Boolean).join(' at ');
    case 'achievements':
      return e.title ?? '';
    default:
      return e.name ?? '';
  }
}

function isEmpty(value: unknown): boolean {
  return (
    value === '' ||
    value === false ||
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0)
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges one list section entry by entry.
 *
 *  - An entry the user edited (provenance 'user') is never changed or dropped.
 *  - A parsed entry that matches nothing is added, in either strategy.
 *  - A matched resume-sourced entry keeps its id. 'replace' refreshes it from
 *    the resume (values the resume leaves blank are kept); 'fill-gaps' only
 *    fills its empty fields.
 *  - An existing resume-sourced entry this resume no longer lists is kept and
 *    reported as 'missing'.
 */
function mergeList<K extends ListSection>(
  ctx: ListContext,
  section: K,
  current: EntryOf<K>[],
  parsed: EntryOf<K>[],
): EntryOf<K>[] {
  const match = MATCHERS[section] as (a: EntryOf<K>, b: EntryOf<K>) => boolean;
  const result = current.slice();
  const claimed = new Set<number>();
  const name = SECTION_LABEL[section];

  parsed.forEach((incoming, index) => {
    const at = current.findIndex((existing, i) => !claimed.has(i) && match(existing, incoming));
    const label = entryLabel(section, incoming) || `${name} entry`;

    if (at < 0) {
      const id = `${section}:add:${index}:${normKey(label)}`;
      ctx.entries.push({ id, section, kind: 'added', label, fields: [] });
      if (ctx.skip.has(id)) return;
      result.push(incoming);
      ctx.changes.push({
        path: `${section}.${incoming.id}`,
        label: `${name}: ${label}`,
        previous: 'none',
        next: label,
        confidence: incoming.provenance.confidence,
        note: 'new entry read from the resume',
      });
      return;
    }

    claimed.add(at);
    const existing = current[at] as EntryOf<K>;
    const existingLabel = entryLabel(section, existing) || label;
    if (existing.provenance.source === 'user') {
      ctx.entries.push({
        id: `${section}:keep:${existing.id}`,
        section,
        kind: 'kept',
        label: existingLabel,
        fields: [],
      });
      ctx.preserved.push(`${name}: ${existingLabel}`);
      return;
    }

    const next = { ...existing } as unknown as Record<string, unknown>;
    const fields: string[] = [];
    const fresh = incoming as unknown as Record<string, unknown>;
    // A parsed end date makes `current: false` a real value, not a blank:
    // 'replace' must clear the flag on a role that has since ended.
    const ended = typeof fresh.endDate === 'string' && fresh.endDate.trim() !== '';
    for (const [key, value] of Object.entries(fresh)) {
      if (key === 'id' || key === 'provenance') continue;
      if (isEmpty(value) && !(key === 'current' && value === false && ended)) continue;
      const old = next[key];
      if (sameValue(old, value)) continue;
      if (ctx.strategy === 'fill-gaps' && !isEmpty(old)) continue;
      next[key] = value;
      fields.push(key);
    }
    if (fields.length === 0) return;
    const id = `${section}:update:${existing.id}`;
    ctx.entries.push({ id, section, kind: 'updated', label: existingLabel, fields });
    if (ctx.skip.has(id)) return;
    next.provenance = incoming.provenance;
    const updated = next as unknown as EntryOf<K>;
    result[at] = updated;
    ctx.changes.push({
      path: `${section}.${existing.id}`,
      label: `${name}: ${existingLabel}`,
      previous: existingLabel,
      next: entryLabel(section, updated) || existingLabel,
      confidence: incoming.provenance.confidence,
      note: `updated ${fields.join(', ')} from the resume`,
    });
  });

  if (parsed.length > 0) {
    current.forEach((existing, i) => {
      if (claimed.has(i) || existing.provenance.source === 'user') return;
      ctx.entries.push({
        id: `${section}:missing:${existing.id}`,
        section,
        kind: 'missing',
        label: entryLabel(section, existing) || `${name} entry`,
        fields: [],
      });
    });
  }
  return result;
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
