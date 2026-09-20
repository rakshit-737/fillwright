import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeMock, resetStorage } from './setup';
import { syncAutoDetect, AUTO_SCRIPT_ID } from '@/background/auto-detect';
import { setSettings } from '@/storage/settings';
import { ATS_ORIGINS, ALL_SITES, originPatternFor, registrableOrigins } from '@/utils/site-access';
import { isAtsHost } from '@/field-detection/ats-hosts';

const granted = (origins: string[]) =>
  chromeMock.permissions.getAll.mockImplementation(async () => ({ origins, permissions: [] }));

describe('proactive-mode registration', () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
  });

  it('registers only for the origins actually granted', async () => {
    await setSettings({ autofill: { mode: 'assist' } });
    granted(['http://localhost/*']);
    const result = await syncAutoDetect();
    expect(result.registered).toBe(true);
    expect(chromeMock.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: AUTO_SCRIPT_ID, matches: ['http://localhost/*'] }),
    ]);
  });

  it('registers for a single granted site, not for every https site', async () => {
    await setSettings({ autofill: { mode: 'assist' } });
    granted(['https://jobs.example.com/*']);
    await syncAutoDetect();
    expect(chromeMock.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ matches: ['https://jobs.example.com/*'] }),
    ]);
  });

  it('registers for exactly the job-site tier when that is what was granted', async () => {
    await setSettings({ autofill: { mode: 'smart' } });
    granted([...ATS_ORIGINS]);
    await syncAutoDetect();
    const calls = chromeMock.scripting.registerContentScripts.mock.calls as unknown as Array<
      [Array<{ matches: string[] }>]
    >;
    const matches = calls[0]![0][0]!.matches;
    expect([...matches].sort()).toEqual([...ATS_ORIGINS].sort());
    expect(matches).not.toContain(ALL_SITES);
  });

  it('never registers in manual mode, whatever is granted', async () => {
    await setSettings({ autofill: { mode: 'manual' } });
    granted([ALL_SITES]);
    const result = await syncAutoDetect();
    expect(result.registered).toBe(false);
    expect(chromeMock.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('unregisters when access is revoked', async () => {
    await setSettings({ autofill: { mode: 'smart' } });
    granted([]);
    chromeMock.scripting.getRegisteredContentScripts.mockResolvedValueOnce([
      { id: AUTO_SCRIPT_ID, matches: ['https://*/*'], js: ['content.js'] },
    ]);
    const result = await syncAutoDetect();
    expect(result.registered).toBe(false);
    expect(chromeMock.scripting.unregisterContentScripts).toHaveBeenCalled();
  });
});

describe('site access origins', () => {
  it('turns a page URL into a pattern for that one host', () => {
    expect(originPatternFor('https://boards.greenhouse.io/acme/jobs/1?x=1')).toBe(
      'https://boards.greenhouse.io/*',
    );
    expect(originPatternFor('http://localhost:5173/form')).toBe('http://localhost/*');
    expect(originPatternFor('http://example.com/')).toBeNull();
    expect(originPatternFor('chrome://extensions')).toBeNull();
    expect(originPatternFor('not a url')).toBeNull();
  });

  it('keeps only patterns the content script may be registered for', () => {
    expect(
      registrableOrigins(['https://a.com/*', 'http://localhost/*', 'ftp://x/*', '<all_urls>']),
    ).toEqual(['https://a.com/*', 'http://localhost/*']);
  });

  it('shares one host list with page detection', () => {
    for (const origin of ATS_ORIGINS) {
      const host = origin.replace('https://*.', '').replace('/*', '');
      expect(isAtsHost(`https://jobs.${host}/apply`)).toBe(true);
    }
  });
});

describe('isAtsHost looks at the host only', () => {
  it('does not match an ATS name in the path or query', () => {
    expect(isAtsHost('https://evil.example/?next=greenhouse.io')).toBe(false);
    expect(isAtsHost('https://greenhouse.io.evil.example/')).toBe(false);
    expect(isAtsHost('not a url')).toBe(false);
  });
});
