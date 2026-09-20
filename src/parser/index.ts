import { parseContact, type ParsedContact } from './contact';
import { parseEducation, type ParsedEducation } from './education';
import { parseExperience, type ParsedExperience } from './experience';
import { parseProjects, type ParsedProject } from './projects';
import {
  parseAchievements,
  parseCertifications,
  parseLanguages,
  parseSkills,
  parseSummary,
  type ParsedAchievement,
  type ParsedCertification,
  type ParsedLanguage,
  type ParsedSkill,
} from './skills';
import { splitSections, type ResumeSection } from './sections';
import { compare } from './dates';

export * from './extract';
export { splitSections } from './sections';
export type { ResumeSection, SectionKind } from './sections';

export interface ParsedResume {
  sections: ResumeSection[];
  contact: ParsedContact;
  summary: { text: string; confidence: number };
  education: ParsedEducation[];
  experience: ParsedExperience[];
  projects: ParsedProject[];
  skills: ParsedSkill[];
  certifications: ParsedCertification[];
  achievements: ParsedAchievement[];
  languages: ParsedLanguage[];
  /** Things the user should know went wrong or were skipped. */
  warnings: string[];
  /** Rough signal for the UI: how much structure we actually recognised. */
  coverage: number;
}

/**
 * Turns resume text into structured data.
 *
 * Runs entirely locally and synchronously. Two rules hold throughout:
 *
 *  1. Nothing is invented. Every value traces to text that was actually
 *     present, and unknown fields stay empty rather than being guessed at.
 *  2. Nothing sensitive is inferred. Gender, ethnicity, disability, veteran
 *     status, citizenship, work authorisation and salary are never derived
 *     from a resume — not from names, not from schools, not from locations.
 *     See src/security/sensitive.ts, which enforces this on the merge path.
 */
export interface ParseOptions {
  /** Links the file carried outside its text (see ExtractedText.links). */
  links?: readonly string[];
}

export function parseResume(rawText: string, options: ParseOptions = {}): ParsedResume {
  const text = normalizeDocument(rawText);
  const sections = splitSections(text);
  const warnings: string[] = [];

  const contact = parseContact(sections, text, options.links ?? []);
  const education = parseEducation(sections).sort((a, b) =>
    compare(b.endDate || b.graduationDate, a.endDate || a.graduationDate),
  );
  const experience = parseExperience(sections).sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return compare(b.startDate, a.startDate);
  });

  const parsed: ParsedResume = {
    sections,
    contact,
    summary: parseSummary(sections),
    education,
    experience,
    projects: parseProjects(sections),
    skills: parseSkills(sections),
    certifications: parseCertifications(sections),
    achievements: parseAchievements(sections),
    languages: parseLanguages(sections),
    warnings,
    coverage: 0,
  };

  if (!contact.email.value) {
    warnings.push('No email address was found. Add one in your profile so forms can be filled.');
  }
  if (!contact.phone.value) {
    warnings.push('No phone number was found.');
  }
  if (!contact.firstName.value) {
    warnings.push('Your name could not be identified with confidence — please check it.');
  }
  if (education.length === 0 && sections.some((section) => section.kind === 'education')) {
    warnings.push('An education section was found but no entries could be read from it.');
  }
  if (sections.every((section) => section.kind === 'header')) {
    warnings.push(
      'No standard section headings were found, so only contact details could be read. ' +
        'You can still fill in the rest of your profile by hand.',
    );
  }

  parsed.coverage = computeCoverage(parsed);
  return parsed;
}

/** How much of the expected structure was actually recognised, 0..1. */
function computeCoverage(parsed: ParsedResume): number {
  const signals = [
    parsed.contact.fullName.value !== '',
    parsed.contact.email.value !== '',
    parsed.contact.phone.value !== '',
    parsed.education.length > 0,
    parsed.experience.length > 0 || parsed.projects.length > 0,
    parsed.skills.length > 0,
  ];
  return signals.filter(Boolean).length / signals.length;
}

// Word processors emit these; built from char codes so the source stays ASCII.
const UNICODE_HYPHENS = new RegExp(`[${String.fromCharCode(0x2010, 0x2011)}]`, 'g');
const SOFT_HYPHEN = new RegExp(String.fromCharCode(0xad), 'g');
const UNICODE_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2007, 0x202f)}]`, 'g');

/**
 * Repairs the text layer before any heuristic runs.
 *
 * PDF extraction in particular produces hyphenated line breaks, stray soft
 * hyphens and non-breaking spaces; leaving them in makes every downstream
 * regex less reliable for no benefit.
 */
export function normalizeDocument(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // Unicode dashes and quotes that resumes pick up from word processors.
      .replace(UNICODE_HYPHENS, '-')
      .replace(SOFT_HYPHEN, '')
      .replace(UNICODE_SPACES, ' ')
      // "Comp-\nuter Science" — a word split across a line break.
      .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
