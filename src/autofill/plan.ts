import type {
  DetectedField,
  FieldMapping,
  FillPlan,
  FillPlanEntry,
  MappingStatus,
  SavedMapping,
  ScanResult,
} from '@/types/fields';
import type { Profile } from '@/types/profile';
import type { Settings } from '@/types/settings';
import { classifyField, describeField, isThirdPartyField } from '@/field-detection/classify';
import { assignGroups, countBlocks, groupKindOf, type FieldGroup } from '@/field-detection/groups';
import { resolveForField } from './resolve';
import { isSensitiveField, requiresExplicitConsent } from '@/security/sensitive';
import { normalizeLabel } from '@/field-detection/normalize';
export { STATUS_LABELS } from './status';

/**
 * Turns detected fields into a reviewable plan.
 *
 * This is where every safety rule is actually enforced, in one place:
 *
 *  - a field the user already filled is never overwritten without permission;
 *  - a weak match is offered for review instead of being written;
 *  - a high-risk question is never answered from an inference, and the riskiest
 *    ones are never answered without confirmation even when an answer exists;
 *  - a field belonging to somebody else (a referee, an emergency contact) is
 *    left alone entirely.
 */
export function buildMappings(
  fields: DetectedField[],
  profile: Profile,
  settings: Settings,
  savedMappings: SavedMapping[] = [],
): FieldMapping[] {
  const byFingerprint = new Map(savedMappings.map((mapping) => [mapping.fingerprint, mapping]));

  // Classify everything first: repeated-block detection needs to know which
  // fields belong to the education/experience families before it can tell a
  // repeated block from an ordinary container.
  const classifications = new Map<string, ReturnType<typeof classifyField>>();
  for (const field of fields) {
    const saved = byFingerprint.get(fingerprintOf(field));
    classifications.set(
      field.id,
      saved
        ? {
            field: saved.canonical,
            confidence: 0.99,
            rationale: isOneOff(saved)
              ? 'you chose this for this form'
              : 'you taught Fillwright this mapping on this website',
            isOpenQuestion: false,
          }
        : classifyField(field.signals),
    );
  }

  resolveLoneNameField(fields, classifications);

  const groups = assignGroups(
    fields,
    new Map([...classifications].map(([id, result]) => [id, result.field])),
  );

  return fields.map((field) => {
    const saved = byFingerprint.get(fingerprintOf(field));
    const classification = classifications.get(field.id)!;
    const group: FieldGroup = groups.get(field.id) ?? { kind: 'other', index: 0, source: 'single' };

    const base: FieldMapping = {
      fieldId: field.id,
      canonical: classification.field,
      confidence: classification.confidence,
      status: 'unmapped',
      proposedValue: '',
      rationale: classification.rationale,
      fromSavedRule: Boolean(saved) && !isOneOff(saved),
      corrected: Boolean(saved),
      entryIndex: group.index,
    };

    /* --- fields we refuse to touch ------------------------------------- */

    if (field.disabled || field.readOnly) {
      return { ...base, status: 'unmapped', rationale: 'this field is not editable' };
    }

    // Somebody else's details. Filling these with the candidate's data would be
    // actively wrong, so they are dropped regardless of how well they matched.
    // A mapping the user taught explicitly overrides this: they know what the
    // field is on their own application better than a keyword heuristic does.
    if (!saved && isThirdPartyField(field.signals)) {
      return {
        ...base,
        canonical: 'unknown',
        status: 'unmapped',
        rationale: 'this asks about someone else, so Fillwright leaves it to you',
      };
    }

    if (classification.isOpenQuestion) {
      return {
        ...base,
        status: 'manual-required',
        rationale: 'this is a written question — Fillwright will not answer it for you',
      };
    }

    if (classification.field === 'unknown') {
      return { ...base, status: 'unmapped' };
    }

    if (
      classification.field === 'documents.resume' ||
      classification.field === 'documents.coverLetter'
    ) {
      // File inputs cannot be populated programmatically, by browser design.
      return {
        ...base,
        status: 'manual-required',
        rationale:
          'browsers do not allow an extension to attach a file — please choose it yourself',
      };
    }

    /* --- resolve a value ------------------------------------------------ */

    const resolved = resolveForField(classification.field, field, profile, group.index);
    const sensitive = isSensitiveField(classification.field);

    if (resolved.needsConsent || (sensitive && !resolved.value)) {
      return {
        ...base,
        status: 'needs-consent',
        rationale: resolved.note
          ? `Needs your answer: ${resolved.note}.`
          : 'This is a question only you can answer.',
      };
    }

    if (!resolved.value) {
      return {
        ...base,
        status: 'missing-value',
        rationale: `Fillwright has no value for ${describeField(classification.field)} — ${resolved.note}.`,
      };
    }

    /* --- decide whether it is safe to write ----------------------------- */

    const combined = Math.min(classification.confidence, resolved.confidence);
    const blockNote =
      group.index > 0 || group.source !== 'single'
        ? ` This is ${group.kind} block ${group.index + 1} on the form.`
        : '';
    const entry: FieldMapping = {
      ...base,
      confidence: combined,
      proposedValue: resolved.value,
      rationale: `${classification.rationale} Value ${resolved.note}.${blockNote}`,
    };
    if (resolved.optionValue !== undefined) entry.proposedOptionValue = resolved.optionValue;

    // The riskiest declarations are confirmed on every application, even with a
    // saved answer. Consenting to a background check is not something an
    // extension should do unattended.
    if (requiresExplicitConsent(classification.field)) {
      return {
        ...entry,
        status: 'needs-consent',
        rationale: `${entry.rationale} This one always needs your confirmation.`,
      };
    }

    if (field.hasExistingValue && !settings.autofill.allowOverwrite) {
      return {
        ...entry,
        status: 'skipped-existing',
        rationale: 'this field already has a value, and overwriting is switched off',
      };
    }

    if (combined < settings.autofill.confidenceThreshold) {
      return { ...entry, status: 'review' };
    }

    // A sensitive field with a real stored answer is still surfaced distinctly
    // in the UI, but it is fillable.
    return { ...entry, status: sensitive ? 'review' : 'ready' };
  });
}

/**
 * A bare "Name" is ambiguous on its own, so it scores below the autofill
 * threshold. On a form that asks for the candidate's email and has no
 * separate first/last name fields, it is the candidate's name — Lever and
 * Ashby both ask this way. The field is still skipped if it reads as someone
 * else's (the third-party check runs later, as for every field).
 */
function resolveLoneNameField(
  fields: DetectedField[],
  classifications: Map<string, ReturnType<typeof classifyField>>,
): void {
  const kinds = [...classifications.values()];
  const hasEmail = kinds.some((c) => c.field === 'personal.email' && c.confidence >= 0.7);
  const hasSplitName = kinds.some(
    (c) =>
      (c.field === 'personal.firstName' || c.field === 'personal.lastName') && c.confidence >= 0.5,
  );
  if (!hasEmail || hasSplitName) return;

  const bare = fields.filter((field) => {
    const c = classifications.get(field.id);
    const label = normalizeLabel(field.signals.labelText || field.signals.ariaLabel);
    return c?.field === 'personal.fullName' && c.confidence < 0.7 && /^(?:your )?name$/.test(label);
  });
  if (bare.length !== 1) return;
  const only = bare[0]!;
  const current = classifications.get(only.id)!;
  classifications.set(only.id, {
    ...current,
    confidence: 0.8,
    rationale: `${current.rationale} It is the only name field on a form that asks for your email, so it is almost certainly yours.`,
  });
}

/** A correction made for the current form only; see `content:request-mappings`. */
function isOneOff(mapping: SavedMapping | undefined): boolean {
  return Boolean(mapping?.id.startsWith('override-'));
}

/**
 * A stable identity for a field on a given site, used to remember a mapping the
 * user taught us. Built from the label and name rather than the DOM position,
 * because forms reorder and re-render between visits.
 */
export function fingerprintOf(field: DetectedField): string {
  const parts = [
    normalizeLabel(field.signals.labelText || field.signals.ariaLabel),
    normalizeLabel(field.signals.name),
    field.kind,
  ].filter(Boolean);
  return parts.join('|').slice(0, 240);
}

/**
 * The values-free variant of a plan, for a panel the user has not opened yet.
 * Counts and statuses survive so the pill can say "4 ready"; the proposed
 * values and the rationales (which can quote them) do not leave the worker.
 */
export function withoutValues(plan: FillPlan): FillPlan {
  return {
    ...plan,
    withheld: true,
    entries: plan.entries.map((entry) => ({ ...entry, newValue: '', rationale: '' })),
  };
}

/** Assembles the preview the user reviews before anything is written. */
export function buildFillPlan(
  scan: ScanResult,
  scanId: string,
  available: { education: number; experience: number } = { education: 0, experience: 0 },
): FillPlan {
  const fieldsById = new Map(scan.fields.map((field) => [field.id, field]));

  const entries: FillPlanEntry[] = scan.mappings
    .map((mapping): FillPlanEntry | null => {
      const field = fieldsById.get(mapping.fieldId);
      if (!field) return null;
      return {
        fieldId: mapping.fieldId,
        label: displayLabel(field),
        canonical: mapping.canonical,
        currentValue: field.currentValue,
        newValue: mapping.proposedValue,
        status: mapping.status,
        confidence: mapping.confidence,
        rationale: mapping.rationale,
        // Only unambiguously safe entries start selected. Everything else is an
        // opt-in, so a hurried click on "Fill" cannot write a doubtful value.
        selected: mapping.status === 'ready',
        fingerprint: fingerprintOf(field),
        remembered: mapping.fromSavedRule,
        corrected: Boolean(mapping.corrected),
        required: field.signals.required,
      } satisfies FillPlanEntry;
    })
    .filter((entry): entry is FillPlanEntry => entry !== null)
    .filter((entry) => entry.status !== 'unmapped' || entry.currentValue === '')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const blocks = countBlocks(
    new Map(
      scan.mappings.map((mapping) => [
        mapping.fieldId,
        {
          kind: groupKindOf(mapping.canonical),
          index: mapping.entryIndex,
          source: 'single' as const,
        },
      ]),
    ),
  );

  return {
    scanId,
    entries,
    readyCount: entries.filter((entry) => entry.status === 'ready').length,
    reviewCount: entries.filter((entry) => NEEDS_ATTENTION.has(entry.status)).length,
    skippedCount: entries.filter((entry) => entry.status === 'skipped-existing').length,
    blocks: { education: blocks.education, experience: blocks.experience },
    available,
  };
}

const NEEDS_ATTENTION: ReadonlySet<MappingStatus> = new Set<MappingStatus>([
  'review',
  'needs-consent',
  'manual-required',
  'missing-value',
]);

const STATUS_ORDER: Record<MappingStatus, number> = {
  ready: 0,
  review: 1,
  'needs-consent': 2,
  'missing-value': 3,
  'manual-required': 4,
  'skipped-existing': 5,
  unmapped: 6,
};

export function displayLabel(field: DetectedField): string {
  const raw =
    field.signals.labelText ||
    field.signals.ariaLabel ||
    field.signals.placeholder ||
    field.signals.name ||
    'Unlabelled field';
  return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
}
