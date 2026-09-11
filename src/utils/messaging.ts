import type { AnyRequest, Result } from '@/types/messages';

/**
 * Typed wrapper around chrome.runtime.sendMessage.
 *
 * Always resolves to a Result — a dead service worker or a missing handler
 * becomes a structured error rather than an unhandled rejection in the UI.
 */
export async function send<T>(request: AnyRequest): Promise<Result<T>> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as Result<T> | undefined;
    if (!response) return { ok: false, error: 'No response from background', code: 'ENORESP' };
    return response;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'Messaging failed';
    return { ok: false, error: detail, code: 'ESEND' };
  }
}

/** Convenience for call sites that would rather throw than branch. */
export async function sendOrThrow<T>(request: AnyRequest): Promise<T> {
  const result = await send<T>(request);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
