import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeMock, resetStorage } from './setup';
import { syncAutoDetect, AUTO_SCRIPT_ID } from '@/background/auto-detect';
import { setSettings } from '@/storage/settings';

describe('proactive-mode registration', () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
  });

  it('registers only for the origins actually granted', async () => {
    await setSettings({ autofill: { mode: 'assist' } });
    chromeMock.permissions.contains.mockImplementation(
      async (query?: { origins?: string[] }) => query?.origins?.[0] === 'http://localhost/*',
    );
    const result = await syncAutoDetect();
    expect(result.registered).toBe(true);
    expect(chromeMock.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: AUTO_SCRIPT_ID, matches: ['http://localhost/*'] }),
    ]);
  });

  it('never registers in manual mode, whatever is granted', async () => {
    await setSettings({ autofill: { mode: 'manual' } });
    chromeMock.permissions.contains.mockImplementation(async () => true);
    const result = await syncAutoDetect();
    expect(result.registered).toBe(false);
    expect(chromeMock.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('unregisters when access is revoked', async () => {
    await setSettings({ autofill: { mode: 'smart' } });
    chromeMock.permissions.contains.mockImplementation(async () => false);
    chromeMock.scripting.getRegisteredContentScripts.mockResolvedValueOnce([
      { id: AUTO_SCRIPT_ID, matches: ['https://*/*'], js: ['content.js'] },
    ]);
    const result = await syncAutoDetect();
    expect(result.registered).toBe(false);
    expect(chromeMock.scripting.unregisterContentScripts).toHaveBeenCalled();
  });
});
