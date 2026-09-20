import { createEmptyProfile, newId, now } from './factory';
import {
  emptyAchievement,
  emptyCertification,
  emptyCustomField,
  emptyEducation,
  emptyExperience,
  emptyLanguage,
  emptyProject,
  emptyPublication,
  emptySavedAnswer,
  emptySkill,
} from './entries';
import { FIELD_CATALOG } from '@/field-detection/catalog';
import { isPlainObject, originFromUrl, sanitizeString } from '@/security/validate';
import {
  decryptJson,
  deriveKey,
  encryptJson,
  isEncryptedBlob,
  newKdfParams,
  type EncryptedBlob,
  type KdfParams,
} from '@/security/crypto';
import { DEFAULT_SETTINGS, AUTOFILL_MODES, type Settings } from '@/types/settings';
import type { ApplicationHistoryEntry, DeepPartial } from '@/types/messages';
import { isRetentionChoice, sanitizeTrackerPatch } from '@/storage/history-model';
import type { CanonicalField, SavedMapping } from '@/types/fields';
import type { Profile } from '@/types/profile';

/**
 * Export / import.
 *
 * Trust boundary: the import file is untrusted input from disk, handled in the
 * worker; it is rebuilt field by field before anything is stored.
 *
 * The export is a plain JSON file the user saves themselves; nothing is
 * uploaded. The import is the more dangerous direction — the file could have
 * been edited, truncated, or crafted — so it is never trusted as-is. Every
 * profile is rebuilt against the current schema: unknown keys are dropped,
 * every string is capped, every list is bounded, and every enum is checked.
 * Imported profiles always get fresh ids, so an import can add to what is
 * stored but can never silently replace it.
 *
 * An export can be sealed with a passphrase (`encryptExport`). An import is two
 * steps: the worker parses the file into a preview, the user ticks what to
 * keep, and only then is anything stored. Imported mappings are marked
 * `imported` and proposed at review confidence until confirmed on a real form.
 */

export const EXPORT_FORMAT = 'fillwright-export';
export const EXPORT_VERSION = 2;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  profiles: Profile[];
  mappings: SavedMapping[];
  settings: PortableSettings;
  history?: ApplicationHistoryEntry[];
}

/**
 * Settings that make sense on another device. The active profile id, the
 * vault state and onboarding progress are local facts and are left out —
 * importing "encryption: on" without the key would lock the user out.
 */
export type PortableSettings = Pick<Settings, 'autofill' | 'ui' | 'ai'> & {
  privacy: Pick<
    Settings['privacy'],
    'keepApplicationHistory' | 'autoLockMinutes' | 'historyRetentionMonths'
  >;
};

export function portableSettings(settings: Settings): PortableSettings {
  return {
    autofill: settings.autofill,
    ui: settings.ui,
    ai: settings.ai,
    privacy: {
      keepApplicationHistory: settings.privacy.keepApplicationHistory,
      autoLockMinutes: settings.privacy.autoLockMinutes,
      historyRetentionMonths: settings.privacy.historyRetentionMonths,
    },
  };
}

export interface ImportPlan {
  profiles: Profile[];
  mappings: Array<Omit<SavedMapping, 'id' | 'createdAt' | 'useCount'> & { imported: true }>;
  settings: DeepPartial<Settings> | null;
  history: ApplicationHistoryEntry[];
  warnings: string[];
}

const MAX_PROFILES = 20;
const MAX_MAPPINGS = 2_000;
const MAX_HISTORY = 5_000;
const MAX_LIST = 100;
const MAX_TEXT = 10_000;

export function parseImport(input: unknown, existingNames: string[] = []): ImportPlan {
  if (!isPlainObject(input)) throw new Error('This file is not a Fillwright export.');
  if (isEncryptedExport(input)) {
    throw new Error('This export is protected with a passphrase. Enter it to open the file.');
  }
  // Version 1 exports predate the format marker; accept them if they look right.
  if (input.format !== undefined && input.format !== EXPORT_FORMAT) {
    throw new Error('This file is not a Fillwright export.');
  }
  if (typeof input.version === 'number' && input.version > EXPORT_VERSION) {
    throw new Error(
      'This export was made by a newer version of Fillwright. Update Fillwright and try again.',
    );
  }
  if (!Array.isArray(input.profiles)) throw new Error('This export contains no profiles.');

  const warnings: string[] = [];
  const names = new Set(existingNames.map((name) => name.toLowerCase()));

  const rawProfiles = input.profiles.slice(0, MAX_PROFILES);
  if (input.profiles.length > MAX_PROFILES)
    warnings.push(`Only the first ${MAX_PROFILES} profiles were imported.`);

  const profiles: Profile[] = [];
  for (const raw of rawProfiles) {
    if (!isPlainObject(raw)) continue;
    const profile = conformProfile(raw);
    let name = profile.name || 'Imported profile';
    if (names.has(name.toLowerCase())) name = `${name} (imported)`;
    names.add(name.toLowerCase());
    profiles.push({ ...profile, name });
  }
  if (profiles.length === 0) throw new Error('No usable profiles were found in this file.');

  const known = new Set<string>(FIELD_CATALOG.map((entry) => entry.field));
  const mappings: ImportPlan['mappings'] = [];
  if (Array.isArray(input.mappings)) {
    for (const raw of input.mappings.slice(0, MAX_MAPPINGS)) {
      if (!isPlainObject(raw)) continue;
      const origin = originFromUrl(raw.origin);
      const fingerprint = sanitizeString(raw.fingerprint, 240);
      const canonical = sanitizeString(raw.canonical, 64);
      if (!origin || !fingerprint || !known.has(canonical)) continue;
      mappings.push({
        origin,
        fingerprint,
        label: sanitizeString(raw.label, 120),
        canonical: canonical as CanonicalField,
        ...(raw.customKey ? { customKey: sanitizeString(raw.customKey, 80) } : {}),
        ...(raw.disabled === true ? { disabled: true } : {}),
        // Whatever the file says, a rule from a file is unconfirmed here.
        imported: true,
      });
    }
  }

  const history: ApplicationHistoryEntry[] = [];
  if (Array.isArray(input.history)) {
    for (const raw of input.history.slice(0, MAX_HISTORY)) {
      if (!isPlainObject(raw)) continue;
      const appliedAt = sanitizeString(raw.appliedAt, 40);
      if (Number.isNaN(Date.parse(appliedAt))) continue;
      history.push({
        id: newId('app'),
        company: sanitizeString(raw.company, 120),
        role: sanitizeString(raw.role, 120),
        origin: originFromUrl(raw.origin),
        appliedAt,
        fieldsFilled: Math.max(0, Math.min(500, Math.trunc(Number(raw.fieldsFilled)) || 0)),
        ...importedTracker(raw),
      });
    }
  }

  return {
    profiles,
    mappings,
    settings: isPlainObject(input.settings) ? conformSettings(input.settings) : null,
    history,
    warnings,
  };
}

/* ----------------------------------------------------------------- review */

export type SettingValue = string | number | boolean;

export interface SettingChange {
  /** Dotted path into the portable settings, e.g. "autofill.allowOverwrite". */
  path: string;
  from: SettingValue;
  to: SettingValue;
}

export interface ImportPreview {
  profiles: Array<{ index: number; name: string }>;
  mappings: Array<{
    index: number;
    origin: string;
    label: string;
    canonical: CanonicalField;
    imported: true;
  }>;
  /** Only settings the file would actually change. */
  settingsChanges: SettingChange[];
  history: number;
  warnings: string[];
}

export interface ImportSelection {
  profiles: number[];
  mappings: number[];
  settings: string[];
  history?: boolean;
}

/** Every setting an import may touch, as dotted paths. */
const PORTABLE_PATHS: string[] = Object.entries(portableSettings(DEFAULT_SETTINGS)).flatMap(
  ([group, values]) => Object.keys(values).map((key) => `${group}.${key}`),
);

function readPath(source: unknown, path: string): SettingValue | undefined {
  const [group, key] = path.split('.') as [string, string];
  if (!isPlainObject(source) || !Object.prototype.hasOwnProperty.call(source, group))
    return undefined;
  const bag = source[group];
  if (!isPlainObject(bag) || !Object.prototype.hasOwnProperty.call(bag, key)) return undefined;
  const value = bag[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

/** What the review screen shows: what is in the file, against what is stored. */
export function previewImport(plan: ImportPlan, current: Settings): ImportPreview {
  const settingsChanges: SettingChange[] = [];
  if (plan.settings) {
    const stored = portableSettings(current);
    for (const path of PORTABLE_PATHS) {
      const to = readPath(plan.settings, path);
      const from = readPath(stored, path);
      if (to !== undefined && from !== undefined && to !== from)
        settingsChanges.push({ path, from, to });
    }
  }
  return {
    profiles: plan.profiles.map((profile, index) => ({ index, name: profile.name })),
    mappings: plan.mappings.map((mapping, index) => ({
      index,
      origin: mapping.origin,
      label: mapping.label,
      canonical: mapping.canonical,
      imported: true,
    })),
    settingsChanges,
    history: plan.history.length,
    warnings: plan.warnings,
  };
}

/**
 * Narrows a parsed import to what the user ticked. Indices and paths that do
 * not name something in the plan are ignored, so a forged selection can only
 * ever choose less.
 */
export function applyImportSelection(plan: ImportPlan, selection: ImportSelection): ImportPlan {
  const pick = <T>(items: T[], chosen: unknown): T[] => {
    const wanted = new Set(
      (Array.isArray(chosen) ? chosen : []).filter(
        (index): index is number => Number.isInteger(index) && index >= 0,
      ),
    );
    return items.filter((_, index) => wanted.has(index));
  };

  let settings: Record<string, Record<string, SettingValue>> | null = null;
  const paths: unknown[] = Array.isArray(selection.settings) ? selection.settings : [];
  for (const path of PORTABLE_PATHS) {
    if (!paths.includes(path)) continue;
    const value = readPath(plan.settings, path);
    if (value === undefined) continue;
    const [group, key] = path.split('.') as [string, string];
    settings ??= {};
    settings[group] = { ...settings[group], [key]: value };
  }

  return {
    profiles: pick(plan.profiles, selection.profiles),
    mappings: pick(plan.mappings, selection.mappings),
    settings: settings as DeepPartial<Settings> | null,
    history: selection.history === true ? plan.history : [],
    warnings: plan.warnings,
  };
}

/* -------------------------------------------------------------- encryption */

export const ENCRYPTED_EXPORT_FORMAT = 'fillwright-export-encrypted';
export const ENCRYPTED_EXPORT_VERSION = 1;

/**
 * A passphrase-sealed export. The header is readable so the importer knows to
 * ask for a passphrase; it is also bound into the AES-GCM tag as additional
 * data, so editing any of it makes the file refuse to open.
 */
export interface EncryptedExport {
  format: typeof ENCRYPTED_EXPORT_FORMAT;
  version: typeof ENCRYPTED_EXPORT_VERSION;
  exportedAt: string;
  kdf: KdfParams;
  blob: EncryptedBlob;
}

/** Upper bound on a key-derivation cost read from a file, so a crafted one cannot hang the page. */
const MAX_IMPORT_ITERATIONS = 10_000_000;

export function isEncryptedExport(value: unknown): boolean {
  return isPlainObject(value) && value.format === ENCRYPTED_EXPORT_FORMAT;
}

function headerOf(envelope: Omit<EncryptedExport, 'blob'>): string {
  const { format, version, exportedAt, kdf } = envelope;
  return JSON.stringify({
    format,
    version,
    exportedAt,
    kdf: { v: kdf.v, algorithm: kdf.algorithm, iterations: kdf.iterations, salt: kdf.salt },
  });
}

/** Seals an export with the vault's scheme: PBKDF2-SHA256 (600k) then AES-256-GCM. */
export async function encryptExport(
  file: unknown,
  passphrase: string,
  options: { iterations?: number } = {},
): Promise<EncryptedExport> {
  const kdf = newKdfParams();
  if (options.iterations) kdf.iterations = options.iterations;
  const header = {
    format: ENCRYPTED_EXPORT_FORMAT,
    version: ENCRYPTED_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    kdf,
  } as const;
  const key = await deriveKey(passphrase, kdf);
  return { ...header, blob: await encryptJson(key, file, headerOf(header)) };
}

/** Opens a sealed export. Throws a user-facing message on anything wrong. */
export async function decryptExport(input: unknown, passphrase: string): Promise<unknown> {
  const bad = new Error('This file is not a Fillwright export.');
  if (!isPlainObject(input) || input.format !== ENCRYPTED_EXPORT_FORMAT) throw bad;
  if (input.version !== ENCRYPTED_EXPORT_VERSION) {
    throw new Error(
      'This export was made by a newer version of Fillwright. Update Fillwright and try again.',
    );
  }
  const kdf = input.kdf;
  if (
    !isPlainObject(kdf) ||
    kdf.v !== 1 ||
    kdf.algorithm !== 'PBKDF2-SHA256' ||
    typeof kdf.iterations !== 'number' ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < 1 ||
    kdf.iterations > MAX_IMPORT_ITERATIONS ||
    typeof kdf.salt !== 'string' ||
    typeof input.exportedAt !== 'string' ||
    !isEncryptedBlob(input.blob)
  ) {
    throw bad;
  }
  const envelope = input as unknown as EncryptedExport;
  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, envelope.kdf);
  } catch {
    throw bad;
  }
  try {
    return await decryptJson<unknown>(key, envelope.blob, headerOf(envelope));
  } catch {
    // AES-GCM cannot tell a wrong passphrase from an edited file; say both.
    throw new Error('That passphrase does not open this file, or the file has been changed.');
  }
}

/* ---------------------------------------------------------------- profile */

const LIST_ITEMS: Record<string, () => object> = {
  education: emptyEducation,
  experience: emptyExperience,
  projects: emptyProject,
  skills: emptySkill,
  certifications: emptyCertification,
  achievements: emptyAchievement,
  languages: emptyLanguage,
  publications: emptyPublication,
  custom: emptyCustomField,
  'preferences.savedAnswers': emptySavedAnswer,
};

const TRI_STATE = new Set(['yes', 'no', 'unset']);
const SOURCES = new Set(['resume', 'user', 'inferred', 'default']);

export function conformProfile(raw: Record<string, unknown>): Profile {
  const template = createEmptyProfile();
  const profile = conform(raw, template, '', 0) as Profile;
  return {
    ...profile,
    id: newId('prof'),
    schemaVersion: template.schemaVersion,
    createdAt: now(),
    updatedAt: now(),
    // Resume files are not part of an export; references to them would dangle.
    resumeIds: [],
  };
}

/**
 * Shapes `value` to look exactly like `template`. The template decides which
 * keys exist and what type each has; `value` only ever supplies content.
 */
interface ConformOptions {
  /**
   * Keep list-entry ids that look like ids, and do not shorten list strings
   * below the text cap. Used for records Fillwright itself stored, where the
   * ids are references the editor relies on; imports always regenerate them.
   */
  keepIds?: boolean;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** True for a string that is safe to keep as a record or entry id. */
export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * Rebuilds a stored profile against the current template, keeping its ids,
 * dates and provenance. Missing keys come from the template, unknown keys go.
 */
export function hydrateProfile(raw: Record<string, unknown>): Profile {
  const template = createEmptyProfile();
  const shaped = conform(raw, template, '', 0, { keepIds: true }) as Profile;
  return {
    ...shaped,
    id: isSafeId(raw.id) ? raw.id : template.id,
    name: sanitizeString(raw.name, 120) || 'Untitled Profile',
    createdAt: shaped.createdAt || template.createdAt,
    updatedAt: shaped.updatedAt || template.updatedAt,
    schemaVersion: template.schemaVersion,
    resumeIds: shaped.resumeIds.filter(isSafeId),
  };
}

function conform(
  value: unknown,
  template: unknown,
  path: string,
  depth: number,
  options: ConformOptions = {},
): unknown {
  if (depth > 8) return template;

  if (typeof template === 'string') {
    if (typeof value !== 'string') return template;
    if (template === 'unset') return TRI_STATE.has(value) ? value : 'unset';
    if (path.endsWith('.source')) return SOURCES.has(value) ? value : template;
    return sanitizeString(value, MAX_TEXT);
  }
  if (typeof template === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : template;
  }
  if (typeof template === 'boolean') {
    return typeof value === 'boolean' ? value : template;
  }

  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return template;
    const factory = LIST_ITEMS[path];
    if (factory) {
      return value
        .slice(0, MAX_LIST)
        .filter(isPlainObject)
        .map((item) => {
          const blank = factory();
          const shaped = conform(item, blank, `${path}[]`, depth + 1, options) as { id: string };
          // Ids are regenerated so an import can never collide with stored data.
          const keep = options.keepIds && isSafeId(item.id);
          return { ...shaped, id: keep ? (item.id as string) : (blank as { id: string }).id };
        });
    }
    // Everything else modelled as a list is a list of strings.
    return value
      .slice(0, MAX_LIST)
      .filter((item): item is string => typeof item === 'string')
      .map((item) => sanitizeString(item, options.keepIds ? MAX_TEXT : 400));
  }

  if (isPlainObject(template)) {
    const source = isPlainObject(value) ? value : {};
    const keys = Object.keys(template);

    // An empty template object is a record, e.g. authorizedIn: { US: 'yes' }.
    if (keys.length === 0) {
      const out: Record<string, string> = {};
      for (const [key, item] of Object.entries(source).slice(0, 50)) {
        const safeKey = sanitizeString(key, 40);
        if (safeKey && typeof item === 'string' && TRI_STATE.has(item)) out[safeKey] = item;
      }
      return out;
    }

    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = conform(
        source[key],
        template[key],
        path ? `${path}.${key}` : key,
        depth + 1,
        options,
      );
    }
    // Provenance notes are optional, so the blank template does not carry one.
    if ('source' in template && 'confidence' in template && typeof source.note === 'string') {
      out.note = sanitizeString(source.note, 200);
    }
    return out;
  }

  return template;
}

/* --------------------------------------------------------------- settings */

function conformSettings(raw: Record<string, unknown>): DeepPartial<Settings> {
  const base = portableSettings(DEFAULT_SETTINGS);
  const shaped = conform(raw, base, 'settings', 0) as PortableSettings;
  shaped.autofill.confidenceThreshold = Math.max(
    0.5,
    Math.min(0.99, shaped.autofill.confidenceThreshold),
  );
  if (!AUTOFILL_MODES.includes(shaped.autofill.mode)) shaped.autofill.mode = 'manual';
  if (!['none', 'chrome-builtin'].includes(shaped.ai.provider)) shaped.ai.provider = 'none';
  if (!['system', 'light', 'dark'].includes(shaped.ui.theme)) shaped.ui.theme = 'system';
  if (![0, 5, 15, 30, 60].includes(shaped.privacy.autoLockMinutes))
    shaped.privacy.autoLockMinutes = 30;
  if (!isRetentionChoice(shaped.privacy.historyRetentionMonths))
    shaped.privacy.historyRetentionMonths = 0;
  // Keep only what the file states. A key it leaves out is not a request to
  // reset that setting to its default, and must not show up as a change.
  const stated: Record<string, Record<string, unknown>> = {};
  for (const [group, values] of Object.entries(shaped)) {
    const given = raw[group];
    if (!isPlainObject(given)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (!Object.prototype.hasOwnProperty.call(given, key)) continue;
      (stated[group] ??= {})[key] = value;
    }
  }
  return stated as DeepPartial<Settings>;
}

/**
 * Tracker fields from an import, each rebuilt on its own so one bad value
 * drops only itself. The profile link is not carried over: imported profiles
 * get new ids, so an old one would point at nothing.
 */
function importedTracker(
  raw: Record<string, unknown>,
): Partial<Pick<ApplicationHistoryEntry, 'status' | 'notes' | 'followUpOn' | 'postingUrl'>> {
  const out: Partial<
    Pick<ApplicationHistoryEntry, 'status' | 'notes' | 'followUpOn' | 'postingUrl'>
  > = {};
  for (const key of ['status', 'notes', 'followUpOn', 'postingUrl'] as const) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const clean = sanitizeTrackerPatch({ [key]: raw[key] });
    if (clean?.[key]) Object.assign(out, { [key]: clean[key] });
  }
  return out;
}
