import { handle, ok, err } from '../router';
import { destroyDb, idb } from '@/storage/idb';
import {
  addHistoryEntries,
  clearHistory,
  deleteHistoryEntry,
  listHistory,
  updateHistoryEntry,
} from '@/storage/history';
import { sanitizeTrackerPatch } from '@/storage/history-model';
import {
  clearMappings,
  deleteMapping,
  listMappings,
  saveMapping,
  updateMapping,
} from '@/storage/mappings';
import { clearSettings, getSettings, setSettings } from '@/storage/settings';
import { listProfiles, getProfile, saveProfile } from '@/storage/profiles';
import { originFromUrl, sanitizeString } from '@/security/validate';
import { FIELD_CATALOG } from '@/field-detection/catalog';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  parseImport,
  portableSettings,
  type ExportFile,
} from '@/profile/portable';
import { syncAutoDetect } from '../auto-detect';
import type { CanonicalField } from '@/types/fields';
import type { UiRequest } from '@/types/messages';
import type { Profile } from '@/types/profile';

export function registerPrivacyHandlers(): void {
  handle('ui:list-history', async () => ok(await listHistory()));
  handle('ui:clear-history', async () => {
    await clearHistory();
    return ok({ cleared: true });
  });

  /** Tracker fields only; company, role, site and date are not editable here. */
  handle('ui:update-history', async (request) => {
    const { id, patch } = request as Extract<UiRequest, { type: 'ui:update-history' }>;
    const clean = sanitizeTrackerPatch(patch);
    if (!clean) return err('That change is not valid.', 'EBADPATCH');
    const updated = await updateHistoryEntry(sanitizeString(id, 64), clean);
    return updated ? ok(updated) : err('Entry not found', 'ENOTFOUND');
  });

  handle('ui:delete-history-entry', async (request) => {
    const { id } = request as Extract<UiRequest, { type: 'ui:delete-history-entry' }>;
    await deleteHistoryEntry(sanitizeString(id, 64));
    return ok({ deleted: true });
  });

  handle('ui:list-saved-mappings', async (request) => {
    const { origin } = request as Extract<UiRequest, { type: 'ui:list-saved-mappings' }>;
    return ok(await listMappings(origin ? sanitizeString(origin, 2048) : undefined));
  });

  handle('ui:delete-saved-mapping', async (request) => {
    const { id } = request as Extract<UiRequest, { type: 'ui:delete-saved-mapping' }>;
    await deleteMapping(sanitizeString(id, 64));
    return ok({ deleted: id });
  });

  handle('ui:update-saved-mapping', async (request) => {
    const { id, canonical, disabled } = request as Extract<
      UiRequest,
      { type: 'ui:update-saved-mapping' }
    >;
    const patch: { canonical?: CanonicalField; disabled?: boolean } = {};
    if (canonical !== undefined) {
      if (!FIELD_CATALOG.some((entry) => entry.field === canonical))
        return err('Unknown field', 'EBADFIELD');
      patch.canonical = canonical;
    }
    if (typeof disabled === 'boolean') patch.disabled = disabled;
    const updated = await updateMapping(sanitizeString(id, 64), patch);
    return updated ? ok(updated) : err('Mapping not found', 'ENOTFOUND');
  });

  handle('ui:clear-saved-mappings', async (request) => {
    const { origin } = request as Extract<UiRequest, { type: 'ui:clear-saved-mappings' }>;
    const scoped = origin ? originFromUrl(origin) : undefined;
    if (origin && !scoped) return err('Unknown website', 'EBADORIGIN');
    return ok({ cleared: await clearMappings(scoped) });
  });

  /** Irreversible: drops the database and every stored setting. */
  handle('ui:erase-all-data', async () => {
    await destroyDb();
    await clearSettings();
    await chrome.storage.local.clear();
    // Settings are back to defaults (Manual), so this unregisters any
    // Assist/Smart content script as well.
    await syncAutoDetect().catch(() => undefined);
    return ok({ erased: true });
  });

  /**
   * Produces a JSON snapshot the user saves locally. Resume bytes are omitted —
   * they are large, and the user already has the original file. History is
   * included only when the user ticks it.
   */
  handle('ui:export-data', async (request) => {
    const { includeHistory } = request as Extract<UiRequest, { type: 'ui:export-data' }>;
    const summaries = await listProfiles();
    const profiles: Profile[] = [];
    for (const summary of summaries) {
      const profile = await getProfile(summary.id);
      if (profile) profiles.push(profile);
    }
    const file: ExportFile = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profiles,
      mappings: await listMappings(),
      settings: portableSettings(await getSettings()),
      ...(includeHistory ? { history: await listHistory() } : {}),
    };
    return ok({ ...file, resumeCount: await idb.count('resumes') });
  });

  /**
   * Adds the contents of an export. Nothing already stored is replaced:
   * profiles arrive with new ids, and mappings merge by fingerprint.
   */
  handle('ui:import-data', async (request) => {
    const { payload } = request as Extract<UiRequest, { type: 'ui:import-data' }>;
    const existing = await listProfiles();
    let plan;
    try {
      plan = parseImport(
        payload,
        existing.map((profile) => profile.name),
      );
    } catch (cause) {
      return err(
        cause instanceof Error ? cause.message : 'This file could not be read.',
        'EBADIMPORT',
      );
    }

    // Written one by one: if the vault is locked, the first write throws and
    // the user is asked to unlock, rather than half the import landing.
    for (const profile of plan.profiles) await saveProfile(profile);
    for (const mapping of plan.mappings) await saveMapping(mapping);

    const settings = await getSettings();
    if (plan.settings) await setSettings(plan.settings);
    if (!settings.activeProfileId && plan.profiles[0]) {
      await setSettings({ activeProfileId: plan.profiles[0].id });
    }
    let historyCount = 0;
    if (plan.history.length && (await getSettings()).privacy.keepApplicationHistory) {
      // Through the store, so imported entries are encrypted when the vault is on.
      historyCount = await addHistoryEntries(plan.history);
    }
    await syncAutoDetect().catch(() => undefined);

    return ok({
      profiles: plan.profiles.length,
      mappings: plan.mappings.length,
      settings: plan.settings !== null,
      history: historyCount,
      warnings: plan.warnings,
    });
  });
}
