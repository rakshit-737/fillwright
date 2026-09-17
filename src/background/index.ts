import { installRouter } from './router';
import { registerProfileHandlers } from './handlers/profiles';
import { registerSettingsHandlers } from './handlers/settings';
import { registerPrivacyHandlers } from './handlers/privacy';
import { registerAutofillHandlers, scanActiveTab } from './handlers/autofill';
import { registerAssistHandlers } from './handlers/assist';
import { registerVaultHandlers } from './handlers/vault';
import { syncAutoDetect } from './auto-detect';
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
registerAssistHandlers();
registerVaultHandlers();

chrome.runtime.onInstalled.addListener(async (details) => {
  // Guarantee there is always an active profile to write parsed resume data into.
  if ((await countProfiles()) === 0) {
    const profile = await createProfile('My Profile');
    await setSettings({ activeProfileId: profile.id });
  }
  await syncAutoDetect().catch(() => undefined);
  const settings = await getSettings();
  if (details.reason === 'install' && !settings.onboardingCompleted) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#/welcome') });
  }
});

chrome.runtime.onStartup?.addListener(() => {
  void syncAutoDetect().catch(() => undefined);
});

// Revoking site access from chrome://extensions must switch proactive modes off
// immediately, not at the next restart.
chrome.permissions?.onRemoved?.addListener(() => {
  void syncAutoDetect().catch(() => undefined);
});
chrome.permissions?.onAdded?.addListener(() => {
  void syncAutoDetect().catch(() => undefined);
});

chrome.commands?.onCommand.addListener((command) => {
  if (command !== 'fillwright-activate') return;
  // Same path as the toolbar button: the shortcut is a user gesture, which
  // grants activeTab for this tab only. Called directly — a service worker's
  // own runtime.sendMessage is never delivered back to itself.
  void scanActiveTab().catch(() => undefined);
});
