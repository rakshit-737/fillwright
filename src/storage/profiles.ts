import { idb } from './idb';
import { createEmptyProfile, newId, now } from '@/profile/factory';
import { migrateProfile } from '@/profile/migrate';
import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  isEncryptedBlob,
  type EncryptedBlob,
} from '@/security/crypto';
import { VaultLockedError, getKey, isEnabled } from '@/security/vault';
import type { Profile, ResumeAttachment } from '@/types/profile';

export interface ProfileSummary {
  id: string;
  name: string;
  updatedAt: string;
  hasResume: boolean;
}

/**
 * Profile storage, with encryption at rest when the vault is on.
 *
 * A stored record is one of two shapes:
 *
 *   plain:     { id, name, personal: {...}, ... }
 *   encrypted: { id, encrypted: true, blob: { v, iv, ct } }
 *
 * The id stays in the clear because IndexedDB needs it as a key, and the
 * summary fields needed to list profiles without unlocking (`name`,
 * `updatedAt`) are kept alongside. Everything else — every value that came off
 * a resume — is inside the blob.
 *
 * When the vault is enabled but locked, reads throw `VaultLockedError` rather
 * than returning partial data, and writes refuse outright. There is no path
 * that silently writes plaintext while encryption is on.
 */

interface EncryptedProfileRecord {
  id: string;
  encrypted: true;
  /** Kept outside the blob so the profile list works while locked. */
  name: string;
  updatedAt: string;
  hasResume: boolean;
  blob: EncryptedBlob;
}

interface EncryptedResumeRecord {
  id: string;
  encrypted: true;
  fileName: string;
  sizeBytes: number;
  importedAt: string;
  mimeType: string;
  data: EncryptedBlob;
  text: EncryptedBlob;
}

type StoredProfile = Profile | EncryptedProfileRecord;
type StoredResume = ResumeAttachment | EncryptedResumeRecord;

const isEncryptedProfile = (record: StoredProfile): record is EncryptedProfileRecord =>
  (record as EncryptedProfileRecord).encrypted === true;

const isEncryptedResume = (record: StoredResume): record is EncryptedResumeRecord =>
  (record as EncryptedResumeRecord).encrypted === true;

/* ------------------------------------------------------------------ reads */

/**
 * Lists profiles.
 *
 * Works while locked: the fields shown here are stored outside the encrypted
 * blob precisely so the popup can say "locked — unlock to use Aditi's profile"
 * instead of showing an empty list that looks like data loss.
 */
export async function listProfiles(): Promise<ProfileSummary[]> {
  const records = await idb.getAll<StoredProfile>('profiles');
  return records
    .map((record) =>
      isEncryptedProfile(record)
        ? {
            id: record.id,
            name: record.name,
            updatedAt: record.updatedAt,
            hasResume: record.hasResume,
          }
        : {
            id: record.id,
            name: record.name,
            updatedAt: record.updatedAt,
            hasResume: record.resumeIds.length > 0,
          },
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  const record = await idb.get<StoredProfile>('profiles', id);
  if (!record) return undefined;
  // Older records are upgraded on read; encrypted ones only once unlocked.
  if (!isEncryptedProfile(record)) return migrateProfile(record);

  const key = await getKey();
  if (!key) throw new VaultLockedError();
  return migrateProfile(await decryptJson<Profile>(key, record.blob));
}

export async function getResume(id: string): Promise<ResumeAttachment | undefined> {
  const record = await idb.get<StoredResume>('resumes', id);
  if (!record) return undefined;
  if (!isEncryptedResume(record)) return record;

  const key = await getKey();
  if (!key) throw new VaultLockedError();

  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    importedAt: record.importedAt,
    data: await decryptBytes(key, record.data),
    text: await decryptJson<string>(key, record.text),
  };
}

/* ----------------------------------------------------------------- writes */

export async function saveProfile(profile: Profile): Promise<Profile> {
  const next: Profile = { ...profile, updatedAt: now() };
  await idb.put('profiles', await toStoredProfile(next));
  return next;
}

export async function saveResume(attachment: ResumeAttachment): Promise<void> {
  await idb.put('resumes', await toStoredResume(attachment));
}

async function toStoredProfile(profile: Profile): Promise<StoredProfile> {
  if (!(await isEnabled())) return profile;

  const key = await getKey();
  // Encryption is on but the vault is locked: refusing is the only safe
  // option. Writing plaintext "just this once" would quietly defeat the whole
  // feature, and the user would never know.
  if (!key) throw new VaultLockedError();

  return {
    id: profile.id,
    encrypted: true,
    name: profile.name,
    updatedAt: profile.updatedAt,
    hasResume: profile.resumeIds.length > 0,
    blob: await encryptJson(key, profile),
  };
}

async function toStoredResume(attachment: ResumeAttachment): Promise<StoredResume> {
  if (!(await isEnabled())) return attachment;

  const key = await getKey();
  if (!key) throw new VaultLockedError();

  return {
    id: attachment.id,
    encrypted: true,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    importedAt: attachment.importedAt,
    data: await encryptBytes(key, attachment.data),
    text: await encryptJson(key, attachment.text),
  };
}

/* ------------------------------------------------------------- management */

export async function createProfile(name: string, cloneFromId?: string): Promise<Profile> {
  if (cloneFromId) {
    const source = await getProfile(cloneFromId);
    if (source) {
      // Clone the content but not the resume attachments: those belong to the
      // profile they were imported into, and duplicating blobs wastes quota.
      const clone: Profile = {
        ...structuredClone(source),
        id: newId('prof'),
        name,
        createdAt: now(),
        updatedAt: now(),
        resumeIds: [],
      };
      await idb.put('profiles', await toStoredProfile(clone));
      return clone;
    }
  }
  const profile = createEmptyProfile(name);
  await idb.put('profiles', await toStoredProfile(profile));
  return profile;
}

export async function deleteProfile(id: string): Promise<void> {
  // Read the raw record: deleting must work even while locked, and the resume
  // ids needed for cleanup are recoverable from the resumes store itself.
  const record = await idb.get<StoredProfile>('profiles', id);
  if (record && !isEncryptedProfile(record)) {
    for (const resumeId of record.resumeIds) await idb.delete('resumes', resumeId);
  } else if (record) {
    try {
      const profile = await getProfile(id);
      for (const resumeId of profile?.resumeIds ?? []) await idb.delete('resumes', resumeId);
    } catch {
      // Locked: the profile record goes, and any orphaned resume blobs are
      // removed by `pruneOrphanResumes` on the next unlocked run.
    }
  }
  await idb.delete('profiles', id);
}

export async function deleteResume(id: string): Promise<void> {
  await idb.delete('resumes', id);
}

export async function countProfiles(): Promise<number> {
  return idb.count('profiles');
}

/**
 * Removes resume blobs no profile references any more.
 *
 * Deleting a profile while the vault is locked cannot read its resume ids, so
 * those blobs are cleaned up here instead of being left behind forever.
 */
export async function pruneOrphanResumes(): Promise<number> {
  const profiles = await idb.getAll<StoredProfile>('profiles');
  const referenced = new Set<string>();

  for (const record of profiles) {
    if (isEncryptedProfile(record)) {
      try {
        const profile = await getProfile(record.id);
        for (const id of profile?.resumeIds ?? []) referenced.add(id);
      } catch {
        // Locked — cannot know what this profile references, so nothing is
        // pruned on its behalf. Deleting would risk destroying live data.
        return 0;
      }
    } else {
      for (const id of record.resumeIds) referenced.add(id);
    }
  }

  const resumes = await idb.getAll<StoredResume>('resumes');
  let removed = 0;
  for (const resume of resumes) {
    if (!referenced.has(resume.id)) {
      await idb.delete('resumes', resume.id);
      removed++;
    }
  }
  return removed;
}

/* ------------------------------------------------- vault re-encryption */

/**
 * Re-writes every profile and resume under a new key (or no key).
 *
 * Used when encryption is switched on, off, or the passphrase changes. Reads
 * use `from` explicitly rather than the session key, because during a
 * passphrase change the session still holds the old one.
 */
export async function rewriteAll(
  from: CryptoKey | null,
  to: CryptoKey | null,
): Promise<{ profiles: number; resumes: number }> {
  const profileRecords = await idb.getAll<StoredProfile>('profiles');
  let profiles = 0;

  for (const record of profileRecords) {
    const plain: Profile = isEncryptedProfile(record)
      ? await decryptJson<Profile>(requireKey(from), record.blob)
      : record;

    await idb.put(
      'profiles',
      to
        ? ({
            id: plain.id,
            encrypted: true,
            name: plain.name,
            updatedAt: plain.updatedAt,
            hasResume: plain.resumeIds.length > 0,
            blob: await encryptJson(to, plain),
          } satisfies EncryptedProfileRecord)
        : plain,
    );
    profiles++;
  }

  const resumeRecords = await idb.getAll<StoredResume>('resumes');
  let resumes = 0;

  for (const record of resumeRecords) {
    const plain: ResumeAttachment = isEncryptedResume(record)
      ? {
          id: record.id,
          fileName: record.fileName,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          importedAt: record.importedAt,
          data: await decryptBytes(requireKey(from), record.data),
          text: await decryptJson<string>(requireKey(from), record.text),
        }
      : record;

    await idb.put(
      'resumes',
      to
        ? ({
            id: plain.id,
            encrypted: true,
            fileName: plain.fileName,
            mimeType: plain.mimeType,
            sizeBytes: plain.sizeBytes,
            importedAt: plain.importedAt,
            data: await encryptBytes(to, plain.data),
            text: await encryptJson(to, plain.text),
          } satisfies EncryptedResumeRecord)
        : plain,
    );
    resumes++;
  }

  return { profiles, resumes };
}

function requireKey(key: CryptoKey | null): CryptoKey {
  if (!key) throw new VaultLockedError();
  return key;
}

export { isEncryptedBlob };
