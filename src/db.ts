/** Minimal promise wrapper around IndexedDB. */

const DB_NAME = 'khmer-letter-pad';
const DB_VERSION = 1;

export type StoreName = 'glyphs' | 'brushes' | 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('glyphs')) db.createObjectStore('glyphs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('brushes')) db.createObjectStore('brushes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return done((await tx(store, 'readonly')).getAll()) as Promise<T[]>;
}

export async function put(store: StoreName, value: unknown): Promise<void> {
  await done((await tx(store, 'readwrite')).put(value));
}

export async function remove(store: StoreName, key: string): Promise<void> {
  await done((await tx(store, 'readwrite')).delete(key));
}

export async function clear(store: StoreName): Promise<void> {
  await done((await tx(store, 'readwrite')).clear());
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = (await done((await tx('meta', 'readonly')).get(key))) as { value: T } | undefined;
  return row?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await put('meta', { key, value });
}

/** Ask the browser not to evict our data (Safari may still ignore it). */
export function requestPersistence(): void {
  navigator.storage?.persist?.().catch(() => {});
}
