import type { CanonicalField } from '@/types/fields';
import { normalizeLabel } from './normalize';
import { collectPageSignals } from '@/content/page-signals';

/**
 * Is this page actually a job application?
 *
 * Trust boundary: pure scoring, run in the worker over signals a content
 * script collected from an untrusted page (validated before use).
 *
 * Asked only when Fillwright was NOT explicitly invoked — in Assist or Smart
 * mode, where it runs on a page by itself and has to decide whether offering
 * help would be useful or merely intrusive. An explicit activation always
 * scans, whatever this says.
 *
 * The answer is a weighted sum over cheap, local signals. No single signal is
 * enough: a newsletter signup has an email field, a checkout has a phone
 * field, a login page has a password. What marks an application is the
 * combination — identity fields AND career fields AND application vocabulary.
 */

export interface ContextInput {
  /** document.title plus the page's h1/h2 headings. */
  headings: string[];
  /** Pathname and hostname only; never the query string. */
  url: string;
  /** What the classifier made of each visible field. */
  fieldKinds: CanonicalField[];
  hasFileInput: boolean;
  /** Password fields are counted, never read. */
  passwordFields: number;
  /** Visible button text, capped. */
  buttonLabels: string[];
}

export interface ContextVerdict {
  score: number;
  level: 'none' | 'possible' | 'likely';
  /** Human-readable reasons, for the "Why am I seeing this?" affordance. */
  reasons: string[];
}

const APPLICATION_WORDS =
  /\b(?:apply|application|applicant|candidate|career|careers|job|jobs|position|opening|vacanc(?:y|ies)|internship|recruit(?:ing|ment)?|hiring|resume|cv)\b/;

const ATS_HOSTS =
  /(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|icims\.com|taleo\.net|workable\.com|jobvite\.com|bamboohr\.com|recruitee\.com|breezy\.hr|jazzhr\.com|teamtailor\.com|personio\.)/;

const URL_WORDS =
  /\/(?:apply|application|careers?|jobs?|positions?|openings?|vacancies|candidate)(?:\/|$|[-_])/;

const APPLY_BUTTON =
  /\b(?:submit application|apply|send application|next step|continue application)\b/;

const CAREER_FIELDS: ReadonlySet<string> = new Set([
  'education.institution',
  'education.degree',
  'education.major',
  'education.graduationDate',
  'experience.company',
  'experience.title',
  'links.linkedin',
  'links.github',
  'links.portfolio',
  'documents.resume',
  'documents.coverLetter',
  'sensitive.workAuthorization',
  'sensitive.requiresSponsorship',
  'preferences.startDate',
  'preferences.desiredSalary',
  'sensitive.currentSalary',
]);

const IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  'personal.firstName',
  'personal.lastName',
  'personal.fullName',
  'personal.email',
  'personal.phone',
]);

export function scoreApplicationContext(input: ContextInput): ContextVerdict {
  const reasons: string[] = [];
  let score = 0;

  const careerCount = input.fieldKinds.filter((kind) => CAREER_FIELDS.has(kind)).length;
  const identityCount = new Set(input.fieldKinds.filter((kind) => IDENTITY_FIELDS.has(kind))).size;

  if (careerCount > 0) {
    score += Math.min(0.45, 0.15 * careerCount);
    reasons.push(
      `${careerCount} career field${careerCount === 1 ? '' : 's'} such as education or employer`,
    );
  }
  if (identityCount >= 2) {
    score += 0.15;
    reasons.push('asks for your name and contact details');
  }
  if (input.hasFileInput) {
    score += 0.1;
    reasons.push('has a file upload');
  }

  const headingText = normalizeLabel(input.headings.join(' '));
  if (APPLICATION_WORDS.test(headingText)) {
    score += 0.2;
    reasons.push('the page title mentions an application or job');
  }

  const url = input.url.toLowerCase();
  if (ATS_HOSTS.test(url)) {
    score += 0.25;
    reasons.push('this is a known applicant-tracking site');
  } else if (URL_WORDS.test(url)) {
    score += 0.1;
    reasons.push('the address looks like a careers page');
  }

  if (input.buttonLabels.some((label) => APPLY_BUTTON.test(label.toLowerCase()))) {
    score += 0.1;
    reasons.push('has an apply or continue button');
  }

  // A login or signup page carries name + email + password and nothing about a
  // career. Without career fields, a password field is strong evidence against.
  if (input.passwordFields > 0 && careerCount === 0) {
    score -= 0.4;
    reasons.push('looks like a sign-in or account page');
  }
  // With no identity and no career fields there is nothing to fill anyway.
  if (careerCount === 0 && identityCount === 0) score = Math.min(score, 0.2);

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  const level = score >= 0.55 ? 'likely' : score >= 0.35 ? 'possible' : 'none';
  return { score, level, reasons };
}

/** Collects the context inputs from a live document. Reads text only. */
export function collectContextInput(doc: Document, fieldKinds: CanonicalField[]): ContextInput {
  let url = '';
  try {
    const parsed = new URL(doc.location?.href ?? '');
    url = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    url = '';
  }
  return { ...collectPageSignals(doc), url, fieldKinds };
}
