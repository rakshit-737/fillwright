import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from '@/types/settings';
import type { DeepPartial } from '@/types/messages';

const KEY = 'settings';

/** Recursively merges a patch over a base, ignoring undefined leaves. */
function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out = { ...base } as T;
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key as keyof DeepPartial<T>];
    if (value === undefined) continue;
    const current = base[key];
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = merge(current, value as DeepPartial<typeof current>);
    } else {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

/**
 * Upgrades settings written by older versions.
 *
 * v1 (Fillwright 0.3) had `autofill.autoDetectOnKnownSites`, which was never
 * wired to anything. It is replaced by `autofill.mode`: a stored `true` becomes
 * Assist only if the user has already granted site access (otherwise Assist
 * could not run, and the setting would claim something false), and Manual in
 * every other case. The old key is dropped.
 */
export async function migrateSettings(raw: Record<string, unknown>): Promise<boolean> {
  const autofill = raw.autofill as Record<string, unknown> | undefined;
  if (!autofill || !('autoDetectOnKnownSites' in autofill)) return false;
  const wanted = autofill.autoDetectOnKnownSites === true;
  delete autofill.autoDetectOnKnownSites;
  if (autofill.mode === undefined) {
    let access = false;
    if (wanted) {
      try {
        access = await chrome.permissions.contains({ origins: ['https://*/*'] });
      } catch {
        access = false;
      }
    }
    autofill.mode = wanted && access ? 'assist' : 'manual';
  }
  return true;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY] as Partial<Settings> | undefined;
  if (raw && (await migrateSettings(raw as Record<string, unknown>))) {
    await chrome.storage.local.set({ [KEY]: { ...raw, version: SETTINGS_VERSION } });
  }
  // Merge over defaults so a new release picks up new keys without a migration.
  const settings = merge(DEFAULT_SETTINGS, raw as DeepPartial<Settings>);
  settings.version = SETTINGS_VERSION;
  return settings;
}

export async function setSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const next = merge(await getSettings(), patch);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function replaceSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

export const __test__ = { merge };
