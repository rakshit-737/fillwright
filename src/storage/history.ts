import { idb } from './idb';
import { newId, now } from '@/profile/factory';
import { getSettings } from './settings';
import type { ApplicationHistoryEntry } from '@/types/messages';

/**
 * History is metadata only — company, role, origin, date, and how many fields
 * were filled. Field values are never recorded, and nothing is written unless
 * the user turned history on.
 */
const SAME_APPLICATION_MS = 6 * 60 * 60 * 1000;

export async function logApplication(
  entry: Omit<ApplicationHistoryEntry, 'id' | 'appliedAt'>,
): Promise<ApplicationHistoryEntry | null> {
  const settings = await getSettings();
  if (!settings.privacy.keepApplicationHistory) return null;

  // One entry per posting: further fills of the same application (the next
  // step, a retry) within a few hours add to it rather than listing it again.
  const recent = (await listHistory()).find(
    (item) =>
      item.origin === entry.origin &&
      item.role === entry.role &&
      item.company === entry.company &&
      Date.now() - Date.parse(item.appliedAt) < SAME_APPLICATION_MS,
  );
  if (recent) {
    const merged: ApplicationHistoryEntry = {
      ...recent,
      fieldsFilled: Math.min(500, recent.fieldsFilled + entry.fieldsFilled),
      ...(entry.profileId ? { profileId: entry.profileId } : {}),
    };
    await idb.put('history', merged);
    return merged;
  }

  const record: ApplicationHistoryEntry = { ...entry, id: newId('app'), appliedAt: now() };
  await idb.put('history', record);
  return record;
}

export async function listHistory(): Promise<ApplicationHistoryEntry[]> {
  const entries = await idb.getAll<ApplicationHistoryEntry>('history');
  return entries.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

export function clearHistory(): Promise<void> {
  return idb.clear('history').then(() => undefined);
}
