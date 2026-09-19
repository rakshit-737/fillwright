import { handle, ok, err } from '../router';
import { getSettings } from '@/storage/settings';
import {
  countUndecryptable,
  hasEncryptedRecords,
  prepareRewrite,
  pruneOrphanResumes,
} from '@/storage/profiles';
import { prepareHistoryRewrite } from '@/storage/history';
import type { PreparedRewrite } from '@/storage/profiles';

/** Profiles, resumes and history, re-keyed together for one atomic write. */
async function prepareAll(from: CryptoKey | null, to: CryptoKey | null): Promise<PreparedRewrite> {
  const rewrite = await prepareRewrite(from, to);
  const history = await prepareHistoryRewrite(from, to);
  return {
    ...rewrite,
    ops: [...rewrite.ops, ...history.ops],
    bytes: rewrite.bytes + history.bytes,
  };
}
import { deriveKey } from '@/security/crypto';
import {
  changePassphrase,
  disable,
  enable,
  getKey,
  getMeta,
  lock,
  status,
  unlock,
} from '@/security/vault';
import type { ContentRequest, UiRequest } from '@/types/messages';
import { openPagePath } from '../open-page';

/**
 * Vault handlers.
 *
 * The passphrase crosses from the options page to the service worker and is
 * used to derive a key, then discarded — it is never stored, never logged, and
 * never written to disk in any form. Only the derived key is retained, in
 * memory-only session storage, and only while unlocked.
 */
export function registerVaultHandlers(): void {
  /** Opens the unlock screen. Invoked from the on-page panel when locked. */
  handle('ui:open-security', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#/security') });
    return ok({ opened: true });
  });

  /**
   * The panel's "Import a resume" / "Open Privacy Center" actions. Only a fixed
   * list of routes can be opened, so a page cannot steer the user anywhere else.
   */
  handle('content:open-page', async (request) => {
    const { route, field } = request as Extract<ContentRequest, { type: 'content:open-page' }>;
    const path = openPagePath(route, field);
    if (!path) return err('Unknown page', 'EBADROUTE');
    await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    return ok({ opened: true });
  });

  handle('content:vault-state', async () => {
    const settings = await getSettings();
    const current = await status(settings.privacy.autoLockMinutes);
    return ok({ locked: current.state === 'locked' });
  });

  handle('ui:vault-status', async () => {
    const settings = await getSettings();
    const meta = await getMeta();
    const current = await status(settings.privacy.autoLockMinutes);
    return ok({
      ...current,
      autoLockMinutes: settings.privacy.autoLockMinutes,
      createdAt: meta?.createdAt ?? null,
      iterations: meta?.kdf.iterations ?? null,
      problem: await diagnose(current.state),
    });
  });

  handle('ui:vault-enable', async (request) => {
    const { passphrase } = request as Extract<UiRequest, { type: 'ui:vault-enable' }>;
    if (await hasEncryptedRecords()) return err(ORPHAN_CIPHERTEXT, 'EVAULTMIXED');
    const result = await enable(passphrase, async (key) => {
      return prepareAll(null, key);
    });
    if (!result.ok) return err(result.error ?? 'Encryption could not be switched on.', result.code);

    return ok({ enabled: true });
  });

  handle('ui:vault-unlock', async (request) => {
    const { passphrase } = request as Extract<UiRequest, { type: 'ui:vault-unlock' }>;
    const result = await unlock(passphrase);
    if (!result.ok) return err(result.error ?? 'That passphrase does not match.', 'EBADPASS');

    // Deleting a profile while locked can leave resume blobs behind; this is
    // the first moment they can safely be identified.
    const problem = await diagnose('unlocked');
    // Pruning decides by what each profile references; with unreadable
    // records in the store, that cannot be known, so nothing is removed.
    if (!problem) await pruneOrphanResumes();
    return ok({ unlocked: true, problem });
  });

  handle('ui:vault-lock', async () => {
    await lock();
    return ok({ locked: true });
  });

  handle('ui:vault-change-passphrase', async (request) => {
    const { current, next } = request as Extract<UiRequest, { type: 'ui:vault-change-passphrase' }>;
    const result = await changePassphrase(current, next, async (from, to) => {
      return prepareAll(from, to);
    });
    return result.ok
      ? ok({ changed: true })
      : err(result.error ?? 'The passphrase could not be changed.', result.code);
  });

  handle('ui:vault-disable', async (request) => {
    const { passphrase } = request as Extract<UiRequest, { type: 'ui:vault-disable' }>;
    const meta = await getMeta();
    if (!meta) return err('Encryption is not switched on.');

    const result = await disable(passphrase, async () => {
      // Derive from the supplied passphrase rather than reusing the session
      // key: `disable` has already verified it, and this keeps the decryption
      // path independent of whatever happens to be unlocked.
      const key = await deriveKey(passphrase, meta.kdf);
      return prepareAll(key, null);
    });
    if (!result.ok)
      return err(result.error ?? 'Encryption could not be switched off.', result.code);

    return ok({ enabled: false });
  });
}

const ORPHAN_CIPHERTEXT =
  'Some of your data is encrypted, but the record that holds its passphrase settings is missing, so it cannot be unlocked. This can happen if switching encryption on was interrupted in Fillwright 0.5.0 or earlier. Export what is still readable from the Privacy Center, then erase all data and import your resume again.';

const MIXED_KEYS =
  'Your passphrase is right, but some records were encrypted with a different key and cannot be opened. This can happen if a passphrase change was interrupted in Fillwright 0.5.0 or earlier. Try your previous passphrase; if that does not open them, export what is readable from the Privacy Center, then erase all data and import your resume again.';

/**
 * Detects a store left half re-encrypted by an older, non-atomic version, so
 * the user gets a way out instead of an endless "locked". Returns null when
 * the store is consistent.
 */
async function diagnose(state: 'off' | 'locked' | 'unlocked'): Promise<string | null> {
  if (state === 'off') return (await hasEncryptedRecords()) ? ORPHAN_CIPHERTEXT : null;
  if (state === 'locked') return null;
  const key = await getKey();
  if (!key) return null;
  return (await countUndecryptable(key)) > 0 ? MIXED_KEYS : null;
}
