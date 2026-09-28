import { randomBytes } from 'node:crypto';
import {
  databaseUrl,
  getGoogleAccessToken,
  loadServiceAccount,
  verifyFirebaseIdToken
} from './google.js';
import { bearerToken, fail, isWallet } from './push.js';

export const BLOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 400 * 1024;
const BLOB_API = 'https://vercel.com/api/blob/';

function rtdbUrl(env, path, accessToken) {
  const url = new URL(databaseUrl(env) + '/' + path.split('/').map(encodeURIComponent).join('/') + '.json');
  url.searchParams.set('access_token', accessToken);
  return url.toString();
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
  try {
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'walletKeys/' + wallet, setup.access, {
      pub,
      alg: 'P-256',
      updatedAt: req.now || Date.now()
    });
  } catch {
    return fail(502, 'storage_failed');
  }
  return { status: 200, body: { ok: true } };
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
  const id = randomBytes(16).toString('hex');
  const now = req.now || Date.now();
  try {
    const stored = await putPrivateBlob(setup.token, bytes, setup.fetchImpl);
    await rtdb(setup.fetchImpl, 'PUT', setup.env, 'privateBlobs/' + id, setup.access, {
      from: sender,
      to: recipient,
      pathname: stored.pathname,
      url: stored.url,
      createdAt: now
    });
  } catch {
    return fail(502, 'blob_failed');
  }
  return { status: 200, body: { id } };
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
    if (row.from !== wallet && row.to !== wallet) return fail(403, 'forbidden');
    if (!fresh(row, now)) {
      await deletePrivateBlob(setup.token, row.url, setup.fetchImpl);
      await rtdb(setup.fetchImpl, 'DELETE', setup.env, 'privateBlobs/' + id, setup.access);
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
    await deletePrivateBlob(setup.token, row.url, setup.fetchImpl);
    await rtdb(setup.fetchImpl, 'DELETE', setup.env, 'privateBlobs/' + id, setup.access);
    return { status: 200, body: { ok: true } };
  } catch {
    return fail(502, 'blob_failed');
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
      await deletePrivateBlob(setup.token, row.url, setup.fetchImpl);
      await rtdb(setup.fetchImpl, 'DELETE', setup.env, 'privateBlobs/' + id, setup.access);
      removed += 1;
    } catch {
      /* the next daily run tries again */
    }
  }
  return { status: 200, body: { removed } };
}
