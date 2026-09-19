/**
 * A ~100-line promise wrapper over IndexedDB.
 *
 * Deliberately hand-rolled rather than pulling a dependency: the profile store
 * holds the most sensitive data in the product, and a small auditable surface is
 * worth more here than convenience.
 */

export type StoreName = 'profiles' | 'resumes' | 'mappings' | 'history' | 'meta';

export const DB_NAME = 'fillwright';
export const DB_VERSION = 2;

const STORES: Array<{ name: StoreName; keyPath: string; indexes?: Array<[string, string]> }> = [
  { name: 'profiles', keyPath: 'id' },
  { name: 'resumes', keyPath: 'id' },
  { name: 'mappings', keyPath: 'id', indexes: [['by-origin', 'origin']] },
  { name: 'history', keyPath: 'id', indexes: [['by-date', 'appliedAt']] },
  { name: 'meta', keyPath: 'key' },
];

/**
 * Schema upgrades, keyed by the version they upgrade TO. Each runs inside the
 * versionchange transaction when a database older than that version is
 * opened, in order. A fresh install runs them all.
 *
 * To change the schema: bump DB_VERSION, add a step here, and add a case to
 * tests/boundary.test.ts that opens the previous version and upgrades it.
 * Steps must not await anything: the upgrade transaction closes on the first
 * microtask gap it does not own.
 */
type UpgradeStep = (db: IDBDatabase, tx: IDBTransaction) => void;

export const UPGRADES: Readonly<Record<number, UpgradeStep>> = {
  1: ensureStores,
  // 2: reconcile stores and indexes, so a v1 database missing any of them
  // (for example from an interrupted first install) is repaired.
  2: ensureStores,
};

function ensureStores(db: IDBDatabase, tx: IDBTransaction): void {
  for (const store of STORES) {
    const os = db.objectStoreNames.contains(store.name)
      ? tx.objectStore(store.name)
      : db.createObjectStore(store.name, { keyPath: store.keyPath });
    for (const [indexName, keyPath] of store.indexes ?? []) {
      if (!os.indexNames.contains(indexName)) os.createIndex(indexName, keyPath, { unique: false });
    }
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      for (let version = event.oldVersion + 1; version <= DB_VERSION; version++) {
        UPGRADES[version]?.(db, tx);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the schema, drop our handle so the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (os: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = fn(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${mode} failed`));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export const idb = {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return run<T | undefined>(store, 'readonly', (os) => os.get(key) as IDBRequest<T | undefined>);
  },
  getAll<T>(store: StoreName): Promise<T[]> {
    return run<T[]>(store, 'readonly', (os) => os.getAll() as IDBRequest<T[]>);
  },
  getAllByIndex<T>(store: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
    return run<T[]>(store, 'readonly', (os) => os.index(index).getAll(value) as IDBRequest<T[]>);
  },
  put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
    return run<IDBValidKey>(store, 'readwrite', (os) => os.put(value));
  },
  delete(store: StoreName, key: IDBValidKey): Promise<undefined> {
    return run<undefined>(store, 'readwrite', (os) => os.delete(key));
  },
  clear(store: StoreName): Promise<undefined> {
    return run<undefined>(store, 'readwrite', (os) => os.clear());
  },
  count(store: StoreName): Promise<number> {
    return run<number>(store, 'readonly', (os) => os.count());
  },
};

/** Test helper: drops the cached handle and deletes the database. */
export async function __resetDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Removes the entire database. Used by the "erase all data" control. */
export async function destroyDb(): Promise<void> {
  const db = await openDb();
  db.close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
    request.onblocked = () => resolve();
  });
}
