import { isBullet, normalizeWhitespace, stripBullet } from './patterns';
import { dedupe, splitList } from './experience';
import type { ResumeSection } from './sections';

export interface ParsedSkill {
  name: string;
  category: string;
  confidence: number;
}

export interface ParsedCertification {
  name: string;
  issuer: string;
  issueDate: string;
  credentialUrl: string;
  confidence: number;
}

export interface ParsedAchievement {
  title: string;
  description: string;
  date: string;
  confidence: number;
}

export interface ParsedLanguage {
  name: string;
  /** Only set when the resume states it explicitly; never guessed. */
  proficiency: 'basic' | 'conversational' | 'professional' | 'fluent' | 'native' | '';
  confidence: number;
}

/**
 * Skills sections are usually either "Category: a, b, c" lines or a flat list.
 * Both shapes are handled; the category is kept when one is given because
 * application forms increasingly ask for skills grouped by kind.
 */
export function parseSkills(sections: ResumeSection[]): ParsedSkill[] {
  const lines = sections
    .filter((section) => section.kind === 'skills')
    .flatMap((section) => section.lines);

  const skills: ParsedSkill[] = [];

  for (const raw of lines) {
    const line = normalizeWhitespace(stripBullet(raw));
    if (!line) continue;

    const labelled = line.match(/^([A-Za-z][A-Za-z /&+#.-]{1,40})\s*[:–-]\s*(.+)$/);
    if (labelled?.[1] && labelled[2]) {
      const category = normalizeWhitespace(labelled[1]);
      for (const name of splitList(labelled[2])) {
        skills.push({ name, category, confidence: 0.9 });
      }
      continue;
    }

    for (const name of splitList(line)) {
      // A long fragment in a skills section is prose, not a skill.
      if (name.split(/\s+/).length > 5) continue;
      skills.push({ name, category: '', confidence: 0.82 });
    }
  }

  const seen = new Set<string>();
  return skills
    .filter((skill) => {
      const key = skill.name.toLowerCase();
      if (!key || key.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 120);
}

export function parseCertifications(sections: ResumeSection[]): ParsedCertification[] {
  const lines = sections
    .filter((section) => section.kind === 'certifications')
    .flatMap((section) => section.lines);

  const certifications: ParsedCertification[] = [];

  for (const raw of lines) {
    const line = normalizeWhitespace(stripBullet(raw));
    if (!line || line.length < 3) continue;

    const year = line.match(/\b((?:19|20)\d{2})\b/);
    const url = line.match(/\bhttps?:\/\/\S+/i);

    // "AWS Solutions Architect – Amazon Web Services, 2024"
    const parts = line
      .replace(/\bhttps?:\/\/\S+/gi, '')
      .split(/\s*[–—|]\s*|\s+[-]\s+|,\s+(?=[A-Z])/)
      .map(normalizeWhitespace)
      .filter(Boolean);

    const name = parts[0]?.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/[,\s]+$/, '') ?? '';
    if (!name) continue;

    const issuer = (parts[1] ?? '').replace(/\b(?:19|20)\d{2}\b/g, '').replace(/[,\s]+$/, '');

    certifications.push({
      name,
      issuer,
      issueDate: year?.[1] ?? '',
      credentialUrl: url?.[0]?.replace(/[),.;:'"\]]+$/, '') ?? '',
      confidence: issuer ? 0.82 : 0.7,
    });
  }

  return certifications.slice(0, 40);
}

export function parseAchievements(sections: ResumeSection[]): ParsedAchievement[] {
  const lines = sections
    .filter((section) => section.kind === 'achievements')
    .flatMap((section) => section.lines);

  const achievements: ParsedAchievement[] = [];
  let pending: ParsedAchievement | null = null;

  for (const raw of lines) {
    const text = normalizeWhitespace(stripBullet(raw));
    if (!text) continue;
    const year = text.match(/\b((?:19|20)\d{2})\b/);

    // Continuation lines (non-bullet, lowercase start) extend the entry above.
    if (pending && !isBullet(raw) && /^[a-z]/.test(text)) {
      pending.description = normalizeWhitespace(`${pending.description} ${text}`);
      continue;
    }

    pending = {
      title: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      description: text.length > 120 ? text : '',
      date: year?.[1] ?? '',
      confidence: 0.78,
    };
    achievements.push(pending);
  }

  return achievements.slice(0, 40);
}

const PROFICIENCY_RE: Array<[RegExp, ParsedLanguage['proficiency']]> = [
  [/\bnative\b|\bmother\s+tongue\b/i, 'native'],
  [/\bfluent\b/i, 'fluent'],
  [/\bprofessional(?:\s+working)?\b|\bbusiness\b/i, 'professional'],
  [/\bconversational\b|\bintermediate\b/i, 'conversational'],
  [/\bbasic\b|\bbeginner\b|\belementary\b/i, 'basic'],
];

export function parseLanguages(sections: ResumeSection[]): ParsedLanguage[] {
  const lines = sections
    .filter((section) => section.kind === 'languages')
    .flatMap((section) => section.lines);

  const languages: ParsedLanguage[] = [];

  for (const raw of lines) {
    const line = normalizeWhitespace(stripBullet(raw));
    if (!line) continue;

    for (const chunk of line.split(/[,;•·|]/)) {
      const piece = normalizeWhitespace(chunk);
      if (!piece) continue;

      // "Hindi (Native)" / "Hindi – Native" / "Hindi"
      const match = piece.match(/^([A-Za-z][A-Za-z -]{1,30}?)\s*(?:[([\-–:]\s*([^)\]]+)[)\]]?)?$/);
      const name = normalizeWhitespace(match?.[1] ?? piece);
      if (!name || name.length < 2 || /\d/.test(name)) continue;

      let proficiency: ParsedLanguage['proficiency'] = '';
      for (const [re, level] of PROFICIENCY_RE) {
        if (re.test(piece)) {
          proficiency = level;
          break;
        }
      }

      languages.push({ name, proficiency, confidence: proficiency ? 0.88 : 0.75 });
    }
  }

  const names = dedupe(languages.map((language) => language.name));
  return names
    .map((name) => languages.find((language) => language.name === name)!)
    .slice(0, 20);
}

export function parseSummary(sections: ResumeSection[]): { text: string; confidence: number } {
  const lines = sections
    .filter((section) => section.kind === 'summary')
    .flatMap((section) => section.lines)
    .map((line) => normalizeWhitespace(stripBullet(line)))
    .filter(Boolean);

  if (lines.length === 0) return { text: '', confidence: 0 };
  const text = lines.join(' ').slice(0, 2000);
  return { text, confidence: 0.85 };
}
