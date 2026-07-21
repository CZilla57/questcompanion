import type { OutboxEntry } from "./core";

export interface OutboxStore {
  /** false = in-memory fallback (private mode / IDB broken): survives the
   * session only, and the capture UI says so honestly. */
  readonly persistent: boolean;
  add(entry: OutboxEntry): Promise<void>;
  list(): Promise<OutboxEntry[]>;
  update(id: string, patch: Partial<OutboxEntry>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Same-tab change signal for useOutboxEntries. Cross-tab consistency is not
 * chased — the server clientKey dedupes, and drains take a Web Lock. */
export const outboxChanged = new EventTarget();
const emit = () => outboxChanged.dispatchEvent(new Event("change"));

const byCreatedAt = (a: OutboxEntry, b: OutboxEntry) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

export function createMemoryStore(): OutboxStore {
  const entries = new Map<string, OutboxEntry>();
  return {
    persistent: false,
    async add(entry) {
      entries.set(entry.id, entry);
      emit();
    },
    async list() {
      return [...entries.values()].sort(byCreatedAt);
    },
    async update(id, patch) {
      const current = entries.get(id);
      if (!current) return;
      entries.set(id, { ...current, ...patch });
      emit();
    },
    async remove(id) {
      entries.delete(id);
      emit();
    },
  };
}

// ── Raw IndexedDB adapter ────────────────────────────────────────────────
// Deliberately dependency-free and thin: all replay/ordering logic lives in
// core.ts/replay.ts against the interface above, which the memory store
// contract-tests. DB "fq-outbox", store "entries", keyPath "id"; Blobs
// persist via structured clone.

const DB_NAME = "fq-outbox";
const STORE = "entries";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

/** Readwrite ops resolve on COMMIT, not request success: some browsers
 * (Firefox) defer quota errors to commit time, and the capture path's
 * "Saved ✓" toast must never precede durability. Mirrors update()'s pattern. */
function writeTx(db: IDBDatabase, run: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    run(t.objectStore(STORE));
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error ?? new Error("indexedDB tx aborted"));
    t.onerror = () => reject(t.error ?? new Error("indexedDB tx failed"));
  });
}

function createIdbStore(db: IDBDatabase): OutboxStore {
  return {
    persistent: true,
    async add(entry) {
      await writeTx(db, (s) => {
        s.put(entry);
      });
      emit();
    },
    async list() {
      const all = (await tx(db, "readonly", (s) => s.getAll())) as OutboxEntry[];
      return all.sort(byCreatedAt);
    },
    async update(id, patch) {
      // Single readwrite transaction for the read-modify-write: a concurrent
      // remove() can no longer land between a get and a stale put and be
      // resurrected. No-op (and no change event) when the id is unknown,
      // matching the memory adapter's contract.
      const found = await new Promise<boolean>((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        const store = t.objectStore(STORE);
        const getReq = store.get(id);
        let exists = false;
        getReq.onsuccess = () => {
          const current = getReq.result as OutboxEntry | undefined;
          if (current) {
            exists = true;
            store.put({ ...current, ...patch });
          }
        };
        t.oncomplete = () => resolve(exists);
        t.onabort = () => reject(t.error ?? new Error("indexedDB tx aborted"));
        t.onerror = () => reject(t.error ?? new Error("indexedDB tx failed"));
      });
      if (found) emit();
    },
    async remove(id) {
      await writeTx(db, (s) => {
        s.delete(id);
      });
      emit();
    },
  };
}

let storePromise: Promise<OutboxStore> | null = null;

/** Singleton accessor. IDB when available; otherwise an in-memory queue for
 * the session (callers surface the honest "keep the app open" copy). */
export function getOutboxStore(): Promise<OutboxStore> {
  if (!storePromise) {
    storePromise = (async () => {
      try {
        if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
        return createIdbStore(await openDb());
      } catch (err) {
        // Private mode / disabled storage / broken IDB. The UI already says
        // "keep the app open" honestly — this names the reason for debugging.
        console.warn("outbox: IndexedDB unavailable, captures will only survive this session", err);
        return createMemoryStore();
      }
    })();
  }
  return storePromise;
}
