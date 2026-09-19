import type { Profile, SavedAnswer } from '@/types/profile';

/**
 * Custom fields (Profile) and saved answers (Preferences) are text the user
 * wrote by hand, so they are never guessed into a form. They reach a page in
 * exactly two ways:
 *
 *  - a mapping the user taught on a site ("One of your custom fields…"),
 *    stored as canonical `custom` with a `customKey` pointing at the item;
 *  - an explicit "Use a saved answer" pick on a written question, where the
 *    content script first sees titles only and receives the text of the one
 *    answer the user chose.
 */

export type CustomKind = 'field' | 'answer';

export interface AnswerChoice {
  id: string;
  label: string;
}

export interface AnswerChoices {
  custom: AnswerChoice[];
  answers: AnswerChoice[];
}

const KEY_PATTERN = /^(field|answer):([A-Za-z0-9_-]{1,64})$/;

export function customKeyFor(kind: CustomKind, id: string): string {
  return `${kind}:${id}`;
}

export function isValidCustomKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

function parseCustomKey(value: unknown): { kind: CustomKind; id: string } | null {
  if (typeof value !== 'string') return null;
  const match = KEY_PATTERN.exec(value);
  return match ? { kind: match[1] as CustomKind, id: match[2]! } : null;
}

export interface CustomResolution {
  value: string;
  note: string;
}

/** The value a taught `custom` mapping points to, or empty with a reason. */
export function resolveCustom(profile: Profile, customKey: string | undefined): CustomResolution {
  const key = parseCustomKey(customKey);
  if (!key) return { value: '', note: 'no custom field or saved answer was chosen' };
  if (key.kind === 'field') {
    const field = profile.custom.find((item) => item.id === key.id);
    const value = field?.value.trim() ?? '';
    return value
      ? { value, note: `from your custom field “${field!.label || 'untitled'}”` }
      : { value: '', note: 'the custom field chosen for this is empty or no longer exists' };
  }
  const answer = profile.preferences.savedAnswers.find((item) => item.id === key.id);
  const value = answer?.text.trim() ?? '';
  return value
    ? { value, note: `from your saved answer “${answer!.label || 'untitled'}”` }
    : { value: '', note: 'the saved answer chosen for this is empty or no longer exists' };
}

const STOP_WORDS = new Set(
  'a an and are as at be by did do does for from have how i in is it me of on or our please the this to us we what when where which who why will with you your'.split(
    ' ',
  ),
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
      // A crude stem, so "strengths" meets "strength".
      .map((word) => (word.length > 4 ? word.replace(/(?:ing|es|s)$/, '') : word)),
  );
}

/**
 * Orders saved answers by how many words their title shares with the
 * question. Nothing is dropped and nothing is chosen: the ranking only decides
 * which title is listed first.
 */
export function rankSavedAnswers(question: string, answers: SavedAnswer[]): SavedAnswer[] {
  const wanted = tokens(question);
  return answers
    .map((answer, index) => {
      let score = 0;
      for (const word of tokens(`${answer.label} ${answer.key.replace(/[-_]/g, ' ')}`)) {
        if (wanted.has(word)) score += 1;
      }
      return { answer, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.answer);
}

/** Titles only — the content script never receives a value from here. */
export function answerChoices(profile: Profile, question: string): AnswerChoices {
  return {
    custom: profile.custom
      .filter((field) => field.value.trim())
      .slice(0, 100)
      .map((field) => ({ id: field.id, label: title(field.label || field.key) })),
    answers: rankSavedAnswers(
      question,
      profile.preferences.savedAnswers.filter((answer) => answer.text.trim()),
    )
      .slice(0, 100)
      .map((answer) => ({ id: answer.id, label: title(answer.label || answer.key) })),
  };
}

/** The text of one saved answer the user picked, or null. */
export function savedAnswerText(profile: Profile, id: string): string | null {
  const answer = profile.preferences.savedAnswers.find((item) => item.id === id);
  const text = answer?.text.trim() ?? '';
  return text ? text : null;
}

function title(text: string): string {
  const trimmed = text.trim() || 'Untitled';
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}
