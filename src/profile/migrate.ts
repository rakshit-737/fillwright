import { hydrateProfile } from './portable';
import { isPlainObject } from '@/security/validate';
import { PROFILE_SCHEMA_VERSION, type Profile } from '@/types/profile';

/**
 * Profile schema migrations, run on every read.
 *
 * A stored record carries the `schemaVersion` it was written with. Each step
 * below upgrades a raw record from version N to N + 1; after the last step the
 * record is hydrated against the current template, so keys a newer release
 * added are present (with their empty defaults) instead of undefined, and ids,
 * dates and provenance are kept.
 *
 * Encrypted records go through this after they are decrypted, i.e. after the
 * vault is unlocked. Nothing is written back here: the next save stores the
 * migrated shape.
 *
 * To add a migration: bump PROFILE_SCHEMA_VERSION and add a step keyed by the
 * version it upgrades FROM. Steps take and return plain objects and must not
 * throw on missing keys.
 */
type Step = (raw: Record<string, unknown>) => Record<string, unknown>;

export const PROFILE_MIGRATIONS: Readonly<Record<number, Step>> = {
  // 1 → 2 goes here when version 2 exists.
};

export function migrateProfile(raw: unknown): Profile {
  let record: Record<string, unknown> = isPlainObject(raw) ? raw : {};
  const stored = record.schemaVersion;
  let version = typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 ? stored : 1;
  while (version < PROFILE_SCHEMA_VERSION) {
    const step = PROFILE_MIGRATIONS[version];
    if (step) record = step(record);
    version++;
  }
  return hydrateProfile(record);
}
