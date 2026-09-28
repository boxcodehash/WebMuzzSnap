import {
  createCustomToken,
  databaseUrl,
  getGoogleAccessToken,
  loadServiceAccount,
  signatureKey,
  tokenId,
  verifyFirebaseIdToken
} from './google.js';
import { classifyLogin } from './login-proof.js';

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

export async function handleSession(req, deps = {}) {
  if (req.method === 'OPTIONS') return { status: 204, body: null };
  if (req.method !== 'POST') return fail(405, 'method');
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const account = loadServiceAccount(env);
  if (!account) return fail(503, 'push_not_configured');
  const message = req.body && req.body.message;
  const signature = req.body && req.body.signature;
  const judged = classifyLogin(message, signature, req.now || Date.now());
  if (!judged.proof) {
    const reason = sessionError(judged.reason);
    console.warn('session rejected: ' + reason);
    return fail(401, reason);
  }
  const proof = judged.proof;
  const key = proof.nonce || signatureKey(signature);
  try {
    const access = await getGoogleAccessToken(account, fetchImpl, req.now);
    const used = await rtdb(fetchImpl, 'GET', env, 'loginNonces/' + key, access);
    if (used) {
      console.warn('session rejected: nonce_used');
      return fail(401, 'nonce_used');
    }
    await rtdb(fetchImpl, 'PUT', env, 'loginNonces/' + key, access, { wallet: proof.wallet, exp: proof.exp });
    return {
      status: 200,
      body: { customToken: createCustomToken(account, proof.wallet, req.now || Date.now()) }
    };
  } catch {
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
