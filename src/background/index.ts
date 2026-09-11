import { installRouter } from './router';
import { registerProfileHandlers } from './handlers/profiles';
import { registerSettingsHandlers } from './handlers/settings';
import { registerPrivacyHandlers } from './handlers/privacy';
import { registerAutofillHandlers } from './handlers/autofill';
import { registerVaultHandlers } from './handlers/vault';
import { getSettings } from '@/storage/settings';
import { countProfiles, createProfile } from '@/storage/profiles';
import { setSettings } from '@/storage/settings';

/**
 * Fillwright service worker.
 *
 * Owns all persistent state. Neither the popup nor a content script touches
 * IndexedDB directly, so there is exactly one place where profile data can be
 * read or written and exactly one place to audit.
 */

installRouter();
registerSettingsHandlers();
registerProfileHandlers();
registerPrivacyHandlers();
registerAutofillHandlers();
registerVaultHandlers();

chrome.runtime.onInstalled.addListener(async (details) => {
  // Guarantee there is always an active profile to write parsed resume data into.
  if ((await countProfiles()) === 0) {
    const profile = await createProfile('My Profile');
    await setSettings({ activeProfileId: profile.id });
  }
  const settings = await getSettings();
  if (details.reason === 'install' && !settings.onboardingCompleted) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#/welcome') });
  }
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'fillwright-activate') return;
  // Same path as the toolbar button: a user gesture grants activeTab, and the
  // content script is injected only for this tab, only now.
  await chrome.runtime.sendMessage({ type: 'ui:scan-active-tab' }).catch(() => undefined);
});
