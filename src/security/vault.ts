import { idb, writeAtomic, type WriteOp } from '@/storage/idb';
import {
  decryptJson,
  deriveKey,
  encryptJson,
  exportKey,
  importKey,
  newKdfParams,
  type EncryptedBlob,
  type KdfParams,
} from './crypto';

/**
 * The local vault.
 *
 * When encryption is on, profile records and stored resume files are written to
 * IndexedDB as AES-GCM ciphertext. The key exists only while the vault is
 * unlocked.
 *
 * ## Where the key lives, and why
 *
 * MV3 service workers are torn down after a few seconds of inactivity, so a key
 * held in a module variable would vanish constantly and the user would be asked
 * for their passphrase every few minutes. The key is therefore kept in
 * `chrome.storage.session`, which is **memory-only** — never written to disk,
 * cleared when the browser closes, and unreadable by web pages or other
 * extensions.
 *
 * That is a deliberate trade: convenience across worker restarts, at the cost
 * of the key being resident in browser memory while unlocked. SECURITY.md says
 * so plainly rather than implying the key is somehow safer than it is.
 *
 * ## What locking does
 *
 * Locking removes the key from session storage. Decrypted values already handed
 * to an open options page stay in that page's memory until it is closed or
 * reloaded — JavaScript cannot guarantee erasure of a string, and claiming
 * otherwise would be false.
 */

const META_KEY = 'vault';
const SESSION_KEY = 'fw_vault_key';
const SESSION_TOUCHED = 'fw_vault_touched';

/** The known plaintext used to check a passphrase without storing its hash. */
const VERIFIER_TEXT = 'fillwright-vault-v1';

export interface VaultMeta {
  key: typeof META_KEY;
  enabled: boolean;
  kdf: KdfParams;
  /** Encrypting a known string: decrypting it proves the passphrase is right. */
  verifier: EncryptedBlob;
  createdAt: string;
  updatedAt: string;
}

export type VaultStatus =
  { state: 'off' } | { state: 'locked' } | { state: 'unlocked'; autoLockMinutes: number };

export class VaultLockedError extends Error {
  readonly code = 'ELOCKED';
  constructor() {
    super('Fillwright is locked. Enter your passphrase to continue.');
    this.name = 'VaultLockedError';
  }
}

/* ------------------------------------------------------------------ state */

export async function getMeta(): Promise<VaultMeta | undefined> {
  return idb.get<VaultMeta>('meta', META_KEY);
}

export async function isEnabled(): Promise<boolean> {
  return (await getMeta())?.enabled === true;
}

/**
 * Whether the vault is currently usable.
 *
 * Also applies the inactivity timeout: rather than relying on a background
 * timer (which an evicted worker would not run), the elapsed time is checked on
 * every access. The effect is the same and there is no extra permission.
 */
export async function isUnlocked(autoLockMinutes: number): Promise<boolean> {
  if (!(await isEnabled())) return true;

  const session = await chrome.storage.session.get([SESSION_KEY, SESSION_TOUCHED]);
  if (!session[SESSION_KEY]) return false;

  if (autoLockMinutes > 0) {
    const touched = Number(session[SESSION_TOUCHED] ?? 0);
    if (Date.now() - touched > autoLockMinutes * 60_000) {
      await lock();
      return false;
    }
  }
  return true;
}

export async function status(autoLockMinutes: number): Promise<VaultStatus> {
  if (!(await isEnabled())) return { state: 'off' };
  return (await isUnlocked(autoLockMinutes))
    ? { state: 'unlocked', autoLockMinutes }
    : { state: 'locked' };
}

/**
 * Returns the key, or null when the vault is off or locked.
 *
 * Callers that hold data treat null-with-encryption-enabled as a hard stop, not
 * as "store it in the clear".
 */
export async function getKey(autoLockMinutes = 0): Promise<CryptoKey | null> {
  if (!(await isEnabled())) return null;
  if (!(await isUnlocked(autoLockMinutes))) return null;

  const session = await chrome.storage.session.get(SESSION_KEY);
  const jwk = session[SESSION_KEY] as JsonWebKey | undefined;
  if (!jwk) return null;

  await touch();
  return importKey(jwk);
}

/** Resets the inactivity clock. Called on every successful vault access. */
export async function touch(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_TOUCHED]: Date.now() });
}

/* ------------------------------------------------------------- lifecycle */

export interface EnableResult {
  ok: boolean;
  error?: string;
  /** A stable code when the failure has its own recovery, e.g. EQUOTA. */
  code?: string;
}

/**
 * Every record re-written under the new key (or none), computed but not yet
 * stored. `bytes` is a rough size, used for the free-space check.
 */
export interface Rewrite {
  ops: WriteOp[];
  bytes: number;
}

const NO_ROOM: EnableResult = {
  ok: false,
  code: 'EQUOTA',
  error:
    'There is not enough free storage to re-write your data, so nothing was changed. Free some disk space or remove resumes you no longer need, then try again.',
};

/**
 * Writes the re-written records and the vault's meta change in ONE
 * transaction, so the database is either entirely in the old state or
 * entirely in the new one. A salt is never lost while ciphertext under it
 * exists, and an interrupted switch leaves the old passphrase (or none) working.
 */
async function commit(rewrite: Rewrite, metaOp: WriteOp): Promise<EnableResult | null> {
  if (!(await hasRoomFor(rewrite.bytes))) return NO_ROOM;
  try {
    await writeAtomic([...rewrite.ops, metaOp]);
  } catch (cause) {
    const name = (cause as { name?: string } | null)?.name;
    if (name === 'QuotaExceededError') return NO_ROOM;
    throw cause;
  }
  return null;
}

/**
 * Checks the browser's own estimate before starting a large write. When the
 * estimate is unavailable the write goes ahead: it is atomic, so running out
 * part-way still changes nothing.
 */
async function hasRoomFor(bytes: number): Promise<boolean> {
  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined);
  if (!estimate?.quota) return true;
  return estimate.quota - (estimate.usage ?? 0) >= bytes;
}

/**
 * Turns encryption on and re-writes existing records as ciphertext.
 *
 * The caller supplies the re-encryption step so this module does not need to
 * know about profile shapes — it owns the key, not the data. That step only
 * computes; this function does all the writing, in one transaction.
 */
export async function enable(
  passphrase: string,
  prepare: (key: CryptoKey) => Promise<Rewrite>,
): Promise<EnableResult> {
  if (await isEnabled()) return { ok: false, error: 'Encryption is already on.' };
  if (passphrase.length < 8) {
    return { ok: false, error: 'Use a passphrase of at least 8 characters.' };
  }

  const kdf = newKdfParams();
  const key = await deriveKey(passphrase, kdf);

  // Encrypt everything in memory first. Nothing has been written yet, so if
  // this throws the vault simply stays off.
  const rewrite = await prepare(key);

  const meta: VaultMeta = {
    key: META_KEY,
    enabled: true,
    kdf,
    verifier: await encryptJson(key, VERIFIER_TEXT),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const failed = await commit(rewrite, { store: 'meta', op: 'put', value: meta });
  if (failed) return failed;
  await storeSessionKey(key);

  return { ok: true };
}

export async function unlock(passphrase: string): Promise<EnableResult> {
  const meta = await getMeta();
  if (!meta?.enabled) return { ok: false, error: 'Encryption is not switched on.' };

  const key = await deriveKey(passphrase, meta.kdf);
  try {
    const verified = await decryptJson<string>(key, meta.verifier);
    if (verified !== VERIFIER_TEXT) throw new Error('verifier mismatch');
  } catch {
    // AES-GCM authentication failed, which means the wrong passphrase. The
    // message says so without hinting at how close the attempt was.
    return { ok: false, error: 'That passphrase does not match.' };
  }

  await storeSessionKey(key);
  return { ok: true };
}

export async function lock(): Promise<void> {
  await chrome.storage.session.remove([SESSION_KEY, SESSION_TOUCHED]);
}

export async function changePassphrase(
  current: string,
  next: string,
  prepare: (from: CryptoKey, to: CryptoKey) => Promise<Rewrite>,
): Promise<EnableResult> {
  const meta = await getMeta();
  if (!meta?.enabled) return { ok: false, error: 'Encryption is not switched on.' };
  if (next.length < 8) return { ok: false, error: 'Use a passphrase of at least 8 characters.' };

  const unlocked = await unlock(current);
  if (!unlocked.ok) return unlocked;

  const oldKey = await deriveKey(current, meta.kdf);
  // A new salt as well as a new key: reusing the salt would let someone who
  // captured the old database test both passphrases against one derivation.
  const kdf = newKdfParams();
  const newKey = await deriveKey(next, kdf);

  const rewrite = await prepare(oldKey, newKey);

  const nextMeta: VaultMeta = {
    ...meta,
    kdf,
    verifier: await encryptJson(newKey, VERIFIER_TEXT),
    updatedAt: new Date().toISOString(),
  };
  // The new salt and every record under the new key land together, or not at
  // all — in which case the current passphrase still opens everything.
  const failed = await commit(rewrite, { store: 'meta', op: 'put', value: nextMeta });
  if (failed) return failed;
  await storeSessionKey(newKey);

  return { ok: true };
}

/** Turns encryption off, writing records back in the clear. */
export async function disable(
  passphrase: string,
  prepare: (key: CryptoKey) => Promise<Rewrite>,
): Promise<EnableResult> {
  const meta = await getMeta();
  if (!meta?.enabled) return { ok: false, error: 'Encryption is not switched on.' };

  const unlocked = await unlock(passphrase);
  if (!unlocked.ok) return unlocked;

  const key = await deriveKey(passphrase, meta.kdf);
  const rewrite = await prepare(key);

  // The plaintext records and the removal of the meta record share one
  // transaction: an interrupted switch-off leaves the vault on and intact.
  const failed = await commit(rewrite, { store: 'meta', op: 'delete', key: META_KEY });
  if (failed) return failed;
  await lock();
  return { ok: true };
}

async function storeSessionKey(key: CryptoKey): Promise<void> {
  await chrome.storage.session.set({
    [SESSION_KEY]: await exportKey(key),
    [SESSION_TOUCHED]: Date.now(),
  });
}
