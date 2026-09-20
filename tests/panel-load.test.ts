import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injectPanel } from '@/background/handlers/autofill';

/**
 * The panel is a second bundle, injected when it is first shown, so a page
 * nobody asks about never parses it.
 *
 * The frame it lands in comes from the sender Chrome reports, never from the
 * message, and the file is named here — so this cannot become a way for a
 * page to run something of its choosing, or reach a frame it does not own.
 */

const executeScript = () => chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  executeScript().mockClear();
  executeScript().mockResolvedValue([]);
});

describe('content:load-panel', () => {
  it('injects the bundled panel into the calling frame only', async () => {
    const result = await injectPanel({ tab: { id: 7 } as chrome.tabs.Tab, frameId: 3 });
    expect(result.ok).toBe(true);
    expect(executeScript()).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [3] },
      files: ['panel.js'],
    });
  });

  it('defaults to the top frame when the sender reports none', async () => {
    await injectPanel({ tab: { id: 7 } as chrome.tabs.Tab });
    expect(executeScript()).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      files: ['panel.js'],
    });
  });

  it('refuses a sender that is not a tab', async () => {
    const result = await injectPanel({ url: 'chrome-extension://fillwright-test/options.html' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ENOTAB');
    expect(executeScript()).not.toHaveBeenCalled();
  });

  it('reports a failed injection instead of throwing', async () => {
    executeScript().mockRejectedValue(new Error('Cannot access contents of the page'));
    const result = await injectPanel({ tab: { id: 7 } as chrome.tabs.Tab, frameId: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EINJECT');
  });
});
