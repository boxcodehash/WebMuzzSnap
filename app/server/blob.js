import { randomBytes } from 'node:crypto';
import {
  databaseUrl,
  getGoogleAccessToken,
  loadServiceAccount,
  verifyFirebaseIdToken
} from './google.js';
import { bearerToken, fail, isWallet } from './push.js';
import {
  READ_AFTER_MS,
  UNREAD_MAX_MS,
  loadServerKey,
  messageDue,
  unwrapFromStorage,
  wrapForStorage
} from './server-key.js';

export const BLOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 400 * 1024;
const BLOB_API = 'https://vercel.com/api/blob/';

function rtdbUrl(env, path, accessToken) {
  const url = new URL(databaseUrl(env) + '/' + path.split('/').map(encodeURIComponent).join('/') + '.json');
  url.searchParams.set('access_token', accessToken);
  return url.toString();
}

function responseHeader(res, name) {
  const headers = res && res.headers;
  if (!headers) return '';
  const wanted = String(name || '').toLowerCase();
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(wanted) || '';
  return headers[name] || headers[wanted] || '';
}

async function rtdb(fetchImpl, method, env, path, accessToken, value) {
  const res = await fetchImpl(rtdbUrl(env, path, accessToken), {
    method,
    headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  const data = method === 'DELETE' ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error('rtdb');
    error.code = 'rtdb';
    throw error;
  }
  return data;
}

async function rtdbTagged(fetchImpl, method, env, path, accessToken, value, headers) {
  const res = await fetchImpl(rtdbUrl(env, path, accessToken), {
    method,
    headers: headers || {},
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  const data = method === 'DELETE' ? null : await res.json().catch(() => null);
  if (res.status === 412) return { conflict: true, data: null, etag: '' };
  if (!res.ok) {
    const error = new Error('rtdb');
    error.code = 'rtdb';
    throw error;
  }
  return { conflict: false, data, etag: responseHeader(res, 'etag') };
}

export function decodeCiphertext(value) {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_BYTES * 2) return null;
  let bytes;
  try {
    bytes = Buffer.from(text, 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  if (bytes.toString('base64').replace(/=+$/g, '') !== text.replace(/=+$/g, '')) return null;
  return bytes;
}

async function walletFromRequest(req, account, fetchImpl) {
  const token = bearerToken(req.headers);
  if (!token || !account) return '';
  return verifyFirebaseIdToken(token, {
    projectId: account.project_id,
    fetchImpl,
    now: req.now
  });
}

function blobToken(env) {
  return String((env && env.BLOB_READ_WRITE_TOKEN) || '').trim();
}

export async function putPrivateBlob(token, bytes, fetchImpl) {
  const pathname = 'muzzsnap/private/' + randomBytes(16).toString('hex');
  const res = await fetchImpl(BLOB_API + '?pathname=' + encodeURIComponent(pathname), {
    method: 'PUT',
    headers: {
      authorization: 'Bearer ' + token,
      'x-api-version': '7',
      'x-content-type': 'application/octet-stream',
      'x-add-random-suffix': '1'
    },
    body: bytes
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.url) {
    const error = new Error('blob');
    error.code = 'blob';
    throw error;
  }
  return { url: String(data.url), pathname: String(data.pathname || pathname) };
}

export async function deletePrivateBlob(token, url, fetchImpl) {
  if (!url) return;
  await fetchImpl(BLOB_API + 'delete', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'x-api-version': '7',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ urls: [url] })
  });
}

async function readBlobBytes(token, url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const error = new Error('blob');
    error.code = 'blob';
    throw error;
  }
  const raw = Buffer.from(await res.arrayBuffer());
  if (!raw.length || raw.length > MAX_BYTES) {
    const error = new Error('blob');
    error.code = 'blob';
    throw error;
  }
  return raw.toString('base64');
}

function fresh(record, now) {
  const created = Number(record && record.createdAt) || 0;
  return created > 0 && now - created < BLOB_TTL_MS;
}

async function ready(req, deps, needsBlob) {
  if (req.method === 'OPTIONS') return { early: { status: 204, body: null } };
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const account = loadServiceAccount(env);
  const token = blobToken(env);
  if (!account) return { early: fail(503, 'storage_not_configured') };
  if (needsBlob && !token) return { early: fail(503, 'blob_not_configured') };
  let access;
  try {
    access = await getGoogleAccessToken(account, fetchImpl, req.now);
  } catch {
    return { early: fail(503, 'storage_not_configured') };
  }
  return { env, fetchImpl, account, token, access };
}

export async function handleWalletKey(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const pub = String(req.body && req.body.pub || '').trim();
  if (pub.length < 80 || pub.length > 400 || /[^A-Za-z0-9+/=]/.test(pub)) return fail(400, 'bad_key');
  const now = req.now || Date.now();
  const parsed = parsePrekeys(req.body, now);
  if (parsed.error) return fail(400, 'bad_key');
  try {
    const current = await rtdb(setup.fetchImpl, 'GET', setup.env, 'walletKeys/' + wallet, setup.access);
    const prekeys = current && current.prekeys && typeof current.prekeys === 'object' ? { ...current.prekeys } : {};
    if (parsed.map) Object.assign(prekeys, parsed.map);
    const record = { pub, alg: 'P-256', updatedAt: now };
    if (Object.keys(prekeys).length) record.prekeys = prekeys;
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'walletKeys/' + wallet, setup.access, record);
  } catch {
    return fail(502, 'storage_failed');
  }
  return { status: 200, body: { ok: true } };
}

function parsePrekeys(body, now) {
  if (!body || body.prekeys == null) return { map: null };
  if (!Array.isArray(body.prekeys) || body.prekeys.length > 30) return { error: true };
  const map = {};
  for (const item of body.prekeys) {
    const id = String(item && item.id || '').trim().toLowerCase();
    const pub = String(item && item.pub || '').trim();
    if (!/^[a-f0-9]{32}$/.test(id)) return { error: true };
    if (pub.length < 80 || pub.length > 400 || /[^A-Za-z0-9+/=]/.test(pub)) return { error: true };
    map[id] = { pub, createdAt: now };
  }
  return { map };
}

const INNER_FIELDS = ['v', 'kind', 'id', 'from', 'to', 'seq', 'sentAt', 'ephPub', 'fromPub', 'prekeyId', 'keyIv', 'wrappedKey', 'iv', 'ct'];

export function parseInnerEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !INNER_FIELDS.includes(key))) return null;
  if (value.v !== 2 || (value.kind !== 'text' && value.kind !== 'photo')) return null;
  const from = String(value.from || '').toLowerCase();
  const to = String(value.to || '').toLowerCase();
  if (!isWallet(from) || !isWallet(to) || from === to) return null;
  const id = String(value.id || '').toLowerCase();
  const prekeyId = String(value.prekeyId || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{32}$/.test(prekeyId)) return null;
  const seq = Number(value.seq);
  const sentAt = Number(value.sentAt);
  if (!Number.isInteger(seq) || seq < 0 || seq > 1e15) return null;
  if (!Number.isFinite(sentAt) || sentAt <= 0) return null;
  for (const field of ['ephPub', 'fromPub']) {
    const pub = String(value[field] || '');
    if (pub.length < 80 || pub.length > 400 || /[^A-Za-z0-9+/=]/.test(pub)) return null;
  }
  for (const field of ['keyIv', 'iv']) {
    const iv = String(value[field] || '');
    if (iv.length < 8 || iv.length > 80 || /[^A-Za-z0-9+/=]/.test(iv)) return null;
  }
  for (const field of ['wrappedKey', 'ct']) {
    const ct = String(value[field] || '');
    const max = field === 'ct' && value.kind === 'photo' ? 700000 : 64 * 1024;
    if (ct.length < 16 || ct.length > max || /[^A-Za-z0-9+/=]/.test(ct)) return null;
  }
  return {
    v: 2,
    kind: value.kind === 'photo' ? 'photo' : 'text',
    id,
    from,
    to,
    seq,
    sentAt,
    ephPub: String(value.ephPub),
    fromPub: String(value.fromPub),
    prekeyId,
    keyIv: String(value.keyIv),
    wrappedKey: String(value.wrappedKey),
    iv: String(value.iv),
    ct: String(value.ct)
  };
}

function threadOf(a, b) {
  return [a, b].sort().join('_');
}

function messagePath(thread, id) {
  return 'privateInbox/' + thread + '/messages/' + id;
}

export function inboxDue(msg, now) {
  if (!msg || typeof msg !== 'object') return false;
  if (messageDue(msg, now)) return true;
  if (msg.seal && msg.seal.kind === 'photo') {
    const ts = Number(msg.timestamp) || 0;
    return ts <= 0 || now - ts >= BLOB_TTL_MS;
  }
  return false;
}

export async function handlePrekeyClaim(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const peer = String(req.body && req.body.wallet || '').trim().toLowerCase();
  if (!isWallet(peer) || peer === wallet) return fail(400, 'bad_wallet');
  try {
    const path = 'walletKeys/' + peer;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await rtdbTagged(setup.fetchImpl, 'GET', setup.env, path, setup.access, undefined, {
        'X-Firebase-ETag': 'true'
      });
      const row = current.data;
      const prekeys = row && row.prekeys && typeof row.prekeys === 'object' ? { ...row.prekeys } : {};
      const id = Object.keys(prekeys).find((key) => prekeys[key] && typeof prekeys[key].pub === 'string');
      if (!id) return fail(404, 'no_prekey');
      const pub = String(prekeys[id].pub);
      delete prekeys[id];
      const headers = { 'Content-Type': 'application/json' };
      if (current.etag) headers['if-match'] = current.etag;
      const saved = await rtdbTagged(setup.fetchImpl, 'PUT', setup.env, path, setup.access, {
        ...row,
        prekeys
      }, headers);
      if (saved.conflict) continue;
      return { status: 200, body: { id, pub, identity: String((row && row.pub) || '') } };
    }
    return fail(409, 'prekey_conflict');
  } catch {
    return fail(502, 'storage_failed');
  }
}

export async function handlePrivateRelay(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const env = deps.env || process.env;
  const serverKey = loadServerKey(env);
  if (!serverKey) return fail(503, 'server_key_missing');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const sender = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!sender) return fail(401, 'unauthorized');
  const inner = parseInnerEnvelope(req.body && req.body.inner);
  if (!inner || inner.from !== sender) return fail(400, 'bad_message');
  const thread = threadOf(inner.from, inner.to);
  const path = messagePath(thread, inner.id);
  try {
    const existing = await rtdb(setup.fetchImpl, 'GET', setup.env, path, setup.access);
    if (existing && existing.outer && existing.from === sender) {
      return { status: 200, body: { id: inner.id, thread } };
    }
    const wrapped = wrapForStorage(serverKey, inner);
    const record = {
      v: 2,
      kind: inner.kind === 'photo' ? 'photo' : 'text',
      from: inner.from,
      to: inner.to,
      timestamp: inner.sentAt,
      seq: inner.seq,
      readAt: null,
      expireAt: inner.sentAt + UNREAD_MAX_MS,
      outer: wrapped.outer,
      outerIv: wrapped.outerIv
    };
    await rtdb(setup.fetchImpl, 'PUT', setup.env, path, setup.access, record);
    const preview = { lastText: inner.kind === 'photo' ? 'Photo' : 'Encrypted message', lastAt: inner.sentAt };
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'privateIndex/' + inner.from + '/' + inner.to, setup.access, preview);
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'privateIndex/' + inner.to + '/' + inner.from, setup.access, preview);
    return { status: 200, body: { id: inner.id, thread } };
  } catch {
    return fail(502, 'storage_failed');
  }
}

export async function handlePrivateUnwrap(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const env = deps.env || process.env;
  const serverKey = loadServerKey(env);
  if (!serverKey) return fail(503, 'server_key_missing');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const id = String(req.body && req.body.id || '').trim().toLowerCase();
  const peer = String(req.body && req.body.peer || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id) || !isWallet(peer) || peer === wallet) return fail(400, 'bad_message');
  const thread = threadOf(wallet, peer);
  const path = messagePath(thread, id);
  const now = req.now || Date.now();
  try {
    const row = await rtdb(setup.fetchImpl, 'GET', setup.env, path, setup.access);
    if (!row || !row.outer) return fail(404, 'not_found');
    if (row.from !== wallet && row.to !== wallet) return fail(403, 'forbidden');
    if (inboxDue(row, now)) {
      await rtdb(setup.fetchImpl, 'DELETE', setup.env, path, setup.access);
      return fail(410, 'expired');
    }
    const inner = unwrapFromStorage(serverKey, row.outer, row.outerIv);
    if (!inner || inner.id !== id) return fail(502, 'storage_failed');
    return { status: 200, body: { inner } };
  } catch {
    return fail(502, 'storage_failed');
  }
}

export async function handlePrivateReceipt(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const id = String(req.body && req.body.id || '').trim().toLowerCase();
  const peer = String(req.body && req.body.peer || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id) || !isWallet(peer) || peer === wallet) return fail(400, 'bad_message');
  const thread = threadOf(wallet, peer);
  const path = messagePath(thread, id);
  const now = req.now || Date.now();
  try {
    const row = await rtdb(setup.fetchImpl, 'GET', setup.env, path, setup.access);
    if (!row || !row.outer) return fail(404, 'not_found');
    if (row.to !== wallet) return fail(403, 'forbidden');
    if (Number(row.readAt) > 0) {
      return { status: 200, body: { ok: true, readAt: Number(row.readAt), expireAt: Number(row.expireAt) || 0 } };
    }
    const readAt = now;
    const expireAt = readAt + READ_AFTER_MS;
    await rtdb(setup.fetchImpl, 'PUT', setup.env, path, setup.access, {
      ...row,
      readAt,
      expireAt
    });
    return { status: 200, body: { ok: true, readAt, expireAt } };
  } catch {
    return fail(502, 'storage_failed');
  }
}

export async function handleWalletKeyRead(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const peer = String(req.body && req.body.wallet || '').trim().toLowerCase();
  if (!isWallet(peer)) return fail(400, 'bad_wallet');
  try {
    const row = await rtdb(setup.fetchImpl, 'GET', setup.env, 'walletKeys/' + peer, setup.access);
    const pub = row && typeof row.pub === 'string' ? row.pub : '';
    return { status: 200, body: { pub } };
  } catch {
    return fail(502, 'storage_failed');
  }
}

export async function handlePrivateBlob(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, true);
  if (setup.early) return setup.early;
  const sender = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!sender) return fail(401, 'unauthorized');
  const recipient = String(req.body && req.body.to || '').trim().toLowerCase();
  if (!isWallet(recipient) || recipient === sender) return fail(400, 'bad_recipient');
  const bytes = decodeCiphertext(req.body && req.body.ct);
  if (!bytes) return fail(400, 'bad_blob');
  const meta = photoMeta(req.body);
  if (!meta) return fail(400, 'bad_blob');
  const id = randomBytes(16).toString('hex');
  const now = req.now || Date.now();
  try {
    const stored = await putPrivateBlob(setup.token, bytes, setup.fetchImpl);
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'privateBlobs/' + id, setup.access, {
      from: sender,
      to: recipient,
      pathname: stored.pathname,
      url: stored.url,
      createdAt: now,
      iv: meta.iv,
      fromPub: meta.fromPub,
      toPub: meta.toPub
    });
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'photoMailbox/' + recipient + '/' + id, setup.access, {
      from: sender,
      createdAt: now,
      iv: meta.iv,
      fromPub: meta.fromPub,
      toPub: meta.toPub
    });
  } catch {
    return fail(502, 'blob_failed');
  }
  return { status: 200, body: { id } };
}

function photoMeta(body) {
  const iv = String(body && body.iv || '').trim();
  const fromPub = String(body && body.fromPub || '').trim();
  const toPub = String(body && body.toPub || '').trim();
  if (iv.length < 8 || iv.length > 80 || /[^A-Za-z0-9+/=]/.test(iv)) return null;
  if (fromPub.length < 80 || fromPub.length > 400 || /[^A-Za-z0-9+/=]/.test(fromPub)) return null;
  if (toPub.length < 80 || toPub.length > 400 || /[^A-Za-z0-9+/=]/.test(toPub)) return null;
  return { iv, fromPub, toPub };
}

async function dropDelivered(setup, id, row) {
  await deletePrivateBlob(setup.token, row.url, setup.fetchImpl);
  await rtdb(setup.fetchImpl, 'DELETE', setup.env, 'privateBlobs/' + id, setup.access);
  if (row.to) {
    await rtdb(setup.fetchImpl, 'DELETE', setup.env, 'photoMailbox/' + row.to + '/' + id, setup.access);
  }
  if (row.msgThread && row.msgId && /^[A-Za-z0-9_-]{1,128}$/.test(row.msgId)) {
    const path = 'privateInbox/' + row.msgThread + '/messages/' + row.msgId;
    let msg = null;
    try {
      msg = await rtdb(setup.fetchImpl, 'GET', setup.env, path, setup.access);
    } catch {
      msg = null;
    }
    if (msg && msg.seal && msg.seal.id === id && msg.from === row.from && msg.to === row.to) {
      await rtdb(setup.fetchImpl, 'DELETE', setup.env, path, setup.access);
    }
  }
}

export async function handlePrivateBlobRead(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, true);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const id = String(req.body && req.body.id || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) return fail(400, 'bad_blob');
  const now = req.now || Date.now();
  try {
    const row = await rtdb(setup.fetchImpl, 'GET', setup.env, 'privateBlobs/' + id, setup.access);
    if (!row || !row.url) return fail(404, 'not_found');
    if (row.to !== wallet) return fail(403, 'forbidden');
    if (!fresh(row, now)) {
      await dropDelivered(setup, id, row);
      return fail(410, 'expired');
    }
    const ct = await readBlobBytes(setup.token, row.url, setup.fetchImpl);
    return { status: 200, body: { ct } };
  } catch {
    return fail(502, 'blob_failed');
  }
}

export async function handlePrivateBlobDelete(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, true);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const id = String(req.body && req.body.id || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) return fail(400, 'bad_blob');
  try {
    const row = await rtdb(setup.fetchImpl, 'GET', setup.env, 'privateBlobs/' + id, setup.access);
    if (!row || !row.url) return { status: 200, body: { ok: true } };
    if (row.to !== wallet) return fail(403, 'forbidden');
    await dropDelivered(setup, id, row);
    return { status: 200, body: { ok: true } };
  } catch {
    return fail(502, 'blob_failed');
  }
}

export async function handlePrivateBlobAck(req, deps = {}) {
  return handlePrivateBlobDelete(req, deps);
}

export async function handlePrivateBlobLink(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const sender = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!sender) return fail(401, 'unauthorized');
  const id = String(req.body && req.body.id || '').trim().toLowerCase();
  const thread = String(req.body && req.body.thread || '').trim().toLowerCase();
  const msgId = String(req.body && req.body.msgId || '').trim();
  if (!/^[a-f0-9]{32}$/.test(id)) return fail(400, 'bad_blob');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(msgId)) return fail(400, 'bad_blob');
  const parts = thread.split('_');
  if (parts.length !== 2 || !isWallet(parts[0]) || !isWallet(parts[1])) return fail(400, 'bad_blob');
  try {
    const row = await rtdb(setup.fetchImpl, 'GET', setup.env, 'privateBlobs/' + id, setup.access);
    if (!row || row.from !== sender) return fail(403, 'forbidden');
    if (parts[0] !== row.from && parts[0] !== row.to) return fail(400, 'bad_blob');
    if (parts[1] !== row.from && parts[1] !== row.to) return fail(400, 'bad_blob');
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'privateBlobs/' + id, setup.access, {
      ...row,
      msgThread: thread,
      msgId
    });
  } catch {
    return fail(502, 'storage_failed');
  }
  return { status: 200, body: { ok: true } };
}

export async function handlePhotoMailbox(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'GET' && req.method !== 'POST') return fail(405, 'method');
  const setup = await ready(req, deps, false);
  if (setup.early) return setup.early;
  const wallet = await walletFromRequest(req, setup.account, setup.fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  let rows;
  try {
    rows = await rtdb(setup.fetchImpl, 'GET', setup.env, 'photoMailbox/' + wallet, setup.access);
  } catch {
    return fail(502, 'storage_failed');
  }
  const items = [];
  const table = rows && typeof rows === 'object' ? rows : {};
  for (const [id, row] of Object.entries(table)) {
    if (!/^[a-f0-9]{32}$/.test(id) || !row || typeof row !== 'object') continue;
    items.push({
      id,
      from: String(row.from || ''),
      createdAt: Number(row.createdAt) || 0,
      iv: String(row.iv || ''),
      fromPub: String(row.fromPub || ''),
      toPub: String(row.toPub || '')
    });
  }
  return { status: 200, body: { items } };
}

function mailboxLeaves(node, trail, out) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.createdAt === 'number' && typeof node.from === 'string') {
    out.push({ trail, row: node });
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    mailboxLeaves(value, trail.concat(key), out);
  }
}

export async function handlePrivateExpire(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'GET' && req.method !== 'POST') return fail(405, 'method');
  const env = deps.env || process.env;
  const secret = String(env.CRON_SECRET || '').trim();
  const header = bearerToken(req.headers);
  if (!secret || header !== secret) return fail(401, 'unauthorized');
  const setup = await ready(req, deps, true);
  if (setup.early) return setup.early;
  const now = req.now || Date.now();
  let rows;
  try {
    rows = await rtdb(setup.fetchImpl, 'GET', setup.env, 'privateBlobs', setup.access);
  } catch {
    return fail(502, 'storage_failed');
  }
  const entries = rows && typeof rows === 'object' ? Object.entries(rows) : [];
  let removed = 0;
  for (const [id, row] of entries) {
    if (!row || fresh(row, now)) continue;
    try {
      await dropDelivered(setup, id, row);
      removed += 1;
    } catch {
      /* the next daily run tries again */
    }
  }
  try {
    const tree = await rtdb(setup.fetchImpl, 'GET', setup.env, 'photoMailbox', setup.access);
    const leaves = [];
    mailboxLeaves(tree, [], leaves);
    for (const leaf of leaves) {
      if (!leaf.row || fresh(leaf.row, now) || leaf.trail.length < 2) continue;
      const path = 'photoMailbox/' + leaf.trail.join('/');
      try {
        await rtdb(setup.fetchImpl, 'DELETE', setup.env, path, setup.access);
        removed += 1;
      } catch {
        /* the next daily run tries again */
      }
    }
  } catch {
    /* blob rows were already cleared */
  }
  try {
    const signals = await rtdb(setup.fetchImpl, 'GET', setup.env, 'privateSignal', setup.access);
    const callers = signals && typeof signals === 'object' ? Object.entries(signals) : [];
    for (const [to, froms] of callers) {
      if (!isWallet(to) || !froms || typeof froms !== 'object') continue;
      for (const [from, node] of Object.entries(froms)) {
        if (!isWallet(from) || from === to) continue;
        const stamp = newestStamp(node);
        if (stamp > 0 && now - stamp < BLOB_TTL_MS) continue;
        try {
          await rtdb(setup.fetchImpl, 'DELETE', setup.env, 'privateSignal/' + to + '/' + from, setup.access);
          removed += 1;
        } catch {
          /* the next daily run tries again */
        }
      }
    }
  } catch {
    /* the next daily run tries again */
  }
  try {
    const inbox = await rtdb(setup.fetchImpl, 'GET', setup.env, 'privateInbox', setup.access);
    const threads = inbox && typeof inbox === 'object' ? Object.entries(inbox) : [];
    for (const [thread, threadNode] of threads) {
      if (!/^0x[a-f0-9]{40}_0x[a-f0-9]{40}$/.test(thread)) continue;
      const messages = threadNode && threadNode.messages;
      if (!messages || typeof messages !== 'object') continue;
      for (const [msgId, msg] of Object.entries(messages)) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(msgId)) continue;
        if (!inboxDue(msg, now)) continue;
        try {
          await rtdb(setup.fetchImpl, 'DELETE', setup.env, 'privateInbox/' + thread + '/messages/' + msgId, setup.access);
          removed += 1;
        } catch {
          /* the next daily run tries again */
        }
      }
    }
  } catch {
    /* the next daily run tries again */
  }
  return { status: 200, body: { removed } };
}

function newestStamp(node) {
  let newest = 0;
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.at === 'number') newest = Math.max(newest, value.at);
    if (typeof value.createdAt === 'number') newest = Math.max(newest, value.createdAt);
    for (const child of Object.values(value)) walk(child);
  };
  walk(node);
  return newest;
}
