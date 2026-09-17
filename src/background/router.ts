import { err, ok, type AnyRequest, type Result } from '@/types/messages';
import { isEnvelope } from '@/security/validate';
import { describeError } from '@/utils/errors';

export type Handler = (
  request: AnyRequest,
  sender: chrome.runtime.MessageSender,
) => Promise<Result<unknown>>;

const handlers = new Map<string, Handler>();

export function handle(type: AnyRequest['type'], handler: Handler): void {
  handlers.set(type, handler);
}

/**
 * Single entry point for every message reaching the service worker.
 *
 * Returning `true` from the listener keeps the message channel open for the
 * async response; any handler rejection is converted into a structured error so
 * a failure never leaks a stack trace (which can contain file paths) to a page.
 */
export function installRouter(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isEnvelope(message)) {
      sendResponse(err('Malformed message', 'EBADMSG'));
      return false;
    }
    if (!senderMayCall(message.type, sender)) {
      sendResponse(err('Not permitted from this context', 'EFORBIDDEN'));
      return false;
    }
    const handler = handlers.get(message.type);
    if (!handler) {
      sendResponse(err(`Unsupported message: ${message.type}`, 'ENOHANDLER'));
      return false;
    }
    handler(message as AnyRequest, sender).then(
      (result) => sendResponse(result),
      (cause: unknown) => {
        const code = codeForFailure(cause);
        if (code === 'EHANDLER') {
          // The type and the error name only — an error message can quote the
          // data that caused it, so it is never logged.
          console.error('[fillwright] handler failed', message.type, errorName(cause));
        }
        // The user-facing text comes from one table; raw messages never cross.
        sendResponse(err(describeError(code).message, code));
      },
    );
    return true;
  });
}

/**
 * Turns a thrown error into a stable code. A locked vault and a full disk are
 * expected states with their own recovery, not faults.
 */
export function codeForFailure(cause: unknown): string {
  const name = errorName(cause);
  if ((cause as { code?: string } | null)?.code === 'ELOCKED') return 'ELOCKED';
  if (name === 'QuotaExceededError' || /quota/i.test(String((cause as Error)?.message ?? ''))) {
    return 'EQUOTA';
  }
  return 'EHANDLER';
}

function errorName(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'name' in cause) return String(cause.name);
  return typeof cause;
}

/**
 * `ui:*` messages read and write the whole profile, so only Fillwright's own
 * pages may send them. A content script lives inside a page Fillwright does
 * not control; it gets the narrow `content:*` surface and nothing more, so even
 * a content script subverted by its page cannot export the profile.
 */
const CONTENT_MAY_SEND_UI: ReadonlySet<string> = new Set(['ui:open-security']);

export function senderMayCall(type: string, sender: chrome.runtime.MessageSender): boolean {
  if (!type.startsWith('ui:')) return true;
  if (CONTENT_MAY_SEND_UI.has(type)) return true;
  if (sender.id !== undefined && sender.id !== chrome.runtime.id) return false;
  const extensionRoot = chrome.runtime.getURL('');
  return typeof sender.url === 'string' && sender.url.startsWith(extensionRoot);
}

export { ok, err };
