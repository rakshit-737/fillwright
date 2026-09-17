import { codeForTransportError } from '@/utils/errors';

/**
 * Content-script → service-worker requests.
 *
 * Trust boundary: runs in the page's tab (isolated world). Sends only the
 * narrow `content:*` messages; what comes back is treated as a Result and
 * nothing else.
 *
 * MV3 service workers sleep and restart. A request that finds the worker
 * gone is retried once — sending wakes it — and a second failure becomes a
 * structured result with a code, never a thrown error or a silent null. An
 * "extension context invalidated" failure (the extension was reloaded or
 * updated under this page) is not retried: nothing on this page can reach the
 * new worker, and the user needs to reload.
 */

export type Reply<T> = { ok: true; data: T } | { ok: false; code: string; error: string };

const RETRY_DELAY_MS = 350;

export async function request<T>(message: {
  type: string;
  [key: string]: unknown;
}): Promise<Reply<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = (await chrome.runtime.sendMessage(message)) as
        { ok: true; data: T } | { ok: false; error?: string; code?: string } | undefined;
      if (response === undefined) throw new Error('no response');
      if (response.ok) return response;
      return { ok: false, code: response.code ?? 'EHANDLER', error: response.error ?? '' };
    } catch (cause) {
      const code = codeForTransportError(cause);
      if (code === 'EINVALIDATED' || attempt === 1) return { ok: false, code, error: '' };
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return { ok: false, code: 'EWORKER', error: '' };
}

/** For fire-and-forget notifications whose failure changes nothing for the user. */
export function notify(message: { type: string; [key: string]: unknown }): void {
  void request(message);
}
