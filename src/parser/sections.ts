import { isAllCaps, looksLikeHeading, normalizeWhitespace } from './patterns';

export type SectionKind =
  | 'header'
  | 'summary'
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'certifications'
  | 'achievements'
  | 'languages'
  | 'publications'
  | 'volunteer'
  | 'interests'
  | 'references'
  | 'other';

export interface ResumeSection {
  kind: SectionKind;
  /** The heading exactly as written, or '' for the implicit header block. */
  heading: string;
  lines: string[];
  /** Index of the heading line in the original document. */
  startLine: number;
}

/**
 * Heading vocabulary, checked in order. Multi-word and more specific phrases
 * come first so "Work Experience" is not claimed by a looser "Work" rule.
 */
const HEADINGS: Array<{ re: RegExp; kind: SectionKind }> = [
  {
    re: /^(?:technical\s+)?skills?(?:\s*(?:&|and)\s*(?:tools|technologies|abilities|competenc\w+))?$/i,
    kind: 'skills',
  },
  { re: /^(?:core\s+)?competenc\w+$/i, kind: 'skills' },
  {
    re: /^(?:technologies|tech\s+stack|tools(?:\s*&\s*technologies)?|areas?\s+of\s+expertise)$/i,
    kind: 'skills',
  },

  { re: /^(?:work|professional|employment|industry|relevant)\s+experience$/i, kind: 'experience' },
  { re: /^experiences?$/i, kind: 'experience' },
  { re: /^(?:employment|work)\s+history$/i, kind: 'experience' },
  { re: /^internships?(?:\s+(?:&|and)\s+\w+)?$/i, kind: 'experience' },
  { re: /^(?:professional\s+)?background$/i, kind: 'experience' },

  { re: /^education(?:al)?(?:\s+(?:background|qualifications?|details?))?$/i, kind: 'education' },
  { re: /^academic(?:s|\s+(?:background|qualifications?|history|record))?$/i, kind: 'education' },
  { re: /^qualifications?$/i, kind: 'education' },

  {
    re: /^(?:personal\s+|academic\s+|key\s+|selected\s+|technical\s+)?projects?$/i,
    kind: 'projects',
  },
  { re: /^portfolio$/i, kind: 'projects' },

  {
    re: /^(?:certifications?|certificates?|licen[cs]es?(?:\s*&\s*certifications?)?|credentials?)$/i,
    kind: 'certifications',
  },
  {
    re: /^(?:courses?|online\s+courses?|(?:relevant\s+)?coursework|training)$/i,
    kind: 'certifications',
  },

  {
    re: /^(?:achievements?|accomplishments?|awards?(?:\s*(?:&|and)\s*(?:honou?rs?|recognitions?))?|honou?rs?(?:\s*(?:&|and)\s*awards?)?|recognitions?)$/i,
    kind: 'achievements',
  },
  {
    re: /^(?:positions?\s+of\s+responsibility|leadership(?:\s+experience)?|extra[\s-]?curricular(?:\s+activities)?|activities)$/i,
    kind: 'achievements',
  },

  { re: /^(?:languages?(?:\s+known)?|language\s+proficiency)$/i, kind: 'languages' },

  {
    re: /^(?:publications?|research(?:\s+(?:papers?|experience|work))?|papers?|patents?)$/i,
    kind: 'publications',
  },

  {
    re: /^(?:volunteer(?:ing|\s+(?:experience|work))?|community(?:\s+(?:service|involvement))?|social\s+work)$/i,
    kind: 'volunteer',
  },

  {
    re: /^(?:interests?|hobbies(?:\s*(?:&|and)\s*interests?)?|personal\s+interests?)$/i,
    kind: 'interests',
  },

  { re: /^references?(?:\s+available.*)?$/i, kind: 'references' },

  {
    re: /^(?:summary|professional\s+summary|career\s+summary|objectives?|career\s+objectives?|profile|about(?:\s+me)?|overview)$/i,
    kind: 'summary',
  },
];

export function classifyHeading(rawLine: string): SectionKind | null {
  const cleaned = normalizeWhitespace(rawLine)
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[:•\-–—_=]+$/, '')
    .trim();
  if (!cleaned) return null;
  for (const { re, kind } of HEADINGS) {
    if (re.test(cleaned)) return kind;
  }
  return null;
}

/**
 * Splits a resume into sections.
 *
 * Everything before the first recognised heading is the `header` block — that is
 * where the name and contact details live on essentially every resume, which is
 * why the contact parser only ever looks there for a name.
 */
export function splitSections(text: string): ResumeSection[] {
  const lines = text.split(/\r?\n/);
  const sections: ResumeSection[] = [];
  let current: ResumeSection = { kind: 'header', heading: '', lines: [], startLine: 0 };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const kind = trimmed && looksLikeHeading(trimmed) ? classifyHeading(trimmed) : null;

    if (kind) {
      if (current.lines.length > 0 || current.kind !== 'header') sections.push(current);
      current = { kind, heading: normalizeWhitespace(trimmed), lines: [], startLine: index };
      return;
    }

    // An unrecognised heading still ends the previous section — but only when
    // it is ALL CAPS. That is the one shape that is unambiguously a heading;
    // anything looser swallows entry titles like "Software Engineer" and drops
    // the entry beneath them.
    if (trimmed && isAllCaps(trimmed) && looksLikeHeading(trimmed) && current.kind !== 'header') {
      sections.push(current);
      current = {
        kind: 'other',
        heading: normalizeWhitespace(trimmed),
        lines: [],
        startLine: index,
      };
      return;
    }

    if (trimmed) current.lines.push(line);
  });

  if (current.lines.length > 0 || current.kind !== 'header') sections.push(current);
  return sections;
}

export function sectionsOfKind(sections: ResumeSection[], kind: SectionKind): ResumeSection[] {
  return sections.filter((section) => section.kind === kind);
}

export function linesOfKind(sections: ResumeSection[], kind: SectionKind): string[] {
  return sectionsOfKind(sections, kind).flatMap((section) => section.lines);
}
