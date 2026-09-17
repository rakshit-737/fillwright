import { err, ok, type AnyRequest, type Result } from '@/types/messages';
import { isEnvelope } from '@/security/validate';

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
        const detail = cause instanceof Error ? cause.message : 'Unknown error';
        // A locked vault is an expected state, not a fault. It gets its own
        // code so every surface can offer "unlock" instead of showing an error.
        const code =
          cause instanceof Error && (cause as { code?: string }).code === 'ELOCKED'
            ? 'ELOCKED'
            : 'EHANDLER';
        if (code !== 'ELOCKED') {
          console.error('[fillwright] handler failed', message.type, detail);
        }
        sendResponse(err(detail, code));
      },
    );
    return true;
  });
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
