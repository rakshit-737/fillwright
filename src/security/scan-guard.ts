import type { ControlKind, DetectedField, FieldOption, ScanResult } from '@/types/fields';
import { isPlainObject, sanitizeBoolean, sanitizeString } from './validate';

/**
 * Validates a scan arriving from a content script.
 *
 * A content script runs inside a page that may be hostile, so its messages are
 * treated as untrusted input from an untrusted process — not as data from our
 * own code. This rebuilds the scan field by field from scratch: anything the
 * schema does not expect is dropped rather than passed along, and every string
 * and array is capped so a page cannot exhaust the service worker's memory by
 * reporting a million fields with megabyte labels.
 */

const MAX_FIELDS = 400;
const MAX_OPTIONS = 200;
const MAX_LABEL = 600;
const MAX_VALUE = 5_000;

const CONTROL_KINDS: ReadonlySet<string> = new Set<ControlKind>([
  'text', 'email', 'tel', 'url', 'number', 'date', 'month', 'textarea', 'select',
  'radio-group', 'checkbox', 'checkbox-group', 'file', 'contenteditable', 'combobox', 'unsupported',
]);

export type ScanGuardResult =
  | { ok: true; scan: ScanResult }
  | { ok: false; error: string };

export function validateScan(input: unknown): ScanGuardResult {
  if (!isPlainObject(input)) return { ok: false, error: 'Scan is not an object' };
  if (!Array.isArray(input.fields)) return { ok: false, error: 'Scan has no fields array' };
  if (input.fields.length > MAX_FIELDS) {
    return { ok: false, error: `Scan reported more than ${MAX_FIELDS} fields` };
  }

  const fields: DetectedField[] = [];
  const seenIds = new Set<string>();

  for (const raw of input.fields) {
    if (!isPlainObject(raw)) continue;

    const id = sanitizeString(raw.id, 64);
    // Ids address elements in later messages, so duplicates and blanks are
    // dropped rather than allowed to collide.
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const kind = sanitizeString(raw.kind, 32);
    const signals = isPlainObject(raw.signals) ? raw.signals : {};
    const currentValue = sanitizeString(raw.currentValue, MAX_VALUE);

    fields.push({
      id,
      kind: (CONTROL_KINDS.has(kind) ? kind : 'unsupported') as ControlKind,
      signals: {
        labelText: sanitizeString(signals.labelText, MAX_LABEL),
        ariaLabel: sanitizeString(signals.ariaLabel, MAX_LABEL),
        ariaDescription: sanitizeString(signals.ariaDescription, MAX_LABEL),
        placeholder: sanitizeString(signals.placeholder, MAX_LABEL),
        name: sanitizeString(signals.name, 200),
        id: sanitizeString(signals.id, 200),
        autocomplete: sanitizeString(signals.autocomplete, 120),
        inputType: sanitizeString(signals.inputType, 32),
        title: sanitizeString(signals.title, MAX_LABEL),
        sectionHeading: sanitizeString(signals.sectionHeading, MAX_LABEL),
        precedingText: sanitizeString(signals.precedingText, MAX_LABEL),
        optionLabels: Array.isArray(signals.optionLabels)
          ? signals.optionLabels.slice(0, MAX_OPTIONS).map((label) => sanitizeString(label, 200))
          : [],
        required: sanitizeBoolean(signals.required),
        maxLength:
          typeof signals.maxLength === 'number' && Number.isFinite(signals.maxLength)
            ? Math.max(0, Math.trunc(signals.maxLength))
            : null,
      },
      options: sanitizeOptions(raw.options),
      currentValue,
      hasExistingValue: currentValue.trim().length > 0,
      visible: sanitizeBoolean(raw.visible, true),
      disabled: sanitizeBoolean(raw.disabled),
      readOnly: sanitizeBoolean(raw.readOnly),
      order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? Math.trunc(raw.order) : fields.length,
      selectorHint: sanitizeString(raw.selectorHint, 240),
      groupSignature: sanitizeString(raw.groupSignature, 400) || null,
      groupOrdinal:
        typeof raw.groupOrdinal === 'number' && Number.isFinite(raw.groupOrdinal)
          ? Math.max(0, Math.min(50, Math.trunc(raw.groupOrdinal)))
          : null,
    });
  }

  if (fields.length === 0) return { ok: false, error: 'Scan contained no usable fields' };

  return {
    ok: true,
    scan: {
      // The URL is overwritten by the caller with the sender's real one; a
      // page-supplied URL is never trusted for anything.
      url: '',
      pageKey: '',
      adapterId: sanitizeString(input.adapterId, 64) || null,
      scannedAt: new Date().toISOString(),
      fields,
      mappings: [],
    },
  };
}

function sanitizeOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  const options: FieldOption[] = [];
  for (const entry of raw.slice(0, MAX_OPTIONS)) {
    if (!isPlainObject(entry)) continue;
    options.push({
      value: sanitizeString(entry.value, 400),
      label: sanitizeString(entry.label, 400),
    });
  }
  return options;
}
