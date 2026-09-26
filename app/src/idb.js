const DB_NAME = 'muzzsnap-e2ee';
const DB_VERSION = 1;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function kvGet(db, key) {
  return requestToPromise(db.transaction('kv', 'readonly').objectStore('kv').get(key));
}

export function kvSet(db, key, value) {
  return requestToPromise(db.transaction('kv', 'readwrite').objectStore('kv').put(value, key));
}

export function kvDel(db, key) {
  return requestToPromise(db.transaction('kv', 'readwrite').objectStore('kv').delete(key));
}

export function kvEntries(db) {
  return new Promise((resolve, reject) => {
    const out = [];
    const cursor = db.transaction('kv', 'readonly').objectStore('kv').openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) {
        resolve(out);
        return;
      }
      out.push([row.key, row.value]);
      row.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}
