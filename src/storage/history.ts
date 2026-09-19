import { idb } from './idb';
import { newId, now } from '@/profile/factory';
import { getSettings } from './settings';
import { decryptJson, encryptJson, type EncryptedBlob } from '@/security/crypto';
import { VaultLockedError, getKey, isEnabled } from '@/security/vault';
import { applyTrackerPatch, expiredIds, mergeFill, type NewFill } from './history-model';
import type { ApplicationHistoryEntry, HistoryTrackerPatch } from '@/types/messages';

/**
 * Application history: where the user applied, plus the tracker fields they
 * add themselves. Field values are never recorded, and nothing is written
 * unless the user turned history on.
 *
 * Stored like profiles. With the vault on, a record is
 *
 *   { id, encrypted: true, appliedAt, blob }
 *
 * `id` is the key and `appliedAt` feeds the date index and retention, which
 * must work while locked. Company, role, site, status, notes and the posting
 * link are all inside the blob. While locked, reads throw VaultLockedError
 * rather than returning an empty list, and writes refuse — a fill logged
 * while locked is dropped, never written in plaintext.
 */

interface EncryptedHistoryRecord {
  id: string;
  encrypted: true;
  appliedAt: string;
  blob: EncryptedBlob;
}

type StoredHistory = ApplicationHistoryEntry | EncryptedHistoryRecord;

const isEncrypted = (record: StoredHistory): record is EncryptedHistoryRecord =>
  (record as EncryptedHistoryRecord).encrypted === true;

async function toStored(entry: ApplicationHistoryEntry): Promise<StoredHistory> {
  if (!(await isEnabled())) return entry;
  const key = await getKey();
  if (!key) throw new VaultLockedError();
  return seal(key, entry);
}

async function seal(
  key: CryptoKey,
  entry: ApplicationHistoryEntry,
): Promise<EncryptedHistoryRecord> {
  return {
    id: entry.id,
    encrypted: true,
    appliedAt: entry.appliedAt,
    blob: await encryptJson(key, entry),
  };
}

async function open(
  record: StoredHistory,
  key: CryptoKey | null,
): Promise<ApplicationHistoryEntry> {
  if (!isEncrypted(record)) return record;
  if (!key) throw new VaultLockedError();
  return decryptJson<ApplicationHistoryEntry>(key, record.blob);
}

/** Deletes what the retention setting and the hard cap no longer allow. Works while locked. */
export async function pruneHistory(): Promise<number> {
  const { privacy } = await getSettings();
  const records = await idb.getAll<StoredHistory>('history');
  const gone = expiredIds(records, privacy.historyRetentionMonths, new Date());
  for (const id of gone) await idb.delete('history', id);
  return gone.length;
}

export async function logApplication(fill: NewFill): Promise<ApplicationHistoryEntry | null> {
  const settings = await getSettings();
  if (!settings.privacy.keepApplicationHistory) return null;

  let entries: ApplicationHistoryEntry[];
  try {
    entries = await listHistory();
  } catch (cause) {
    // Locked: there is nowhere safe to write this, so it is not recorded.
    if (cause instanceof VaultLockedError) return null;
    throw cause;
  }

  // One entry per posting: further fills of the same application (the next
  // step, a retry) within a few hours add to it rather than listing it again.
  const record = mergeFill(entries, fill, Date.now()) ?? {
    ...fill,
    id: newId('app'),
    appliedAt: now(),
  };
  await idb.put('history', await toStored(record));
  return record;
}

/** Newest first. Throws VaultLockedError while locked. */
export async function listHistory(): Promise<ApplicationHistoryEntry[]> {
  await pruneHistory();
  const records = await idb.getAll<StoredHistory>('history');
  const enabled = await isEnabled();
  const key = enabled ? await getKey() : null;
  if (enabled && !key) throw new VaultLockedError();
  const entries: ApplicationHistoryEntry[] = [];
  for (const record of records) entries.push(await open(record, key));
  return entries.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

export async function updateHistoryEntry(
  id: string,
  patch: HistoryTrackerPatch,
): Promise<ApplicationHistoryEntry | null> {
  const record = await idb.get<StoredHistory>('history', id);
  if (!record) return null;
  const key = isEncrypted(record) ? await getKey() : null;
  const next = applyTrackerPatch(await open(record, key), patch);
  await idb.put('history', await toStored(next));
  return next;
}

/** Adds imported entries. Ids are new, so nothing already stored is replaced. */
export async function addHistoryEntries(entries: ApplicationHistoryEntry[]): Promise<number> {
  for (const entry of entries) await idb.put('history', await toStored(entry));
  await pruneHistory();
  return entries.length;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await idb.delete('history', id);
}

export function clearHistory(): Promise<void> {
  return idb.clear('history').then(() => undefined);
}

/**
 * Re-writes every history record under a new key (or none). Called alongside
 * the profile rewrite when encryption is switched on, off, or re-keyed.
 */
export async function rewriteHistory(
  from: CryptoKey | null,
  to: CryptoKey | null,
): Promise<number> {
  const records = await idb.getAll<StoredHistory>('history');
  for (const record of records) {
    const plain = await open(record, from);
    await idb.put('history', to ? await seal(to, plain) : plain);
  }
  return records.length;
}
