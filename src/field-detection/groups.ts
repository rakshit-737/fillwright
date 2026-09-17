import type { CanonicalField, DetectedField } from '@/types/fields';

/**
 * Repeated-section detection.
 *
 * Application forms routinely ask for the same thing several times:
 *
 *   Education #1   University · Degree · Start · End
 *   Education #2   University · Degree · Start · End
 *
 * Filling every one of those from `education[0]` produces a form that claims
 * the candidate attended the same university twice. So each repeated block has
 * to be matched to the corresponding profile entry.
 *
 * Three signals, strongest first — a form only needs to provide one:
 *
 *  1. An explicit index in the field's name or id. `education[1].school`,
 *     `school_2`, `degree-3`. Unambiguous when present, and very common,
 *     because the server needs the index too.
 *  2. A number in the section heading: "Education #2", "Employer 3".
 *  3. Structural repetition: the field's nearest repeating ancestor, and its
 *     position among identically-shaped siblings.
 *
 * When nothing indicates repetition the index is 0 and behaviour is unchanged.
 */

export type GroupKind = 'education' | 'experience' | 'other';

export interface FieldGroup {
  kind: GroupKind;
  /** Zero-based: block #1 is index 0. */
  index: number;
  /** Why this index was chosen, surfaced in the review UI. */
  source: 'field-name' | 'heading' | 'structure' | 'single';
}

/** Which profile list a canonical field is drawn from. */
export function groupKindOf(field: CanonicalField): GroupKind {
  if (field.startsWith('education.')) return 'education';
  if (field.startsWith('experience.')) return 'experience';
  return 'other';
}

/* ------------------------------------------------------- explicit indices */

/**
 * Digits that are part of the field's identity rather than a repeat index.
 * `address_line_1` and `phone2` are not the second address or phone entry.
 */
const NOT_AN_INDEX =
  /\b(?:line|address|phone|tel|zip|postal|street|apt|suite|floor|24|7|1099|401k?)\b/i;

/**
 * Reads a repeat index out of a field's name or id.
 *
 * Matches the shapes servers actually emit: `education[1]`, `education.1.`,
 * `school_2`, `degree-3`, `edu3_school`.
 */
export function indexFromIdentifier(raw: string): number | null {
  if (!raw) return null;
  const value = raw.toLowerCase();
  // Underscores are word characters, so `\bline\b` does not match inside
  // `address_line_1`. Separators are flattened to spaces before the guard runs.
  const spaced = value.replace(/[_\-.[\]]+/g, ' ');

  // An index next to a section word: education[1], jobs.2.title, school_2.
  // The separator carries meaning: brackets and dots are how code indexes an
  // array, so they are zero-based, while a human-written `_2` suffix counts
  // from one. Getting this backwards fills block two from entry three.
  const scoped = value.match(
    /(?:education|school|college|degree|academic|experience|employment|employer|job|work|position)\w*([[.\-_])(\d{1,2})\b/,
  );
  if (scoped?.[2]) {
    const zeroBased = scoped[1] === '[' || scoped[1] === '.';
    return clampIndex(Number(scoped[2]), !zeroBased);
  }

  // Deliberately NOT matched: a bare bracketed number anywhere in the name.
  // Greenhouse emits `job_application[answers_attributes][3][text_value]` for
  // an ordinary custom question, and reading that "3" as a repeat index sends
  // the field looking for a fourth education entry that does not exist. An
  // index only counts when it sits against a section word.

  // Trailing separator + digit: entry_2, block-3
  if (!NOT_AN_INDEX.test(spaced)) {
    const trailing = value.match(/[_\-.](\d{1,2})$/);
    if (trailing?.[1]) return clampIndex(Number(trailing[1]), true);
  }

  return null;
}

/** Reads "Education #2", "Work Experience 3", "Employer 2" from a heading. */
export function indexFromHeading(heading: string): number | null {
  if (!heading) return null;
  const match = heading.match(
    /\b(?:education|school|college|degree|qualification|experience|employment|employer|job|role|position)\b[^\d]{0,12}#?\s*(\d{1,2})\b/i,
  );
  if (match?.[1]) return clampIndex(Number(match[1]), true);
  return null;
}

/**
 * Normalises a form's numbering to a zero-based index.
 *
 * Forms number from 0 or from 1 depending on who wrote them. A value of 0 is
 * certainly zero-based; anything else is assumed one-based when it came from
 * human-facing text, and taken literally when it came from a machine name.
 */
function clampIndex(value: number, oneBased = false): number | null {
  if (!Number.isFinite(value) || value < 0 || value > 20) return null;
  if (oneBased) return Math.max(0, value - 1);
  return value;
}

/* ------------------------------------------------------------- assignment */

/**
 * Assigns a group to every field.
 *
 * Structural indices are only trusted when the *same* structural signature
 * appears more than once: a signature seen once is just a container, not a
 * repeated block.
 */
export function assignGroups(
  fields: DetectedField[],
  classifications: Map<string, CanonicalField>,
): Map<string, FieldGroup> {
  const groups = new Map<string, FieldGroup>();

  // A structural signature is evidence of repetition only when the SAME kind
  // of field appears at two or more positions under it — two schools, two
  // employers. A wrapper that every field on the form sits in (Greenhouse's
  // div.field, Lever's li.application-question) repeats too, but holds a
  // different field each time, and must not be read as numbered blocks.
  const positionsByKind = new Map<string, Set<number>>();
  for (const field of fields) {
    if (!field.groupSignature) continue;
    const canonical = classifications.get(field.id) ?? 'unknown';
    if (groupKindOf(canonical) === 'other') continue;
    const key = `${field.groupSignature}|${canonical}`;
    const seen = positionsByKind.get(key) ?? new Set<number>();
    seen.add(field.groupOrdinal ?? 0);
    positionsByKind.set(key, seen);
  }
  const repeatedSignatures = new Set<string>();
  for (const [key, seen] of positionsByKind) {
    if (seen.size > 1) repeatedSignatures.add(key.slice(0, key.lastIndexOf('|')));
  }

  for (const field of fields) {
    const canonical = classifications.get(field.id) ?? 'unknown';
    const kind = groupKindOf(canonical);

    if (kind === 'other') {
      groups.set(field.id, { kind, index: 0, source: 'single' });
      continue;
    }

    const fromName = indexFromIdentifier(field.signals.name);
    if (fromName !== null) {
      groups.set(field.id, { kind, index: fromName, source: 'field-name' });
      continue;
    }

    const fromHeading = indexFromHeading(field.signals.sectionHeading);
    if (fromHeading !== null) {
      groups.set(field.id, { kind, index: fromHeading, source: 'heading' });
      continue;
    }

    // Ids are often generated counters ("school-7") rather than positions, so
    // an id is only trusted when it uses array syntax: education[1], edu.1.x.
    // Greenhouse's "school--1" (double dash, zero-based) is also positional.
    const doubleDash = field.signals.id.match(/--(\d{1,2})$/);
    const fromId = doubleDash?.[1]
      ? Number(doubleDash[1])
      : /[[.]\d{1,2}[\].]/.test(field.signals.id)
        ? indexFromIdentifier(field.signals.id)
        : null;
    if (fromId !== null) {
      groups.set(field.id, { kind, index: fromId, source: 'field-name' });
      continue;
    }

    const repeats = field.groupSignature ? repeatedSignatures.has(field.groupSignature) : false;
    if (repeats && field.groupOrdinal !== null && field.groupOrdinal !== undefined) {
      groups.set(field.id, { kind, index: field.groupOrdinal, source: 'structure' });
      continue;
    }

    groups.set(field.id, { kind, index: 0, source: 'single' });
  }

  return groups;
}

/** How many blocks of each kind the form appears to contain. */
export function countBlocks(groups: Map<string, FieldGroup>): Record<GroupKind, number> {
  const seen: Record<GroupKind, Set<number>> = {
    education: new Set(),
    experience: new Set(),
    other: new Set(),
  };
  for (const group of groups.values()) seen[group.kind].add(group.index);
  return {
    education: seen.education.size,
    experience: seen.experience.size,
    other: seen.other.size,
  };
}
