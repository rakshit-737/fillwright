import type { CanonicalField, FieldSignals } from '@/types/fields';
import { FIELD_RULES, THIRD_PARTY_RE, type FieldRule } from './rules';
import { containsPhrase, looksLikeQuestion, normalizeLabel, wordCount } from './normalize';

export interface Classification {
  field: CanonicalField;
  confidence: number;
  /** Plain-English explanation shown in the review UI. */
  rationale: string;
  /** True when the field wants a written answer rather than a stored value. */
  isOpenQuestion: boolean;
}

/**
 * Relative authority of each signal.
 *
 * `autocomplete` is a deliberate, standardised declaration by the site author,
 * so it outranks everything. A visible `<label>` is next: it is what the user
 * themselves reads. Developer-chosen `name`/`id` attributes are good but often
 * abbreviated or reused, and text merely sitting near the control is the
 * weakest evidence of all.
 */
const SIGNAL_WEIGHTS = {
  autocomplete: 1.0,
  labelText: 0.97,
  ariaLabel: 0.93,
  name: 0.86,
  id: 0.8,
  placeholder: 0.8,
  title: 0.78,
  ariaDescription: 0.7,
  precedingText: 0.62,
  optionLabels: 0.55,
} as const;

type TextSignalKey = Exclude<keyof typeof SIGNAL_WEIGHTS, 'autocomplete'>;

const TEXT_SIGNALS: TextSignalKey[] = [
  'labelText',
  'ariaLabel',
  'name',
  'id',
  'placeholder',
  'title',
  'ariaDescription',
  'precedingText',
  'optionLabels',
];

const SIGNAL_NAMES: Record<keyof typeof SIGNAL_WEIGHTS, string> = {
  autocomplete: 'the autocomplete attribute',
  labelText: 'the field label',
  ariaLabel: 'the accessibility label',
  name: 'the field name',
  id: 'the field id',
  placeholder: 'the placeholder text',
  title: 'the tooltip text',
  ariaDescription: 'the field description',
  precedingText: 'the text next to the field',
  optionLabels: 'the available options',
};

/** Priors from the input type alone, for forms with no usable labels. */
const TYPE_PRIORS: Array<{ type: string; field: CanonicalField; confidence: number }> = [
  { type: 'email', field: 'personal.email', confidence: 0.74 },
  { type: 'tel', field: 'personal.phone', confidence: 0.74 },
  { type: 'url', field: 'links.website', confidence: 0.42 },
];

/** Section headings that make a whole family of fields more likely. */
const SECTION_CONTEXT: Array<{ re: RegExp; prefix: string; boost: number }> = [
  { re: /\b(?:education|academic|school|university|degree)\b/i, prefix: 'education.', boost: 0.06 },
  {
    re: /\b(?:experience|employment|work history|professional)\b/i,
    prefix: 'experience.',
    boost: 0.06,
  },
  { re: /\b(?:contact|personal|about you|your details)\b/i, prefix: 'personal.', boost: 0.04 },
  { re: /\b(?:address|location|where)\b/i, prefix: 'address.', boost: 0.04 },
  {
    re: /\b(?:voluntary|demographic|equal opportunity|eeo|self identification)\b/i,
    prefix: 'sensitive.',
    boost: 0.05,
  },
  { re: /\b(?:links|profiles|social|online presence)\b/i, prefix: 'links.', boost: 0.05 },
];

interface Candidate {
  field: CanonicalField;
  score: number;
  /** Which signals contributed, best first. */
  evidence: Array<{ signal: keyof typeof SIGNAL_WEIGHTS; phrase: string; score: number }>;
}

/**
 * Classifies one control into a canonical profile field.
 *
 * Entirely deterministic and side-effect free: no network, no model, no DOM.
 * The same signals always produce the same answer, which is what makes the
 * confidence number meaningful and the behaviour auditable.
 *
 * Webpage text is DATA here and nowhere else. Labels are matched against a
 * fixed vocabulary; nothing read from the page is interpreted as an
 * instruction, and no rule can be introduced by the page itself.
 */
export function classifyField(signals: FieldSignals): Classification {
  const normalized = normalizeSignals(signals);

  // Question-shaped text is a hint, not a verdict. "Are you legally authorized
  // to work in the United States?" is phrased as a question but is a yes/no
  // compliance field, not an essay — so this is only decided once the rules
  // have had their say, below.
  const promptText = signals.labelText || signals.ariaLabel || signals.precedingText;
  const questionShaped =
    (looksLikeQuestion(promptText) && wordCount(promptText) >= 5) ||
    (signals.inputType === 'textarea' && wordCount(promptText) >= 8);

  const candidates = new Map<CanonicalField, Candidate>();
  // Fields a negative rule has ruled out. Tracked explicitly so that later
  // passes — which do not re-read the rules — cannot resurrect them.
  const disqualified = new Set<CanonicalField>();

  for (const rule of FIELD_RULES) {
    // Gates, not evidence: a rule that does not apply here neither scores nor
    // disqualifies its field.
    if (rule.section && !rule.section.test(signals.sectionHeading)) continue;
    if (rule.onlyTypes && !rule.onlyTypes.includes(signals.inputType)) continue;
    if (isDisqualified(rule, normalized)) {
      disqualified.add(rule.field);
      continue;
    }

    const evidence: Candidate['evidence'] = [];

    if (rule.autocomplete && normalized.autocomplete) {
      for (const token of rule.autocomplete) {
        if (normalized.autocomplete === token || normalized.autocomplete.endsWith(` ${token}`)) {
          evidence.push({
            signal: 'autocomplete',
            phrase: token,
            score: SIGNAL_WEIGHTS.autocomplete,
          });
          break;
        }
      }
    }

    for (const key of TEXT_SIGNALS) {
      const text = normalized[key];
      if (!text) continue;
      const hit = scoreAgainstRule(text, rule);
      if (hit) {
        evidence.push({ signal: key, phrase: hit.phrase, score: hit.score * SIGNAL_WEIGHTS[key] });
      }
    }

    if (evidence.length === 0) continue;

    evidence.sort((a, b) => b.score - a.score);
    const best = evidence[0]!;
    let score = best.score;

    // Independent agreement is meaningful: a label and a name attribute both
    // pointing at the same field is much stronger than either alone.
    if (evidence.length > 1) {
      score = Math.min(
        1,
        score + Math.min(0.08, 0.03 * (evidence.length - 1) + evidence[1]!.score * 0.04),
      );
    }

    // The input type either corroborates the rule or contradicts it.
    if (rule.types?.length) {
      if (rule.types.includes(signals.inputType)) score = Math.min(1, score + 0.05);
      else if (isTypeConflict(rule.types, signals.inputType)) score *= 0.75;
    }

    score = Math.min(score, rule.weight ?? 0.95);
    upsert(candidates, rule.field, score, evidence);
  }

  applySectionContext(candidates, signals.sectionHeading);
  applyTypePriors(candidates, signals, disqualified);

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const winner = ranked[0];

  // A strong match means this is a real field that merely reads as a question.
  // Only an unmatched or weakly-matched prompt is treated as one to write.
  const openQuestion = questionShaped && (!winner || winner.score < 0.75);

  if (!winner || winner.score < 0.35) {
    return {
      field: 'unknown',
      confidence: winner?.score ?? 0,
      rationale: openQuestion
        ? 'This looks like a written question rather than a profile field.'
        : 'Fillwright could not confidently identify this field.',
      isOpenQuestion: openQuestion,
    };
  }

  // A close runner-up means the evidence is genuinely ambiguous. Say so, and
  // drop the confidence so the field is offered for review instead of filled.
  const runnerUp = ranked[1];
  const ambiguous = runnerUp !== undefined && winner.score - runnerUp.score < 0.06;
  const confidence = ambiguous ? Math.min(winner.score, 0.58) : winner.score;

  return {
    field: winner.field,
    confidence,
    rationale: explain(winner, ambiguous ? runnerUp : undefined),
    isOpenQuestion: openQuestion,
  };
}

/* ------------------------------------------------------------------ scoring */

type NormalizedSignals = Record<TextSignalKey, string> & { autocomplete: string; combined: string };

function normalizeSignals(signals: FieldSignals): NormalizedSignals {
  const normalized = {
    labelText: normalizeLabel(signals.labelText),
    ariaLabel: normalizeLabel(signals.ariaLabel),
    name: normalizeLabel(signals.name),
    id: normalizeLabel(signals.id),
    placeholder: normalizeLabel(signals.placeholder),
    title: normalizeLabel(signals.title),
    ariaDescription: normalizeLabel(signals.ariaDescription),
    precedingText: normalizeLabel(signals.precedingText),
    optionLabels: normalizeLabel(signals.optionLabels.slice(0, 12).join(' ')),
    autocomplete: signals.autocomplete.trim().toLowerCase(),
  } as NormalizedSignals;

  // Negative rules are evaluated against the signals that IDENTIFY this control
  // — its label, its accessible name, its attributes. Contextual signals are
  // deliberately excluded: text merely sitting near a field describes the
  // neighbourhood, not the field, and letting it disqualify means one unrelated
  // "University" or "Company" elsewhere on the form can veto a correct match.
  // Context can add evidence; it must never remove it.
  normalized.combined = [
    normalized.labelText,
    normalized.ariaLabel,
    normalized.name,
    normalized.id,
    normalized.placeholder,
    normalized.title,
  ]
    .filter(Boolean)
    .join(' ');

  return normalized;
}

function isDisqualified(rule: FieldRule, normalized: NormalizedSignals): boolean {
  if (!rule.not?.length) return false;
  return rule.not.some((pattern) => pattern.test(normalized.combined));
}

/** Best match of one rule against one piece of text, 0..1, or null. */
function scoreAgainstRule(text: string, rule: FieldRule): { score: number; phrase: string } | null {
  let best: { score: number; phrase: string } | null = null;
  const consider = (score: number, phrase: string) => {
    if (!best || score > best.score) best = { score, phrase };
  };

  for (const phrase of rule.exact ?? []) {
    if (text === phrase) consider(1, phrase);
  }

  for (const phrase of rule.includes ?? []) {
    if (!containsPhrase(text, phrase)) continue;
    // Scale by how much of the label the phrase accounts for. "first name"
    // inside "legal first name" is nearly the whole thing; the same phrase
    // inside a 12-word sentence is much weaker evidence.
    const coverage = phrase.length / Math.max(text.length, phrase.length);
    consider(0.62 + 0.33 * coverage, phrase);
  }

  for (const pattern of rule.patterns ?? []) {
    if (pattern.test(text)) consider(0.86, pattern.source);
  }

  return best;
}

function isTypeConflict(expected: string[], actual: string): boolean {
  // Only the strongly-typed controls contradict; a plain text input is
  // compatible with essentially anything.
  const STRONG = new Set(['email', 'tel', 'file', 'checkbox', 'radio-group', 'select']);
  return STRONG.has(actual) && !expected.includes(actual);
}

function upsert(
  candidates: Map<CanonicalField, Candidate>,
  field: CanonicalField,
  score: number,
  evidence: Candidate['evidence'],
): void {
  const existing = candidates.get(field);
  if (!existing || score > existing.score) {
    candidates.set(field, { field, score, evidence });
  }
}

function applySectionContext(candidates: Map<CanonicalField, Candidate>, heading: string): void {
  if (!heading) return;
  for (const { re, prefix, boost } of SECTION_CONTEXT) {
    if (!re.test(heading)) continue;
    for (const candidate of candidates.values()) {
      if (candidate.field.startsWith(prefix)) {
        candidate.score = Math.min(0.95, candidate.score + boost);
      }
    }
  }
}

function applyTypePriors(
  candidates: Map<CanonicalField, Candidate>,
  signals: FieldSignals,
  disqualified: Set<CanonicalField>,
): void {
  for (const prior of TYPE_PRIORS) {
    if (signals.inputType !== prior.type) continue;
    // A type prior is weaker evidence than a negative rule. `type="email"` on a
    // field labelled "Confirm Email" must not make it the candidate email.
    if (disqualified.has(prior.field)) continue;
    // A prior only helps when nothing else identified the field; it must never
    // override actual evidence.
    const existing = candidates.get(prior.field);
    if (existing) {
      existing.score = Math.min(0.95, Math.max(existing.score, prior.confidence));
      continue;
    }
    const strongest = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
    if (!strongest || strongest.score < prior.confidence) {
      candidates.set(prior.field, {
        field: prior.field,
        score: prior.confidence,
        evidence: [
          { signal: 'labelText', phrase: `type="${prior.type}"`, score: prior.confidence },
        ],
      });
    }
  }

  // A file input inside a form that mentions a resume is almost always the
  // resume upload, which is worth recognising even with no label at all.
  if (
    signals.inputType === 'file' &&
    !candidates.has('documents.resume') &&
    !disqualified.has('documents.resume')
  ) {
    const mentionsResume = /resume|cv|curriculum/i.test(
      `${signals.labelText} ${signals.name} ${signals.sectionHeading} ${signals.precedingText}`,
    );
    if (mentionsResume) {
      candidates.set('documents.resume', {
        field: 'documents.resume',
        score: 0.8,
        evidence: [{ signal: 'labelText', phrase: 'resume upload', score: 0.8 }],
      });
    }
  }
}

function explain(winner: Candidate, runnerUp?: Candidate): string {
  const best = winner.evidence[0];
  if (!best) return 'Matched the field vocabulary.';

  const where = SIGNAL_NAMES[best.signal];
  const base = `Matched "${best.phrase}" in ${where}`;

  if (runnerUp) {
    return `${base}, but this could also be ${describeField(runnerUp.field)} — please check.`;
  }
  if (winner.evidence.length > 1) {
    const second = SIGNAL_NAMES[winner.evidence[1]!.signal];
    return `${base}, confirmed by ${second}.`;
  }
  return `${base}.`;
}

/** Human-readable name for a canonical field, used in explanations. */
export function describeField(field: CanonicalField): string {
  const LABELS: Partial<Record<CanonicalField, string>> = {
    'personal.firstName': 'your first name',
    'personal.lastName': 'your last name',
    'personal.fullName': 'your full name',
    'personal.email': 'your email address',
    'personal.phone': 'your phone number',
    'address.city': 'your city',
    'address.state': 'your state or region',
    'address.country': 'your country',
    'address.formatted': 'your location',
    'links.linkedin': 'your LinkedIn profile',
    'links.github': 'your GitHub profile',
    'links.portfolio': 'your portfolio',
    'links.website': 'your personal website',
    'education.institution': 'your university',
    'education.degree': 'your degree',
    'education.major': 'your major',
    'education.gpa': 'your GPA',
    'education.graduationDate': 'your graduation date',
    'experience.company': 'your employer',
    'experience.title': 'your job title',
    'documents.resume': 'your resume file',
    'profile.summary': 'your summary',
    'profile.skills': 'your skills',
  };
  return (
    LABELS[field] ??
    field
      .replace(/^[a-z]+\./, '')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
  );
}

/** True when a classified field concerns somebody other than the candidate. */
export function isThirdPartyField(signals: FieldSignals): boolean {
  return THIRD_PARTY_RE.test(
    normalizeLabel(`${signals.labelText} ${signals.name} ${signals.precedingText}`),
  );
}
