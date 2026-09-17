import { handle, ok, err } from '../router';
import { getSettings, setSettings } from '@/storage/settings';
import { pruneOrphanResumes, rewriteAll } from '@/storage/profiles';
import { deriveKey } from '@/security/crypto';
import { changePassphrase, disable, enable, getMeta, lock, status, unlock } from '@/security/vault';
import type { ContentRequest, UiRequest } from '@/types/messages';

const OPENABLE_ROUTES: ReadonlySet<string> = new Set([
  'security',
  'import',
  'privacy',
  'assistance',
]);

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
    const { route } = request as Extract<ContentRequest, { type: 'content:open-page' }>;
    if (!OPENABLE_ROUTES.has(route)) return err('Unknown page', 'EBADROUTE');
    await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#/${route}`) });
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
    return ok({
      ...(await status(settings.privacy.autoLockMinutes)),
      autoLockMinutes: settings.privacy.autoLockMinutes,
      createdAt: meta?.createdAt ?? null,
      iterations: meta?.kdf.iterations ?? null,
    });
  });

  handle('ui:vault-enable', async (request) => {
    const { passphrase } = request as Extract<UiRequest, { type: 'ui:vault-enable' }>;
    const result = await enable(passphrase, async (key) => {
      await rewriteAll(null, key);
    });
    if (!result.ok) return err(result.error ?? 'Encryption could not be switched on.');

    await setSettings({ privacy: { encryptionEnabled: true } });
    return ok({ enabled: true });
  });

  handle('ui:vault-unlock', async (request) => {
    const { passphrase } = request as Extract<UiRequest, { type: 'ui:vault-unlock' }>;
    const result = await unlock(passphrase);
    if (!result.ok) return err(result.error ?? 'That passphrase does not match.', 'EBADPASS');

    // Deleting a profile while locked can leave resume blobs behind; this is
    // the first moment they can safely be identified.
    await pruneOrphanResumes();
    return ok({ unlocked: true });
  });

  handle('ui:vault-lock', async () => {
    await lock();
    return ok({ locked: true });
  });

  handle('ui:vault-change-passphrase', async (request) => {
    const { current, next } = request as Extract<UiRequest, { type: 'ui:vault-change-passphrase' }>;
    const result = await changePassphrase(current, next, async (from, to) => {
      await rewriteAll(from, to);
    });
    return result.ok
      ? ok({ changed: true })
      : err(result.error ?? 'The passphrase could not be changed.');
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
      await rewriteAll(key, null);
    });
    if (!result.ok) return err(result.error ?? 'Encryption could not be switched off.');

    await setSettings({ privacy: { encryptionEnabled: false } });
    return ok({ enabled: false });
  });
}
