import { b64ToBytes } from "../../shared/envelope";
import { generateIdentity, identityFromStored, identityToStored, type Identity, type PrekeySecrets } from "./crypto";

export type LocalMessage = {
  messageId: string;
  threadId: string;
  senderWallet: string;
  receiverWallet: string;
  plaintext: string | null;
  createdAt: number;
  readAt: number | null;
  pending: boolean;
  kind: "ok" | "failed" | "other-session";
};

export type LocalThread = {
  threadId: string;
  peer: string;
  updatedAt: number;
};

export type StoredPrekey = {
  id: string;
  publicKey: string;
  privateKey: string;
  signature: string;
  published: boolean;
  consumed: boolean;
};

type StoredIdentity = ReturnType<typeof identityToStored> & { wallet: string };

const DB_NAME = "muzzchat";
const DB_VERSION = 1;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("prekeys")) db.createObjectStore("prekeys");
        if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages");
        if (!db.objectStoreNames.contains("threads")) db.createObjectStore("threads");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function withStore<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const store = tx.objectStore(name);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB abortada"));
        Promise.resolve()
          .then(() => run(store))
          .then((value) => {
            result = value;
          })
          .catch((error: unknown) => {
            try {
              tx.abort();
            } catch {
              /* The transaction may already be closed. */
            }
            reject(error);
          });
      }),
  );
}

export const idb = {
  async getIdentity(wallet: string): Promise<Identity | null> {
    const stored = await withStore<StoredIdentity | undefined>("kv", "readonly", (store) =>
      requestToPromise(store.get(`identity:${wallet}`)),
    );
    return stored ? identityFromStored(stored) : null;
  },

  async saveIdentity(wallet: string, identity: Identity): Promise<void> {
    const stored: StoredIdentity = { wallet, ...identityToStored(identity) };
    await withStore("kv", "readwrite", (store) => requestToPromise(store.put(stored, `identity:${wallet}`)));
  },

  async getNumber(key: string): Promise<number> {
    const value = await withStore<number | undefined>("kv", "readonly", (store) => requestToPromise(store.get(key)));
    return typeof value === "number" ? value : 0;
  },

  async setNumber(key: string, value: number): Promise<void> {
    await withStore("kv", "readwrite", (store) => requestToPromise(store.put(value, key)));
  },

  async allPrekeys(): Promise<StoredPrekey[]> {
    return withStore("prekeys", "readonly", (store) => requestToPromise(store.getAll()));
  },

  async savePrekey(prekey: StoredPrekey): Promise<void> {
    await withStore("prekeys", "readwrite", (store) => requestToPromise(store.put(prekey, prekey.id)));
  },

  async markPrekeysPublished(ids: string[]): Promise<void> {
    await withStore("prekeys", "readwrite", async (store) => {
      for (const id of ids) {
        const row = (await requestToPromise(store.get(id))) as StoredPrekey | undefined;
        if (row) store.put({ ...row, published: true }, id);
      }
    });
  },

  async getMessage(messageId: string): Promise<LocalMessage | undefined> {
    return withStore("messages", "readonly", (store) => requestToPromise(store.get(messageId)));
  },

  async saveMessage(message: LocalMessage): Promise<void> {
    await withStore("messages", "readwrite", (store) => requestToPromise(store.put(message, message.messageId)));
  },

  async deleteMessage(messageId: string): Promise<void> {
    await withStore("messages", "readwrite", (store) => requestToPromise(store.delete(messageId)));
  },

  async allMessages(): Promise<LocalMessage[]> {
    return withStore("messages", "readonly", (store) => requestToPromise(store.getAll()));
  },

  async setReadAt(messageId: string, readAt: number): Promise<void> {
    await withStore("messages", "readwrite", async (store) => {
      const row = (await requestToPromise(store.get(messageId))) as LocalMessage | undefined;
      if (!row || row.readAt != null) return;
      store.put({ ...row, readAt }, messageId);
    });
  },

  async allThreads(): Promise<LocalThread[]> {
    return withStore("threads", "readonly", (store) => requestToPromise(store.getAll()));
  },

  async saveThread(thread: LocalThread): Promise<void> {
    await withStore("threads", "readwrite", (store) => requestToPromise(store.put(thread, thread.threadId)));
  },
};

export const idbSecrets: PrekeySecrets = {
  async isConsumed(id: string) {
    const row = await withStore<StoredPrekey | undefined>("prekeys", "readonly", (store) => requestToPromise(store.get(id)));
    return !row || row.consumed || !row.privateKey;
  },
  async peek(id: string) {
    const row = await withStore<StoredPrekey | undefined>("prekeys", "readonly", (store) => requestToPromise(store.get(id)));
    if (!row || row.consumed || !row.privateKey) return null;
    return b64ToBytes(row.privateKey);
  },
  async destroy(id: string) {
    await withStore("prekeys", "readwrite", async (store) => {
      const row = (await requestToPromise(store.get(id))) as StoredPrekey | undefined;
      if (!row) return;
      store.put({ ...row, privateKey: "", consumed: true }, id);
    });
  },
};

export async function loadOrCreateIdentity(wallet: string): Promise<Identity> {
  const existing = await idb.getIdentity(wallet);
  if (existing) return existing;
  const created = await generateIdentity();
  await idb.saveIdentity(wallet, created);
  return created;
}
