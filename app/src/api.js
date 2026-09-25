import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { getBytes, getStorage, ref, uploadBytes, deleteObject } from 'firebase/storage';
import { getConfig } from './config.js';
import {
  decryptFile,
  encryptFile,
  importEcdhPublic,
  importEcdsaPublic,
  messageAad,
  open as openSealed,
  seal,
  verifyPrekey
} from './crypto.js';
import { READ_TTL_MS, SENDER_COPY_TTL_MS, UNREAD_TTL_MS } from './expiry.js';
import { GROUP_ID, threadId } from '../shared/policy.js';
import {
  createPrekeys,
  destroyPrekey,
  ensureLocalKeys,
  getCache,
  getTrust,
  listCache,
  markPrekeysUploaded,
  putCache,
  setTrust,
  takePrekey,
  unpublishedPrekeys,
  wipeDevice
} from './keys.js';

let auth;
let db;
let storage;
let me = '';
let skipNextRecheck = false;
const peerMemory = new Map();
const stops = [];

function appError(code, extra) {
  const err = new Error(code);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

export function initBackend() {
  const cfg = getConfig();
  const app = initializeApp(cfg.firebase);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  return auth;
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentWallet() {
  return me;
}

export function noteFreshLogin() {
  skipNextRecheck = true;
}

export async function signInToken(token) {
  await signInWithCustomToken(auth, token);
}

export async function logout() {
  stopWatchers();
  me = '';
  peerMemory.clear();
  if (auth) await signOut(auth);
}

async function postJson(path, body, idToken) {
  const cfg = getConfig();
  if (!cfg.functionsBase) throw appError('functions_unconfigured');
  let response;
  try {
    response = await fetch(`${cfg.functionsBase}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
      },
      body: JSON.stringify(body || {})
    });
  } catch {
    throw appError('network');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = appError(data.error || 'request_failed');
    err.payload = data;
    throw err;
  }
  return data;
}

export async function createNonce() {
  return postJson('createNonce', {});
}

export async function verifyAccess(message, signature) {
  return postJson('verifyAccess', { message, signature });
}

export async function recheckAccess() {
  const user = auth.currentUser;
  if (!user) throw appError('auth');
  const idToken = await user.getIdToken();
  return postJson('recheckBalance', {}, idToken);
}

export function consumeFreshLogin() {
  const skip = skipNextRecheck;
  skipNextRecheck = false;
  return skip;
}

async function idToken() {
  const user = auth.currentUser;
  if (!user) throw appError('auth');
  return user.getIdToken();
}

export async function prepareDeviceKeys() {
  me = auth.currentUser.uid.toLowerCase();
  const local = await ensureLocalKeys();
  await setDoc(doc(db, 'users', me), {
    wallet: me,
    identityPub: local.identity.publicSpki,
    signingPub: local.signing.publicSpki
  });
  if (local.created) {
    const existing = await getDocs(collection(db, 'users', me, 'prekeys'));
    for (const row of existing.docs) await deleteDoc(row.ref);
  }
  const pending = await unpublishedPrekeys();
  await uploadPrekeyDocs(pending);
  const available = await getDocs(query(
    collection(db, 'users', me, 'prekeys'),
    where('consumed', '==', false),
    limit(30)
  ));
  if (available.size < 8) {
    const more = await createPrekeys(20 - available.size);
    await uploadPrekeyDocs(more);
  }
  await setDoc(doc(db, 'groups', GROUP_ID, 'members', me), {
    wallet: me,
    joinedAt: Timestamp.now()
  });
}

async function uploadPrekeyDocs(rows) {
  const ids = [];
  for (const row of rows) {
    await setDoc(doc(db, 'users', me, 'prekeys', row.id), {
      pub: row.pub,
      sig: row.sig,
      consumed: false,
      createdAt: Timestamp.now()
    });
    ids.push(row.id);
  }
  if (ids.length) await markPrekeysUploaded(ids);
}

let presenceTimer = 0;

export function startPresence() {
  const write = () => setDoc(doc(db, 'presence', me), {
    wallet: me,
    lastSeen: Timestamp.now()
  }).catch(() => {});
  write();
  presenceTimer = window.setInterval(write, 25000);
  stops.push(() => window.clearInterval(presenceTimer));
}

export function stopWatchers() {
  while (stops.length) {
    const stop = stops.pop();
    try { stop(); } catch { /* cierre */ }
  }
  privateStop = null;
}

function watch(ref, onData) {
  const stop = onSnapshot(ref, onData, (err) => {
    if (err && err.code === 'permission-denied') {
      window.dispatchEvent(new CustomEvent('muzz-denied'));
    }
  });
  stops.push(stop);
  return stop;
}

export function watchAccess(onChange) {
  return watch(doc(db, 'access', me), (snap) => {
    onChange(snap.exists() ? snap.data() : null);
  });
}

export function watchPresence(onChange) {
  return watch(collection(db, 'presence'), (snap) => {
    const now = Date.now();
    const list = [];
    snap.forEach((row) => {
      const lastSeen = row.data().lastSeen?.toMillis?.() || 0;
      if (now - lastSeen < 70000) list.push({ wallet: row.id, lastSeen });
    });
    list.sort((a, b) => a.wallet.localeCompare(b.wallet));
    onChange(list);
  });
}

export function watchThreads(onChange) {
  return watch(collection(db, 'users', me, 'threads'), async (snap) => {
    const cache = await listCache();
    const threads = [];
    snap.forEach((row) => {
      const peer = row.id;
      const related = cache
        .filter((item) => item.conversationId === threadId(me, peer))
        .sort((a, b) => b.sentAt - a.sentAt);
      threads.push({
        wallet: peer,
        updatedAt: row.data().updatedAt?.toMillis?.() || related[0]?.sentAt || 0,
        preview: related[0]?.text ? trimPreview(related[0].text) : 'Mensaje cifrado'
      });
    });
    threads.sort((a, b) => b.updatedAt - a.updatedAt);
    onChange(threads);
  });
}

function trimPreview(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 71)}…` : clean;
}

export function watchGroup(onChange) {
  let inbox = [];
  let outbox = [];
  const emit = async () => onChange(await mergeGroup(inbox, outbox));
  watch(collection(db, 'groups', GROUP_ID, 'inbox', me, 'messages'), async (snap) => {
    inbox = snap.docs.map((row) => ({ id: row.id, ref: row.ref, ...row.data() }));
    await emit();
  });
  watch(collection(db, 'groups', GROUP_ID, 'outbox', me, 'messages'), async (snap) => {
    outbox = snap.docs.map((row) => ({ id: row.id, ...row.data() }));
    await emit();
  });
}

let privateStop = null;

export function watchPrivate(peer, onChange) {
  if (privateStop) {
    privateStop();
    const index = stops.indexOf(privateStop);
    if (index >= 0) stops.splice(index, 1);
    privateStop = null;
  }
  if (!peer) return;
  const id = threadId(me, peer);
  privateStop = watch(collection(db, 'privateThreads', id, 'messages'), async (snap) => {
    const rows = snap.docs.map((row) => ({ id: row.id, ref: row.ref, ...row.data() }));
    onChange(await mapPrivate(rows));
  });
}

async function mergeGroup(inbox, outbox) {
  const views = [];
  for (const row of inbox) {
    const view = await materialize(row, { mine: false, kind: 'inbox' });
    if (view) views.push(view);
  }
  for (const row of outbox) {
    const expireAt = row.expireAt?.toMillis?.() || 0;
    if (expireAt && expireAt <= Date.now()) continue;
    const cached = await getCache(row.messageId);
    views.push({
      id: row.messageId,
      sender: me,
      mine: true,
      text: cached?.text || null,
      locked: cached ? '' : 'Esta copia solo estaba en el dispositivo que la envió.',
      sentAt: row.sentAt?.toMillis?.() || cached?.sentAt || 0,
      readAt: null,
      expireAt,
      kind: 'sender-copy',
      attachmentPath: '',
      fileName: cached?.file?.name || '',
      canDownload: Boolean(cached?.file)
    });
  }
  views.sort((a, b) => a.sentAt - b.sentAt);
  return views.filter((view) => !view.expireAt || view.expireAt > Date.now());
}

async function mapPrivate(rows) {
  const views = [];
  for (const row of rows) {
    const mine = row.sender === me;
    const view = await materialize(row, { mine, kind: 'inbox' });
    if (view) views.push(view);
  }
  views.sort((a, b) => a.sentAt - b.sentAt);
  return views.filter((view) => !view.expireAt || view.expireAt > Date.now());
}

async function materialize(row, { mine, kind }) {
  const expireAt = row.expireAt?.toMillis?.() || 0;
  const readAt = row.readAt?.toMillis?.() || null;
  const sentAt = row.sentAt?.toMillis?.() || 0;
  if (expireAt && expireAt <= Date.now()) return null;
  const cached = await getCache(row.messageId);
  if (cached) {
    cached.expireAt = expireAt || cached.expireAt;
    cached.readAt = readAt;
    await putCache(cached);
    if (!mine && !readAt && cached.text != null) await markRead(row.ref, cached);
    return viewFromCache(cached, { attachmentPath: row.attachmentPath || '' });
  }
  if (mine) {
    return {
      id: row.messageId,
      sender: row.sender,
      mine: true,
      text: null,
      locked: 'El texto está en el dispositivo desde el que lo enviaste.',
      sentAt,
      readAt,
      expireAt,
      kind,
      attachmentPath: row.attachmentPath || '',
      fileName: '',
      canDownload: false
    };
  }
  const opened = await decryptIncoming(row);
  if (!opened.ok) {
    return {
      id: row.messageId,
      sender: row.sender,
      mine: false,
      text: null,
      locked: opened.reason,
      sentAt,
      readAt,
      expireAt,
      kind,
      attachmentPath: row.attachmentPath || '',
      fileName: '',
      canDownload: false
    };
  }
  const record = {
    messageId: row.messageId,
    conversationId: row.conversationId,
    sender: row.sender,
    recipient: row.recipient,
    text: opened.payload.text,
    file: opened.payload.file || null,
    sentAt,
    readAt,
    expireAt,
    mine: false,
    kind
  };
  await putCache(record);
  if (opened.prekeyId) await destroyPrekey(opened.prekeyId);
  if (!readAt) await markRead(row.ref, record);
  return viewFromCache(record, { attachmentPath: row.attachmentPath || '' });
}

function viewFromCache(record, extra) {
  return {
    id: record.messageId,
    sender: record.sender,
    mine: record.mine,
    text: record.text,
    locked: '',
    sentAt: record.sentAt,
    readAt: record.readAt,
    expireAt: record.expireAt,
    kind: record.kind,
    attachmentPath: extra.attachmentPath || '',
    fileName: record.file?.name || '',
    canDownload: Boolean(record.file && extra.attachmentPath)
  };
}

async function peerDoc(wallet) {
  if (peerMemory.has(wallet)) return peerMemory.get(wallet);
  const snap = await getDoc(doc(db, 'users', wallet));
  const data = snap.exists() ? snap.data() : null;
  peerMemory.set(wallet, data);
  return data;
}

async function decryptIncoming(row) {
  const identity = await peerDoc(row.sender);
  if (!identity || identity.identityPub !== row.senderIdentityPub) {
    return { ok: false, reason: 'La identidad del emisor no coincide con la publicada.' };
  }
  const trust = await getTrust(row.sender);
  if (trust && trust.identityPub !== identity.identityPub) {
    return { ok: false, reason: 'La llave de esta persona cambió. Confírmala antes de abrir el mensaje.' };
  }
  if (!trust) {
    await setTrust(row.sender, {
      identityPub: identity.identityPub,
      signingPub: identity.signingPub
    });
  }
  const prekey = await takePrekey(row.recipientPrekeyId);
  if (!prekey) return { ok: false, reason: 'La llave de un solo uso ya no está en este dispositivo.' };
  const factorSnap = await getDoc(doc(db, 'serverFactors', row.serverFactorId));
  if (!factorSnap.exists()) return { ok: false, reason: 'Falta el factor del servidor para abrir este mensaje.' };
  try {
    const plain = await openSealed({
      senderEphPub: row.senderEphPub,
      senderIdentityPublic: row.senderIdentityPub,
      recipientPrekeyPrivate: prekey.privateKey,
      serverFactor: bytesFromB64(factorSnap.data().factor),
      ciphertext: row.ciphertext,
      iv: row.iv,
      aad: messageAad({
        conversationId: row.conversationId,
        messageId: row.messageId,
        sender: row.sender,
        recipient: row.recipient,
        serverFactorId: row.serverFactorId
      })
    });
    const payload = JSON.parse(new TextDecoder().decode(plain));
    if (!payload || payload.v !== 1 || typeof payload.text !== 'string') {
      return { ok: false, reason: 'El mensaje no tiene un formato reconocible.' };
    }
    return { ok: true, payload, prekeyId: row.recipientPrekeyId };
  } catch {
    return { ok: false, reason: 'No se pudo descifrar. El sobre está alterado o incompleto.' };
  }
}

function bytesFromB64(value) {
  const bin = atob(String(value || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function markRead(ref, record) {
  const readAtMs = Date.now();
  try {
    await updateDoc(ref, {
      readAt: Timestamp.fromMillis(readAtMs),
      expireAt: Timestamp.fromMillis(readAtMs + READ_TTL_MS)
    });
    record.readAt = readAtMs;
    record.expireAt = readAtMs + READ_TTL_MS;
    await putCache(record);
  } catch {
    /* si ya estaba leído, las reglas rechazan el segundo intento */
  }
}

async function assertPeer(peer) {
  const data = await peerDoc(peer);
  if (!data?.identityPub || !data?.signingPub) throw appError('NO_KEYS');
  const trust = await getTrust(peer);
  if (trust && (trust.identityPub !== data.identityPub || trust.signingPub !== data.signingPub)) {
    throw appError('TRUST', { trust: { wallet: peer, identityPub: data.identityPub, signingPub: data.signingPub } });
  }
  if (!trust) {
    await setTrust(peer, { identityPub: data.identityPub, signingPub: data.signingPub });
  }
  return data;
}

async function claimPrekey(peer, signingPub) {
  const snap = await getDocs(query(
    collection(db, 'users', peer, 'prekeys'),
    where('consumed', '==', false),
    limit(8)
  ));
  if (snap.empty) throw appError('NO_PREKEY');
  const signingKey = await importEcdsaPublic(signingPub);
  for (const item of snap.docs) {
    const preview = item.data();
    const valid = await verifyPrekey(signingKey, item.id, preview.pub, preview.sig);
    if (!valid) continue;
    try {
      let pub = '';
      await runTransaction(db, async (tx) => {
        const fresh = await tx.get(item.ref);
        if (!fresh.exists() || fresh.data().consumed === true || fresh.data().sig !== preview.sig) {
          throw new Error('taken');
        }
        pub = fresh.data().pub;
        tx.update(item.ref, {
          consumed: true,
          consumedBy: me,
          consumedAt: Timestamp.now()
        });
      });
      return { id: item.id, pub };
    } catch {
      /* otro envío se quedó la prekey */
    }
  }
  throw appError('NO_PREKEY');
}

function safeFileName(name) {
  const base = String(name || 'archivo').split(/[/\\]/).pop();
  const clean = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  return clean || 'archivo';
}

async function readFileMeta(file) {
  if (!file) return null;
  if (file.size > 8 * 1024 * 1024) throw appError('file_size');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sealed = await encryptFile(bytes);
  return {
    upload: sealed.ciphertext,
    meta: {
      name: safeFileName(file.name),
      type: String(file.type || 'application/octet-stream').slice(0, 100),
      size: file.size,
      keyB64: sealed.keyB64,
      ivB64: sealed.ivB64
    }
  };
}

async function issueFactors(messageId, conversationId, recipients) {
  const data = await postJson('issueServerFactor', { messageId, conversationId, recipients }, await idToken());
  return data.factors;
}

async function sealFor(recipient, prekey, factor, payload, conversationId, messageId) {
  const local = await ensureLocalKeys();
  const aad = messageAad({
    conversationId,
    messageId,
    sender: me,
    recipient,
    serverFactorId: factor.id
  });
  const sealed = await seal({
    senderIdentityPrivate: local.identity.privateKey,
    recipientPrekeyPublic: await importEcdhPublic(prekey.pub),
    serverFactor: bytesFromB64(factor.factor),
    plaintext: new TextEncoder().encode(JSON.stringify(payload)),
    aad
  });
  return { sealed, identityPub: local.identity.publicSpki, aadId: factor.id };
}

function cipherDoc({ recipient, conversationId, messageId, sealed, identityPub, prekeyId, factorId, attachmentPath }) {
  const docData = {
    sender: me,
    recipient,
    conversationId,
    messageId,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    senderEphPub: sealed.senderEphPub,
    senderIdentityPub: identityPub,
    recipientPrekeyId: prekeyId,
    serverFactorId: factorId,
    sentAt: Timestamp.now(),
    readAt: null,
    expireAt: Timestamp.fromMillis(Date.now() + UNREAD_TTL_MS)
  };
  if (attachmentPath) docData.attachmentPath = attachmentPath;
  return docData;
}

export async function sendPrivate(peer, text, file) {
  const clean = String(text || '').trim();
  if (!clean && !file) return;
  if (clean.length > 2000) throw appError('too_long');
  const peerData = await assertPeer(peer);
  const prekey = await claimPrekey(peer, peerData.signingPub);
  const messageId = crypto.randomUUID();
  const conversationId = threadId(me, peer);
  const filePack = await readFileMeta(file);
  const factors = await issueFactors(messageId, conversationId, [peer]);
  const payload = { v: 1, text: clean, file: filePack?.meta || null };
  const sealed = await sealFor(peer, prekey, factors[peer], payload, conversationId, messageId);
  const now = Date.now();
  const cached = {
    messageId,
    conversationId,
    sender: me,
    recipient: peer,
    text: clean,
    file: filePack?.meta || null,
    sentAt: now,
    readAt: null,
    expireAt: now + UNREAD_TTL_MS,
    mine: true,
    kind: 'inbox'
  };
  await putCache(cached);
  let attachmentPath = '';
  try {
    if (filePack) {
      attachmentPath = `attachments/${messageId}/${filePack.meta.name}`;
      await uploadBytes(ref(storage, attachmentPath), filePack.upload, {
        contentType: 'application/octet-stream'
      });
    }
    await setDoc(
      doc(db, 'privateThreads', conversationId, 'messages', messageId),
      cipherDoc({
        recipient: peer,
        conversationId,
        messageId,
        sealed: sealed.sealed,
        identityPub: sealed.identityPub,
        prekeyId: prekey.id,
        factorId: factors[peer].id,
        attachmentPath
      })
    );
    await setDoc(doc(db, 'users', me, 'threads', peer), {
      peer,
      sender: me,
      updatedAt: Timestamp.now()
    });
    await setDoc(doc(db, 'users', peer, 'threads', me), {
      peer: me,
      sender: me,
      updatedAt: Timestamp.now()
    });
  } catch (err) {
    if (attachmentPath) await deleteObject(ref(storage, attachmentPath)).catch(() => {});
    throw err;
  }
}

export async function sendGroup(text, file) {
  const clean = String(text || '').trim();
  if (!clean && !file) return;
  if (clean.length > 2000) throw appError('too_long');
  const membersSnap = await getDocs(collection(db, 'groups', GROUP_ID, 'members'));
  const members = membersSnap.docs.map((row) => row.id).filter((id) => id !== me);
  if (!members.length) throw appError('no_members');
  if (members.length > 80) throw appError('too_many');
  const ready = [];
  const skipped = [];
  for (const peer of members) {
    try {
      const data = await assertPeer(peer);
      const prekey = await claimPrekey(peer, data.signingPub);
      ready.push({ peer, prekey });
    } catch (err) {
      if (err.code === 'TRUST') throw err;
      skipped.push(peer);
    }
  }
  if (!ready.length) throw appError('NO_PREKEY');
  const messageId = crypto.randomUUID();
  const filePack = await readFileMeta(file);
  const factors = await issueFactors(messageId, GROUP_ID, ready.map((item) => item.peer));
  const payload = { v: 1, text: clean, file: filePack?.meta || null };
  const now = Date.now();
  await putCache({
    messageId,
    conversationId: GROUP_ID,
    sender: me,
    recipient: '',
    text: clean,
    file: filePack?.meta || null,
    sentAt: now,
    readAt: null,
    expireAt: now + SENDER_COPY_TTL_MS,
    mine: true,
    kind: 'sender-copy'
  });
  let attachmentPath = '';
  try {
    if (filePack) {
      attachmentPath = `attachments/${messageId}/${filePack.meta.name}`;
      await uploadBytes(ref(storage, attachmentPath), filePack.upload, {
        contentType: 'application/octet-stream'
      });
    }
    const local = await ensureLocalKeys();
    for (const item of ready) {
      const sealed = await sealFor(item.peer, item.prekey, factors[item.peer], payload, GROUP_ID, messageId);
      await setDoc(
        doc(db, 'groups', GROUP_ID, 'inbox', item.peer, 'messages', messageId),
        cipherDoc({
          recipient: item.peer,
          conversationId: GROUP_ID,
          messageId,
          sealed: sealed.sealed,
          identityPub: local.identity.publicSpki,
          prekeyId: item.prekey.id,
          factorId: factors[item.peer].id,
          attachmentPath
        })
      );
    }
    await setDoc(doc(db, 'groups', GROUP_ID, 'outbox', me, 'messages', messageId), {
      sender: me,
      messageId,
      conversationId: GROUP_ID,
      sentAt: Timestamp.now(),
      expireAt: Timestamp.fromMillis(now + SENDER_COPY_TTL_MS),
      recipients: ready.map((item) => item.peer)
    });
  } catch (err) {
    if (attachmentPath) await deleteObject(ref(storage, attachmentPath)).catch(() => {});
    throw err;
  }
  return { skipped };
}

export async function downloadAttachment(messageId, attachmentPath) {
  const cached = await getCache(messageId);
  if (!cached?.file || !attachmentPath) throw appError('no_file');
  const bytes = await getBytes(ref(storage, attachmentPath));
  const plain = await decryptFile(bytes, cached.file.keyB64, cached.file.ivB64);
  const blob = new Blob([plain], { type: cached.file.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = cached.file.name || 'archivo';
  link.click();
  URL.revokeObjectURL(url);
}

export async function acceptTrust(wallet, next) {
  peerMemory.delete(wallet);
  await setTrust(wallet, { identityPub: next.identityPub, signingPub: next.signingPub });
}

export async function eraseDeviceKeys() {
  await wipeDevice();
}
