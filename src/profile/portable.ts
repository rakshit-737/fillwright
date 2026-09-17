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
import { DEFAULT_SETTINGS, AUTOFILL_MODES, type Settings } from '@/types/settings';
import type { ApplicationHistoryEntry, DeepPartial } from '@/types/messages';
import type { CanonicalField, SavedMapping } from '@/types/fields';
import type { Profile } from '@/types/profile';

/**
 * Export / import.
 *
 * The export is a plain JSON file the user saves themselves; nothing is
 * uploaded. The import is the more dangerous direction — the file could have
 * been edited, truncated, or crafted — so it is never trusted as-is. Every
 * profile is rebuilt against the current schema: unknown keys are dropped,
 * every string is capped, every list is bounded, and every enum is checked.
 * Imported profiles always get fresh ids, so an import can add to what is
 * stored but can never silently replace it.
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
  privacy: Pick<Settings['privacy'], 'keepApplicationHistory' | 'autoLockMinutes'>;
};

export function portableSettings(settings: Settings): PortableSettings {
  return {
    autofill: settings.autofill,
    ui: settings.ui,
    ai: settings.ai,
    privacy: {
      keepApplicationHistory: settings.privacy.keepApplicationHistory,
      autoLockMinutes: settings.privacy.autoLockMinutes,
    },
  };
}

export interface ImportPlan {
  profiles: Profile[];
  mappings: Array<Omit<SavedMapping, 'id' | 'createdAt' | 'useCount'>>;
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
  // Version 1 exports predate the format marker; accept them if they look right.
  if (input.format !== undefined && input.format !== EXPORT_FORMAT) {
    throw new Error('This file is not a Fillwright export.');
  }
  if (typeof input.version === 'number' && input.version > EXPORT_VERSION) {
    throw new Error('This export was made by a newer version of Fillwright. Update Fillwright and try again.');
  }
  if (!Array.isArray(input.profiles)) throw new Error('This export contains no profiles.');

  const warnings: string[] = [];
  const names = new Set(existingNames.map((name) => name.toLowerCase()));

  const rawProfiles = input.profiles.slice(0, MAX_PROFILES);
  if (input.profiles.length > MAX_PROFILES) warnings.push(`Only the first ${MAX_PROFILES} profiles were imported.`);

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
function conform(value: unknown, template: unknown, path: string, depth: number): unknown {
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
          const shaped = conform(item, blank, `${path}[]`, depth + 1) as { id: string };
          // Ids are regenerated so an import can never collide with stored data.
          return { ...shaped, id: (blank as { id: string }).id };
        });
    }
    // Everything else modelled as a list is a list of strings.
    return value
      .slice(0, MAX_LIST)
      .filter((item): item is string => typeof item === 'string')
      .map((item) => sanitizeString(item, 400));
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
      out[key] = conform(source[key], template[key], path ? `${path}.${key}` : key, depth + 1);
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
  shaped.autofill.confidenceThreshold = Math.max(0.5, Math.min(0.99, shaped.autofill.confidenceThreshold));
  if (!AUTOFILL_MODES.includes(shaped.autofill.mode)) shaped.autofill.mode = 'manual';
  if (!['none', 'chrome-builtin'].includes(shaped.ai.provider)) shaped.ai.provider = 'none';
  if (!['system', 'light', 'dark'].includes(shaped.ui.theme)) shaped.ui.theme = 'system';
  if (![0, 5, 15, 30, 60].includes(shaped.privacy.autoLockMinutes)) shaped.privacy.autoLockMinutes = 30;
  return shaped;
}
