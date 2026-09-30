import { createHash, randomBytes } from 'node:crypto';
import {
  createCustomToken,
  databaseUrl,
  getGoogleAccessToken,
  loadServiceAccount,
  tokenId,
  verifyFirebaseIdToken
} from './google.js';
import { classifyLogin } from './login-proof.js';
import { readMuzzHolding } from './muzz-balance.js';

export const NOTIFICATION_TITLE = 'MuzzSnap';
export const NOTIFICATION_BODY = 'New private message';
export const PUBLIC_APP = 'https://muzzsnap-app.vercel.app';
// Public Web Push key from Firebase → Project settings → Cloud Messaging → Web Push certificates.
// Not a secret. FIREBASE_VAPID_KEY overrides it. The private key stays in Firebase.
export const PUBLIC_VAPID_KEY = 'BD4Waq9Zdd8iVPmAvv3K4brWllOezeIREB_X_m6ijlit0ffs9Ff9GQJc8pjzCefT03A3lshYXCNDmUOPk6sIkew';
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;

export function fail(status, error) {
  return { status, body: { error } };
}

function sessionError(reason) {
  if (reason === 'expired' || reason === 'bad_signature' || reason === 'bad_format' || reason === 'nonce_used') {
    return reason;
  }
  return 'bad_format';
}

function warnSessionFailure(err) {
  const code = err && err.code != null && String(err.code) ? String(err.code) : 'error';
  const status = err && err.status != null ? ' ' + String(err.status) : '';
  console.warn('session failed: ' + code + status);
}

export function bearerToken(headers) {
  const raw = (headers && (headers.authorization || headers.Authorization)) || '';
  const match = /^Bearer\s+(\S+)$/i.exec(String(raw).trim());
  return match ? match[1] : '';
}

export function isWallet(value) {
  return /^0x[a-f0-9]{40}$/.test(String(value || ''));
}

export function nextRate(prev, now, limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const windowStart = Number(prev && prev.windowStart) || 0;
  const count = Number(prev && prev.count) || 0;
  const clock = Number(now) || Date.now();
  if (!windowStart || clock - windowStart >= windowMs) {
    return { windowStart: clock, count: 1, allowed: true };
  }
  if (count >= limit) return { windowStart, count, allowed: false };
  return { windowStart, count: count + 1, allowed: true };
}

export function buildFcmMessage({ token, peer, platform }) {
  const body = NOTIFICATION_BODY;
  const title = NOTIFICATION_TITLE;
  const wallet = String(peer || '').toLowerCase();
  const data = {
    peer: /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : '',
    open: 'private.html',
    title,
    body
  };
  if (platform === 'android') {
    return {
      message: {
        token,
        notification: { title, body },
        data,
        android: {
          priority: 'HIGH',
          notification: {
            channel_id: 'private',
            icon: 'ic_stat_muzzsnap',
            notification_priority: 'PRIORITY_HIGH',
            visibility: 'PRIVATE'
          }
        }
      }
    };
  }
  const link = data.peer
    ? PUBLIC_APP + '/private.html?peer=' + encodeURIComponent(data.peer)
    : PUBLIC_APP + '/private.html';
  return {
    message: {
      token,
      data,
      webpush: {
        headers: { Urgency: 'high' },
        fcm_options: { link }
      }
    }
  };
}

function rtdbPath(env, path, accessToken, extra) {
  const url = new URL(databaseUrl(env) + '/' + path.split('/').map(encodeURIComponent).join('/') + '.json');
  url.searchParams.set('access_token', accessToken);
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  return url.toString();
}

function responseHeader(res, name) {
  const headers = res && res.headers;
  if (!headers) return '';
  const wanted = String(name || '').toLowerCase();
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(wanted) || '';
  }
  return headers[name] || headers[wanted] || '';
}

async function rtdb(fetchImpl, method, env, path, accessToken, value, extra) {
  const res = await fetchImpl(rtdbPath(env, path, accessToken, extra), {
    method,
    headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  const data = method === 'DELETE' ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error('rtdb');
    error.code = 'rtdb';
    error.status = res.status;
    throw error;
  }
  return data;
}

/** GET/PUT/DELETE that can use a Firebase ETag. 412 is a lost race, not an exception. */
async function rtdbTagged(fetchImpl, method, env, path, accessToken, value, headers) {
  const res = await fetchImpl(rtdbPath(env, path, accessToken), {
    method,
    headers: headers || {},
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  const data = method === 'DELETE' ? null : await res.json().catch(() => null);
  if (res.status === 412) return { conflict: true, status: 412, data: null, etag: '' };
  if (!res.ok) {
    const error = new Error('rtdb');
    error.code = 'rtdb';
    error.status = res.status;
    throw error;
  }
  return { conflict: false, status: res.status, data, etag: responseHeader(res, 'etag') };
}

function indexExists(value) {
  return Boolean(value) && typeof value === 'object';
}

export async function sendFcm(projectId, accessToken, payload, fetchImpl) {
  const res = await fetchImpl('https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, unregistered: false };
  const blob = JSON.stringify(data);
  return { ok: false, unregistered: res.status === 404 || /UNREGISTERED|NOT_FOUND/.test(blob) };
}

async function senderWallet(req, account, fetchImpl) {
  const token = bearerToken(req.headers);
  if (!token) return '';
  return verifyFirebaseIdToken(token, {
    projectId: account.project_id,
    fetchImpl,
    now: req.now
  });
}

export async function handleNotify(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const account = loadServiceAccount(env);
  if (!account) return fail(503, 'push_not_configured');
  const sender = await senderWallet(req, account, fetchImpl);
  if (!sender) return fail(401, 'unauthorized');
  const recipient = String(req.body && req.body.to || '').trim().toLowerCase();
  if (!isWallet(recipient) || recipient === sender) return fail(400, 'bad_recipient');
  let access;
  try {
    access = await getGoogleAccessToken(account, fetchImpl, req.now);
    const mine = await rtdb(fetchImpl, 'GET', env, 'privateIndex/' + sender + '/' + recipient, access, undefined, { shallow: 'true' });
    const theirs = await rtdb(fetchImpl, 'GET', env, 'privateIndex/' + recipient + '/' + sender, access, undefined, { shallow: 'true' });
    if (!indexExists(mine) || !indexExists(theirs)) return fail(403, 'not_a_conversation');
    return await deliver(fetchImpl, env, access, account, sender, recipient, sender, req.now);
  } catch {
    return fail(502, 'push_failed');
  }
}

async function deliver(fetchImpl, env, access, account, rateWallet, tokenWallet, peer, now) {
  const prev = await rtdb(fetchImpl, 'GET', env, 'notifyRate/' + rateWallet, access);
  const rate = nextRate(prev, now || Date.now());
  if (!rate.allowed) return fail(429, 'rate_limited');
  await rtdb(fetchImpl, 'PUT', env, 'notifyRate/' + rateWallet, access, {
    windowStart: rate.windowStart,
    count: rate.count
  });
  const stored = await rtdb(fetchImpl, 'GET', env, 'fcmTokens/' + tokenWallet, access);
  const rows = stored && typeof stored === 'object' ? Object.entries(stored) : [];
  let sent = 0;
  for (const [id, row] of rows) {
    if (!row || typeof row.token !== 'string' || !row.token) continue;
    const platform = row.platform === 'android' ? 'android' : 'web';
    const payload = buildFcmMessage({ token: row.token, peer, platform });
    const result = await sendFcm(account.project_id, access, payload, fetchImpl);
    if (result.unregistered && /^[a-f0-9]{32}$/.test(id)) {
      await rtdb(fetchImpl, 'DELETE', env, 'fcmTokens/' + tokenWallet + '/' + id, access);
    } else if (result.ok) {
      sent += 1;
    }
  }
  return { status: 200, body: { ok: true, sent } };
}

export async function handleNotifySelf(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const account = loadServiceAccount(env);
  if (!account) return fail(503, 'push_not_configured');
  const sender = await senderWallet(req, account, fetchImpl);
  if (!sender) return fail(401, 'unauthorized');
  try {
    const access = await getGoogleAccessToken(account, fetchImpl, req.now);
    return await deliver(fetchImpl, env, access, account, sender, sender, '', req.now);
  } catch {
    return fail(502, 'push_failed');
  }
}

function requestOp(req) {
  if (req.query && req.query.op) return String(req.query.op);
  try {
    return new URL(req.url || '/', 'https://muzzsnap.local').searchParams.get('op') || '';
  } catch {
    return '';
  }
}

const SESSION_WINDOW_MS = 60 * 1000;
const NONCE_LIMIT = 30;
const POST_LIMIT = 20;

function clientIp(req) {
  const headers = req.headers || {};
  const raw = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || headers['x-real-ip'] || headers['X-Real-Ip'] || '';
  return String(raw).split(',')[0].trim().slice(0, 80) || 'unknown';
}

function rateBucket(ip, kind) {
  return createHash('sha256').update(String(ip) + ':' + kind).digest('hex').slice(0, 32);
}

async function allowSession(fetchImpl, env, access, ip, kind, now) {
  const clock = Number(now) || Date.now();
  const path = 'sessionRate/' + rateBucket(ip, kind);
  const prev = await rtdb(fetchImpl, 'GET', env, path, access);
  const windowStart = prev && Number(prev.windowStart) ? Number(prev.windowStart) : 0;
  const count = prev && Number(prev.count) ? Number(prev.count) : 0;
  const fresh = !windowStart || clock - windowStart >= SESSION_WINDOW_MS;
  const next = { windowStart: fresh ? clock : windowStart, count: fresh ? 1 : count + 1 };
  const limit = kind === 'post' ? POST_LIMIT : NONCE_LIMIT;
  if (next.count > limit) return false;
  await rtdb(fetchImpl, 'PUT', env, path, access, next);
  return true;
}

async function issueNonce(req, env, fetchImpl, access) {
  if (requestOp(req) !== 'nonce') return fail(405, 'method');
  const now = Number(req.now) || Date.now();
  if (!await allowSession(fetchImpl, env, access, clientIp(req), 'nonce', now)) return fail(429, 'rate_limited');
  const nonce = randomBytes(16).toString('hex');
  const exp = now + 10 * 60 * 1000;
  await rtdb(fetchImpl, 'PUT', env, 'loginIssued/' + nonce, access, { exp });
  return { status: 200, body: { nonce, exp } };
}

async function consumeNonce(fetchImpl, env, access, nonce, wallet, exp) {
  const usedPath = 'loginNonces/' + nonce;
  const current = await rtdbTagged(fetchImpl, 'GET', env, usedPath, access, undefined, { 'X-Firebase-ETag': 'true' });
  if (current.data) return 'nonce_used';
  const issued = await rtdb(fetchImpl, 'GET', env, 'loginIssued/' + nonce, access);
  if (!issued || typeof issued !== 'object' || Number(issued.exp) !== Number(exp)) return 'bad_format';
  const headers = { 'Content-Type': 'application/json' };
  if (current.etag) headers['if-match'] = current.etag;
  const put = await rtdbTagged(fetchImpl, 'PUT', env, usedPath, access, { wallet, exp: Number(exp) }, headers);
  if (put.conflict) return 'nonce_used';
  try {
    await rtdbTagged(fetchImpl, 'DELETE', env, 'loginIssued/' + nonce, access);
  } catch {
    /* The nonce row already blocks a second use. The issued row is only a leftover. */
  }
  return '';
}

async function holdingFor(wallet, deps, fetchImpl) {
  const holding = deps.readBalance
    ? await deps.readBalance(wallet)
    : await readMuzzHolding(wallet, fetchImpl);
  if (!holding || holding.unreachable) return fail(503, 'balance_unavailable');
  if (!holding.ok) {
    return {
      status: 403,
      body: { error: 'balance', formatted: holding.formatted || '0', minimum: '10,000,000' }
    };
  }
  return { status: 200, body: { ok: true, exempt: holding.exempt === true } };
}

export async function handleSession(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const account = loadServiceAccount(env);
  if (!account) return fail(503, 'push_not_configured');
  const now = Number(req.now) || Date.now();
  try {
    const access = await getGoogleAccessToken(account, fetchImpl, req.now);
    if (req.method === 'GET' && requestOp(req) === 'balance') {
      const wallet = await senderWallet(req, account, fetchImpl);
      if (!wallet) return fail(401, 'unauthorized');
      const checked = await holdingFor(wallet, deps, fetchImpl);
      if (checked.status !== 200) console.warn('session rejected: ' + (checked.body && checked.body.error));
      return checked;
    }
    if (req.method === 'GET') return await issueNonce(req, env, fetchImpl, access);
    if (req.method !== 'POST') return fail(405, 'method');
    if (!await allowSession(fetchImpl, env, access, clientIp(req), 'post', now)) return fail(429, 'rate_limited');
    const message = req.body && req.body.message;
    const signature = req.body && req.body.signature;
    const judged = classifyLogin(message, signature, now);
    if (!judged.proof) {
      const reason = sessionError(judged.reason);
      console.warn('session rejected: ' + reason);
      return fail(401, reason);
    }
    const proof = judged.proof;
    const checked = await holdingFor(proof.wallet, deps, fetchImpl);
    if (checked.status !== 200) {
      console.warn('session rejected: ' + (checked.body && checked.body.error));
      return checked;
    }
    const consumed = await consumeNonce(fetchImpl, env, access, proof.nonce, proof.wallet, proof.exp);
    if (consumed) {
      console.warn('session rejected: ' + consumed);
      return fail(401, consumed);
    }
    return {
      status: 200,
      body: { customToken: createCustomToken(account, proof.wallet, now) }
    };
  } catch (err) {
    if (err && err.code === 'balance_unavailable') {
      console.warn('session rejected: balance_unavailable');
      return fail(503, 'balance_unavailable');
    }
    warnSessionFailure(err);
    return fail(502, 'session_failed');
  }
}

export async function handleRegisterToken(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const account = loadServiceAccount(env);
  if (!account) return fail(503, 'push_not_configured');
  const wallet = await senderWallet(req, account, fetchImpl);
  if (!wallet) return fail(401, 'unauthorized');
  const token = String(req.body && req.body.token || '');
  const platform = req.body && req.body.platform === 'android'
    ? 'android'
    : (req.body && req.body.platform === 'web' ? 'web' : '');
  if (!platform || token.length < 20 || token.length > 4096 || /[\u0000-\u001f]/.test(token)) {
    return fail(400, 'bad_token');
  }
  try {
    const access = await getGoogleAccessToken(account, fetchImpl, req.now);
    const id = tokenId(token);
    await rtdb(fetchImpl, 'PUT', env, 'fcmTokens/' + wallet + '/' + id, access, {
      token,
      platform,
      updatedAt: Number(req.now) || Date.now()
    });
    return { status: 200, body: { ok: true } };
  } catch {
    return fail(502, 'register_failed');
  }
}

export function vapidKey(env) {
  const fromEnv = String((env && env.FIREBASE_VAPID_KEY) || '').trim();
  return fromEnv || PUBLIC_VAPID_KEY;
}

export function handlePushConfig(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'GET') return fail(405, 'method');
  const env = deps.env || process.env;
  return { status: 200, body: { vapidKey: vapidKey(env) } };
}
