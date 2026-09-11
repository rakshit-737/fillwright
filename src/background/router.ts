import { err, ok, type AnyRequest, type Result } from '@/types/messages';
import { isEnvelope } from '@/security/validate';

export type Handler = (request: AnyRequest, sender: chrome.runtime.MessageSender) => Promise<Result<unknown>>;

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

export { ok, err };
