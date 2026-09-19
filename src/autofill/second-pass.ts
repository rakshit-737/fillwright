import type { DetectedField, FillPlan } from '@/types/fields';
import { normalizeLabel } from '@/field-detection/normalize';

/**
 * Dependent dropdowns: the second pass.
 *
 * Trust boundary: pure functions over harvested data; no DOM, no profile.
 *
 * Choosing a country often loads that country's states into a second select a
 * moment later. The first plan saw that select empty ("none of the available
 * options match"), so after a fill the page is read again and this picks out
 * the controls worth planning afresh: a select whose options changed since the
 * plan was made. Nothing here fills anything. The content script only offers
 * "N more fields can be filled now", and the user decides.
 */

/** Identity of a control across two harvests, whose `fw-N` ids may shift. */
function keyOf(field: DetectedField): string {
  // Not plan.ts's fingerprint: that would pull the classifier into the content
  // script. Label, name and position are enough to recognise the same select.
  const label = normalizeLabel(field.signals.labelText || field.signals.ariaLabel);
  return `${field.selectorHint}|${label}|${field.signals.name}|${field.kind}|${field.groupOrdinal ?? ''}`;
}

function optionsKey(field: DetectedField): string {
  return field.options.map((option) => `${option.value}=${option.label}`).join('|');
}

/**
 * Fields in `after` that may be fillable now but were not when `plan` was
 * made: selects, still empty, whose option list changed — grew or shrank, or,
 * for an entry that failed for want of a matching option, changed at all.
 */
export function secondPassTargets(
  before: DetectedField[],
  after: DetectedField[],
  plan: FillPlan | null,
): DetectedField[] {
  const previous = new Map(before.map((field) => [keyOf(field), field]));
  const failedOnOptions = new Set(
    (plan?.entries ?? [])
      .filter(
        (entry) =>
          entry.newValue === '' && /none of the available options match/.test(entry.rationale),
      )
      .map((entry) => entry.fieldId),
  );

  return after.filter((field) => {
    if (field.kind !== 'select' || field.hasExistingValue || field.disabled) {
      return false;
    }
    const earlier = previous.get(keyOf(field));
    if (!earlier || optionsKey(earlier) === optionsKey(field)) return false;
    return earlier.options.length !== field.options.length || failedOnOptions.has(earlier.id);
  });
}
