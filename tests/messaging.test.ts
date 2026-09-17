import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { send } from '@/utils/messaging';

/**
 * Messaging has to fail, not hang.
 *
 * Under MV3 the service worker can be torn down mid-request. A promise that
 * never settles becomes a spinner the user can only escape by reloading, with
 * no indication of what went wrong — which is exactly how a small bug turned
 * into "it just keeps loading".
 */

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a normal round trip', () => {
  it('returns the handler result', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { saved: true } });
    const result = await send({ type: 'ui:get-settings' });
    expect(result).toEqual({ ok: true, data: { saved: true } });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('passes a handler error through unchanged', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'Profile not found', code: 'ENOTFOUND' });
    const result = await send({ type: 'ui:get-profile', profileId: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ENOTFOUND');
    // A real error from a handler must not be retried.
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('a request that never comes back', () => {
  it('times out instead of hanging forever', async () => {
    // The worker received the message and was then terminated: the promise
    // simply never settles.
    sendMessage.mockReturnValue(new Promise(() => {}));

    const pending = send({ type: 'ui:save-profile', profile: {} as never }, { retry: false });
    await vi.advanceTimersByTimeAsync(16_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ETIMEOUT');
      // The code stays specific; the text is the one the user can act on.
      expect(result.error).toMatch(/did not answer/i);
    }
  });

  it('honours a shorter timeout', async () => {
    sendMessage.mockReturnValue(new Promise(() => {}));

    const pending = send({ type: 'ui:get-state' }, { timeoutMs: 1_000, retry: false });
    await vi.advanceTimersByTimeAsync(1_100);
    const result = await pending;

    expect(result.ok).toBe(false);
  });

  it('retries once, because the first send wakes a sleeping worker', async () => {
    sendMessage
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce({ ok: true, data: 'second time lucky' });

    const result = await send({ type: 'ui:get-state' });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('gives up after the retry rather than looping', async () => {
    sendMessage.mockRejectedValue(new Error('Extension context invalidated'));

    const result = await send({ type: 'ui:get-state' });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
  });
});

describe('an absent response', () => {
  it('is reported rather than treated as success', async () => {
    sendMessage.mockResolvedValue(undefined);
    const result = await send({ type: 'ui:get-state' }, { retry: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ENORESP');
  });
});
