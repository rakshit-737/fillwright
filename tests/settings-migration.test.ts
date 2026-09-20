import { beforeEach, describe, expect, it } from 'vitest';
import { chromeMock, resetStorage } from './setup';
import { getSettings } from '@/storage/settings';

describe('settings migration from 0.3', () => {
  beforeEach(() => resetStorage());

  const seed = (flag: boolean) =>
    chrome.storage.local.set({
      settings: { version: 1, autofill: { autoDetectOnKnownSites: flag, allowOverwrite: true } },
    });

  it('maps an enabled flag to Assist only when site access exists', async () => {
    chromeMock.permissions.contains.mockResolvedValueOnce(true);
    await seed(true);
    const settings = await getSettings();
    expect(settings.autofill.mode).toBe('assist');
    expect('autoDetectOnKnownSites' in settings.autofill).toBe(false);
    expect(settings.autofill.allowOverwrite).toBe(true);
  });

  it('falls back to Manual without site access, and for a disabled flag', async () => {
    chromeMock.permissions.contains.mockResolvedValueOnce(false);
    await seed(true);
    expect((await getSettings()).autofill.mode).toBe('manual');
    resetStorage();
    await seed(false);
    expect((await getSettings()).autofill.mode).toBe('manual');
  });

  it('rewrites the stored record once', async () => {
    await seed(false);
    await getSettings();
    const stored = (await chrome.storage.local.get('settings')).settings as {
      version: number;
      autofill: Record<string, unknown>;
    };
    expect(stored.version).toBe(3);
    expect(stored.autofill).not.toHaveProperty('autoDetectOnKnownSites');
  });
});
