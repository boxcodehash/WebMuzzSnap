import {
  exportPublicSpki,
  generateEcdhKeyPair,
  generateSigningKeyPair,
  signPrekey
} from './crypto.js';
import { kvDel, kvEntries, kvGet, kvSet, openDb } from './idb.js';
import { shouldPurge } from './expiry.js';

async function db() {
  return openDb();
}

export async function ensureLocalKeys() {
  const store = await db();
  let identity = await kvGet(store, 'key:identity');
  let signing = await kvGet(store, 'key:signing');
  let created = false;
  if (!identity || !signing) {
    const ecdh = await generateEcdhKeyPair();
    const ecdsa = await generateSigningKeyPair();
    identity = {
      privateKey: ecdh.privateKey,
      publicSpki: await exportPublicSpki(ecdh.publicKey)
    };
    signing = {
      privateKey: ecdsa.privateKey,
      publicSpki: await exportPublicSpki(ecdsa.publicKey)
    };
    await kvSet(store, 'key:identity', identity);
    await kvSet(store, 'key:signing', signing);
    created = true;
  }
  return { created, identity, signing };
}

export async function createPrekeys(count) {
  const store = await db();
  const signing = await kvGet(store, 'key:signing');
  if (!signing) throw new Error('sin_llave');
  const made = [];
  for (let i = 0; i < count; i++) {
    const pair = await generateEcdhKeyPair();
    const id = crypto.randomUUID();
    const pub = await exportPublicSpki(pair.publicKey);
    const sig = await signPrekey(signing.privateKey, id, pub);
    await kvSet(store, `key:prekey:${id}`, {
      id,
      privateKey: pair.privateKey,
      pub,
      sig,
      uploaded: false
    });
    made.push({ id, pub, sig });
  }
  return made;
}

export async function unpublishedPrekeys() {
  const store = await db();
  const rows = await kvEntries(store);
  return rows
    .filter(([key, value]) => String(key).startsWith('key:prekey:') && value && value.uploaded !== true)
    .map(([, value]) => ({ id: value.id, pub: value.pub, sig: value.sig }));
}

export async function markPrekeysUploaded(ids) {
  const store = await db();
  for (const id of ids) {
    const current = await kvGet(store, `key:prekey:${id}`);
    if (current) await kvSet(store, `key:prekey:${id}`, { ...current, uploaded: true });
  }
}

export async function takePrekey(id) {
  const store = await db();
  return kvGet(store, `key:prekey:${id}`);
}

export async function destroyPrekey(id) {
  const store = await db();
  await kvDel(store, `key:prekey:${id}`);
}

export async function getTrust(wallet) {
  const store = await db();
  return kvGet(store, `trust:${String(wallet).toLowerCase()}`);
}

export async function setTrust(wallet, value) {
  const store = await db();
  await kvSet(store, `trust:${String(wallet).toLowerCase()}`, value);
}

export async function putCache(record) {
  const store = await db();
  await kvSet(store, `cache:${record.messageId}`, record);
}

export async function getCache(messageId) {
  const store = await db();
  return kvGet(store, `cache:${messageId}`);
}

export async function listCache() {
  const store = await db();
  const rows = await kvEntries(store);
  return rows.filter(([key]) => String(key).startsWith('cache:')).map(([, value]) => value);
}

export async function purgeCache(now = Date.now()) {
  const store = await db();
  const rows = await kvEntries(store);
  let removed = 0;
  for (const [key, value] of rows) {
    if (!String(key).startsWith('cache:')) continue;
    if (shouldPurge(value && value.expireAt, now)) {
      await kvDel(store, key);
      removed += 1;
    }
  }
  return removed;
}

export async function wipeDevice() {
  const store = await db();
  const rows = await kvEntries(store);
  for (const [key] of rows) {
    if (String(key).startsWith('key:') || String(key).startsWith('trust:') || String(key).startsWith('cache:')) {
      await kvDel(store, key);
    }
  }
}
