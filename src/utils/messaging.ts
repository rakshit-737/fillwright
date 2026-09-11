import type { AnyRequest, Result } from '@/types/messages';

/**
 * Typed wrapper around chrome.runtime.sendMessage.
 *
 * Always resolves to a Result, and always resolves *eventually*. Both matter:
 *
 *  - A dead service worker or a missing handler becomes a structured error
 *    rather than an unhandled rejection in the UI.
 *  - A request that never comes back is abandoned rather than left pending.
 *    Under MV3 the worker can be terminated mid-request, and a promise that
 *    never settles turns into a spinner the user has to reload the page to
 *    escape. A timeout is the difference between "that failed, try again" and
 *    an interface that appears to have frozen.
 */

/** Generous enough for a large profile write, short enough to not look frozen. */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface SendOptions {
  timeoutMs?: number;
  /**
   * Retry once if the worker was asleep. Sending wakes it, so the second
   * attempt usually succeeds where the first found a closed port.
   */
  retry?: boolean;
}

export async function send<T>(
  request: AnyRequest,
  options: SendOptions = {},
): Promise<Result<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retry = true } = options;

  const attempt = async (): Promise<Result<T>> => {
    try {
      const response = await withTimeout(
        chrome.runtime.sendMessage(request) as Promise<Result<T> | undefined>,
        timeoutMs,
      );
      if (!response) return { ok: false, error: 'No response from background', code: 'ENORESP' };
      return response;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Messaging failed';
      const code = /timed out/i.test(detail) ? 'ETIMEOUT' : 'ESEND';
      return { ok: false, error: detail, code };
    }
  };

  const first = await attempt();
  if (first.ok || !retry || !isTransient(first)) return first;

  // The first send wakes a sleeping worker; give it one more chance before
  // reporting a failure the user can do nothing about.
  return attempt();
}

/** Failures that are worth one retry, as opposed to real errors from a handler. */
function isTransient(result: Result<unknown>): boolean {
  if (result.ok) return false;
  if (result.code === 'ETIMEOUT' || result.code === 'ENORESP') return true;
  return /receiving end does not exist|message port closed|Extension context invalidated/i.test(
    result.error,
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Fillwright timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/** Convenience for call sites that would rather throw than branch. */
export async function sendOrThrow<T>(request: AnyRequest, options?: SendOptions): Promise<T> {
  const result = await send<T>(request, options);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
