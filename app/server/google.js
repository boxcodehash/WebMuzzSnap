import { createHash, createSign, createVerify, createPublicKey, X509Certificate } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/firebase.database'
].join(' ');
const CUSTOM_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

const accessCache = { key: '', token: '', exp: 0 };
const certCache = { map: null, exp: 0 };

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signJwt(header, payload, privateKeyPem) {
  const data = b64urlJson(header) + '.' + b64urlJson(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  return data + '.' + signer.sign(privateKeyPem).toString('base64url');
}

export function loadServiceAccount(env) {
  const raw = env && env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !String(raw).trim()) return null;
  let text = String(raw).trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || json.type !== 'service_account') return null;
  if (!json.client_email || !json.private_key || !json.project_id || !json.private_key_id) return null;
  if (!/^[a-z0-9-]{4,64}$/.test(String(json.project_id))) return null;
  return {
    client_email: String(json.client_email),
    private_key: String(json.private_key).replace(/\\n/g, '\n'),
    private_key_id: String(json.private_key_id),
    project_id: String(json.project_id)
  };
}

export function databaseUrl(env) {
  const fallback = 'https://pulsari-default-rtdb.firebaseio.com';
  const raw = String((env && env.FIREBASE_DATABASE_URL) || fallback).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return fallback;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.firebaseio.com')) return fallback;
  return parsed.origin;
}

export function createCustomToken(account, uid, nowMs) {
  const iat = Math.floor(Number(nowMs) / 1000);
  return signJwt(
    { alg: 'RS256', typ: 'JWT', kid: account.private_key_id },
    {
      iss: account.client_email,
      sub: account.client_email,
      aud: CUSTOM_AUD,
      iat,
      exp: iat + 3600,
      uid,
      claims: { wallet: uid }
    },
    account.private_key
  );
}

export async function getGoogleAccessToken(account, fetchImpl, nowMs) {
  const now = Number(nowMs) || Date.now();
  if (accessCache.key === account.client_email && accessCache.token && accessCache.exp > now + 60000) {
    return accessCache.token;
  }
  const iat = Math.floor(now / 1000);
  const assertion = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: account.client_email,
      sub: account.client_email,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
      scope: OAUTH_SCOPE
    },
    account.private_key
  );
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const error = new Error('oauth');
    error.code = 'oauth';
    throw error;
  }
  accessCache.key = account.client_email;
  accessCache.token = data.access_token;
  accessCache.exp = now + (Number(data.expires_in) || 3600) * 1000;
  return data.access_token;
}

export function resetGoogleCaches() {
  accessCache.key = '';
  accessCache.token = '';
  accessCache.exp = 0;
  certCache.map = null;
  certCache.exp = 0;
}

function keyFromPem(pem) {
  if (String(pem).includes('BEGIN CERTIFICATE')) return new X509Certificate(pem).publicKey;
  return createPublicKey(pem);
}

function verifyRs256(data, signature, pem) {
  const verify = createVerify('RSA-SHA256');
  verify.update(data);
  verify.end();
  return verify.verify(keyFromPem(pem), Buffer.from(signature, 'base64url'));
}

async function googleCerts(fetchImpl, now) {
  if (certCache.map && certCache.exp > now) return certCache.map;
  const res = await fetchImpl(CERT_URL);
  if (!res.ok) {
    const error = new Error('certs');
    error.code = 'certs';
    throw error;
  }
  const map = await res.json();
  const cacheControl = res.headers && res.headers.get ? (res.headers.get('cache-control') || '') : '';
  const match = /max-age=(\d+)/.exec(cacheControl);
  certCache.map = map;
  certCache.exp = now + (match ? Number(match[1]) * 1000 : 3600000);
  return map;
}

export function walletFromIdPayload(payload) {
  const uid = String(payload.user_id || payload.sub || payload.uid || '').toLowerCase();
  const claim = payload.wallet ? String(payload.wallet).toLowerCase() : '';
  if (claim && uid && claim !== uid) return '';
  const wallet = claim || uid;
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : '';
}

export async function verifyFirebaseIdToken(token, { projectId, fetchImpl, now }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return '';
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return '';
  }
  if (!header || header.alg !== 'RS256' || !header.kid) return '';
  const clock = Math.floor((Number(now) || Date.now()) / 1000);
  if (payload.aud !== projectId) return '';
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) return '';
  if (!payload.exp || payload.exp + 60 < clock) return '';
  if (payload.iat && payload.iat > clock + 60) return '';
  const wallet = walletFromIdPayload(payload);
  if (!wallet) return '';
  let certs;
  try {
    certs = await googleCerts(fetchImpl, Number(now) || Date.now());
  } catch {
    return '';
  }
  const pem = certs && certs[header.kid];
  if (!pem) return '';
  try {
    if (!verifyRs256(parts[0] + '.' + parts[1], parts[2], pem)) return '';
  } catch {
    return '';
  }
  return wallet;
}

export function tokenId(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}

export function signatureKey(signature) {
  return createHash('sha256').update(String(signature).toLowerCase()).digest('hex').slice(0, 40);
}
