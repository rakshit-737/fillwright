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
    if (current && typeof current === 'object' && !Array.isArray(current) && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = merge(current, value as DeepPartial<typeof current>);
    } else {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY] as Partial<Settings> | undefined;
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
