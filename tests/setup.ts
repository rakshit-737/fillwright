import { vi } from 'vitest';

/**
 * Minimal in-memory stand-ins for the extension APIs the modules under test
 * touch. Keeping this hand-written (rather than mocking per test) means a test
 * that accidentally reaches for a real Chrome API fails loudly.
 */
const storage = new Map<string, unknown>();
const session = new Map<string, unknown>();

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key?: string | string[] | null) => {
        if (key == null) return Object.fromEntries(storage);
        const keys = Array.isArray(key) ? key : [key];
        const out: Record<string, unknown> = {};
        for (const k of keys) if (storage.has(k)) out[k] = storage.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      }),
      remove: vi.fn(async (key: string | string[]) => {
        for (const k of Array.isArray(key) ? key : [key]) storage.delete(k);
      }),
      clear: vi.fn(async () => storage.clear()),
    },
    // Memory-only in Chrome as well; used by the vault for the unlocked key.
    session: {
      get: vi.fn(async (key?: string | string[] | null) => {
        if (key == null) return Object.fromEntries(session);
        const keys = Array.isArray(key) ? key : [key];
        const out: Record<string, unknown> = {};
        for (const k of keys) if (session.has(k)) out[k] = session.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) session.set(k, v);
      }),
      remove: vi.fn(async (key: string | string[]) => {
        for (const k of Array.isArray(key) ? key : [key]) session.delete(k);
      }),
      clear: vi.fn(async () => session.clear()),
    },
  },
  runtime: {
    id: 'fillwright-test',
    sendMessage: vi.fn(async () => ({ ok: true, data: null })),
    getURL: (path: string) => `chrome-extension://fillwright-test/${path}`,
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    lastError: undefined as { message: string } | undefined,
  },
  tabs: { create: vi.fn(async () => ({})), query: vi.fn(async () => []) },
  scripting: {
    executeScript: vi.fn(async () => []),
    registerContentScripts: vi.fn(async () => undefined),
    unregisterContentScripts: vi.fn(async () => undefined),
    getRegisteredContentScripts: vi.fn(async (): Promise<unknown[]> => []),
  },
  action: { openPopup: vi.fn(async () => undefined) },
  commands: { onCommand: { addListener: vi.fn() } },
  permissions: {
    contains: vi.fn(async (_query?: { origins?: string[] }) => true),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    getAll: vi.fn(async (): Promise<{ origins?: string[]; permissions?: string[] }> => ({
      origins: ['https://*/*'],
      permissions: [],
    })),
  },
};

vi.stubGlobal('chrome', chromeMock);

export function resetStorage(): void {
  storage.clear();
  session.clear();
}

export { chromeMock };
