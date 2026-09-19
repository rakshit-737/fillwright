import { FIELD_CATALOG, isAssignable } from '@/field-detection/catalog';
import { hydrateProfile, isSafeId } from '@/profile/portable';
import { isPlainObject, sanitizeString } from './validate';
import { AUTOFILL_MODES, DEFAULT_SETTINGS, type Settings } from '@/types/settings';
import type { DeepPartial } from '@/types/messages';
import type { CanonicalField, SavedMapping } from '@/types/fields';
import type { Profile } from '@/types/profile';

/**
 * Validators for the worker's handler boundary.
 *
 * Every payload that a handler stores passes through one of these first. A
 * payload that is the wrong shape is rejected with a code and nothing is
 * written; a payload that is the right shape is rebuilt from known keys only.
 */

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string; code: string };

const fail = (error: string, code: string): { ok: false; error: string; code: string } => ({
  ok: false,
  error,
  code,
});

/* ---------------------------------------------------------------- profile */

/** Generous: a full profile is tens of KB. Resume files are stored separately. */
export const MAX_PROFILE_BYTES = 2_000_000;

export function validateProfilePayload(raw: unknown): Checked<Profile> {
  if (!isPlainObject(raw)) return fail('Profile is not an object', 'EBADPROFILE');
  if (!isSafeId(raw.id)) return fail('Profile is missing a valid id', 'EBADPROFILE');
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return fail('Profile cannot be stored', 'EBADPROFILE');
  }
  if (size > MAX_PROFILE_BYTES) return fail('Profile is too large', 'EBADPROFILE');
  return { ok: true, value: hydrateProfile(raw) };
}

/* --------------------------------------------------------------- settings */

const ENUMS: Record<string, readonly unknown[]> = {
  'autofill.mode': AUTOFILL_MODES,
  'privacy.autoLockMinutes': [0, 5, 15, 30, 60],
  'ai.provider': ['none', 'chrome-builtin'],
  'ui.theme': ['system', 'light', 'dark'],
};

const RANGES: Record<string, [number, number, boolean]> = {
  // [min, max, integer]
  'autofill.confidenceThreshold': [0.5, 0.99, false],
  onboardingStep: [0, 50, true],
};

/**
 * Keys a settings page may not set. The vault owns `encryptionEnabled` (it
 * must match the stored key material), and `version` belongs to storage.
 */
const WORKER_OWNED = new Set(['privacy.encryptionEnabled', 'version']);

/**
 * Checks a partial settings patch against the shape of DEFAULT_SETTINGS.
 * Unknown keys are dropped; a wrong type or an out-of-set enum rejects the
 * whole patch; numbers are clamped the same way the import path clamps them.
 */
export function validateSettingsPatch(raw: unknown): Checked<DeepPartial<Settings>> {
  if (!isPlainObject(raw)) return fail('Settings patch is not an object', 'EBADSETTINGS');
  const problems: string[] = [];
  const value = walkSettings(
    raw,
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    '',
    problems,
  );
  if (problems.length > 0)
    return fail(`Invalid setting: ${problems.slice(0, 3).join(', ')}`, 'EBADSETTINGS');
  return { ok: true, value: value as DeepPartial<Settings> };
}

function walkSettings(
  patch: Record<string, unknown>,
  base: Record<string, unknown>,
  prefix: string,
  problems: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (WORKER_OWNED.has(path) || item === undefined) continue;
    const current = base[key];

    if (path === 'activeProfileId') {
      if (item === null || isSafeId(item)) out[key] = item;
      else problems.push(path);
    } else if (isPlainObject(current)) {
      if (!isPlainObject(item)) problems.push(path);
      else out[key] = walkSettings(item, current, path, problems);
    } else if (ENUMS[path]) {
      if (ENUMS[path]!.includes(item)) out[key] = item;
      else problems.push(path);
    } else if (typeof current === 'number') {
      if (typeof item !== 'number' || !Number.isFinite(item)) {
        problems.push(path);
        continue;
      }
      const range = RANGES[path];
      if (!range) {
        problems.push(path);
        continue;
      }
      const [min, max, integer] = range;
      const clamped = Math.max(min, Math.min(max, item));
      out[key] = integer ? Math.trunc(clamped) : clamped;
    } else if (typeof current === 'boolean') {
      if (typeof item === 'boolean') out[key] = item;
      else problems.push(path);
    } else {
      problems.push(path);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- mapping */

type MappingInput = Omit<SavedMapping, 'id' | 'createdAt' | 'useCount' | 'origin'>;

const KNOWN_FIELDS = new Set<string>(FIELD_CATALOG.map((entry) => entry.field));

/** A mapping taught on a page: the field must be in the catalog and assignable. */
export function validateMappingInput(raw: unknown): Checked<MappingInput> {
  if (!isPlainObject(raw)) return fail('Mapping is not an object', 'EBADFIELD');
  const canonical = typeof raw.canonical === 'string' ? raw.canonical : '';
  if (!KNOWN_FIELDS.has(canonical) || !isAssignable(canonical as CanonicalField))
    return fail('Unknown field', 'EBADFIELD');
  const fingerprint = sanitizeString(raw.fingerprint, 240);
  if (!fingerprint) return fail('Mapping has no fingerprint', 'EBADFIELD');
  const customKey = sanitizeString(raw.customKey, 80);
  return {
    ok: true,
    value: {
      fingerprint,
      label: sanitizeString(raw.label, 120),
      canonical: canonical as CanonicalField,
      ...(customKey ? { customKey } : {}),
    },
  };
}
