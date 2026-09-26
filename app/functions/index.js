import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { randomBytes } from 'node:crypto';
import { CHAIN_ID, DEFAULT_MIN_MUZZ, TOKEN_ADDRESS } from './src/policy.js';
import { originOf } from './src/loginMessage.js';
import { hasEnoughBalance, recoverAccess } from './src/accessLogic.js';
import { readHolding as fetchHolding } from './src/holding.js';

initializeApp();

const REGION = 'us-central1';
const FALLBACK_ORIGINS = [
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'https://localhost',
  'capacitor://localhost',
  'http://localhost'
];

function settings() {
  const fromEnv = String(process.env.APP_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    minMuzz: String(process.env.MIN_MUZZ || DEFAULT_MIN_MUZZ),
    tokenAddress: String(process.env.TOKEN_ADDRESS || TOKEN_ADDRESS).toLowerCase(),
    rpcUrl: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
    origins: fromEnv.length ? fromEnv : FALLBACK_ORIGINS,
    accessTtlMs: Number(process.env.ACCESS_TTL_MINUTES || 60) * 60 * 1000,
    chainId: CHAIN_ID
  };
}

function fail(status, error, extra = {}) {
  const err = new Error(error);
  err.http = status;
  err.extra = extra;
  throw err;
}

function withHttp(handler) {
  return async (req, res) => {
    const cfg = settings();
    const origin = req.get('origin') || '';
    if (origin && !cfg.origins.includes(origin)) {
      res.status(403).json({ ok: false, error: 'origin' });
      return;
    }
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method' });
      return;
    }
    try {
      await handler(req, res, cfg);
    } catch (err) {
      if (err && err.http) {
        res.status(err.http).json({ ok: false, error: err.message, ...err.extra });
        return;
      }
      console.error(err);
      res.status(500).json({ ok: false, error: 'server' });
    }
  };
}

async function readHolding(cfg, address) {
  try {
    return await fetchHolding({
      rpcUrl: cfg.rpcUrl,
      chainId: cfg.chainId,
      tokenAddress: cfg.tokenAddress,
      address
    });
  } catch (err) {
    console.error('rpc', err);
    fail(503, 'rpc_failed');
  }
}

async function bearerWallet(req) {
  const header = String(req.get('authorization') || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) fail(401, 'auth');
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    fail(401, 'auth');
  }
  if (decoded.muzzAccess !== true || decoded.uid !== decoded.wallet) fail(403, 'claim');
  return decoded;
}

async function accessStillValid(wallet) {
  const snap = await getFirestore().collection('access').doc(wallet).get();
  if (!snap.exists) return false;
  const data = snap.data();
  return data.active === true && data.expiresAt && data.expiresAt.toMillis() > Date.now();
}

export const createNonce = onRequest({ region: REGION, invoker: 'public', timeoutSeconds: 20 }, withHttp(async (req, res, cfg) => {
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await getFirestore().collection('nonces').doc(nonce).set({
    used: false,
    createdAt: Timestamp.now(),
    expiresAt
  });
  res.json({
    ok: true,
    nonce,
    expiresAt: expiresAt.toMillis(),
    minMuzz: cfg.minMuzz,
    tokenAddress: cfg.tokenAddress,
    chainId: cfg.chainId
  });
}));

export const verifyAccess = onRequest({ region: REGION, invoker: 'public', timeoutSeconds: 30, memory: '256MiB' }, withHttp(async (req, res, cfg) => {
  const message = req.body && req.body.message;
  const signature = req.body && req.body.signature;
  if (typeof message !== 'string' || typeof signature !== 'string') fail(400, 'format');
  if (message.length > 4000 || signature.length > 400) fail(400, 'format');

  let access;
  try {
    access = recoverAccess(message, signature, cfg);
  } catch (err) {
    const code = err && err.message;
    if (code === 'issued_skew' || code === 'format') fail(400, code === 'issued_skew' ? 'issued_skew' : 'format');
    fail(401, code || 'signature');
  }
  if (!cfg.origins.includes(originOf(access.parsed.uri))) fail(403, 'origin');

  const address = access.recovered;
  const parsed = access.parsed;
  const db = getFirestore();
  const nonceRef = db.collection('nonces').doc(parsed.nonce);
  const nonceSnap = await nonceRef.get();
  if (!nonceSnap.exists || nonceSnap.data().used === true || nonceSnap.data().expiresAt.toMillis() < Date.now()) {
    fail(401, 'nonce');
  }

  const holding = await readHolding(cfg, address);
  const enough = hasEnoughBalance(holding.balance, holding.decimals, cfg.minMuzz);

  let nonceConsumed = false;
  await db.runTransaction(async (tx) => {
    nonceConsumed = false;
    const fresh = await tx.get(nonceRef);
    if (!fresh.exists || fresh.data().used === true || fresh.data().expiresAt.toMillis() < Date.now()) return;
    tx.update(nonceRef, { used: true, usedBy: address, usedAt: Timestamp.now() });
    nonceConsumed = true;
  });
  if (!nonceConsumed) fail(401, 'nonce');

  const accessRef = db.collection('access').doc(address);
  if (!enough) {
    await accessRef.set({
      active: false,
      wallet: address,
      balance: holding.balance.toString(),
      decimals: holding.decimals,
      minMuzz: cfg.minMuzz,
      verifiedAt: Timestamp.now(),
      expiresAt: Timestamp.now(),
      reason: 'below_minimum'
    });
    try { await getAuth().revokeRefreshTokens(address); } catch { /* aún no existe */ }
    fail(403, 'below_minimum', {
      balance: holding.balance.toString(),
      decimals: holding.decimals,
      minMuzz: cfg.minMuzz
    });
  }

  const expiresAt = Timestamp.fromMillis(Date.now() + cfg.accessTtlMs);
  await accessRef.set({
    active: true,
    wallet: address,
    balance: holding.balance.toString(),
    decimals: holding.decimals,
    minMuzz: cfg.minMuzz,
    verifiedAt: Timestamp.now(),
    expiresAt,
    reason: 'ok'
  });

  const token = await getAuth().createCustomToken(address, {
    muzzAccess: true,
    wallet: address,
    verifiedAt: Date.now()
  });

  res.json({
    ok: true,
    token,
    expiresAt: expiresAt.toMillis(),
    balance: holding.balance.toString(),
    decimals: holding.decimals,
    minMuzz: cfg.minMuzz
  });
}));

export const recheckBalance = onRequest({ region: REGION, invoker: 'public', timeoutSeconds: 30, memory: '256MiB' }, withHttp(async (req, res, cfg) => {
  const decoded = await bearerWallet(req);
  const wallet = decoded.wallet;
  const holding = await readHolding(cfg, wallet);
  const enough = hasEnoughBalance(holding.balance, holding.decimals, cfg.minMuzz);
  const db = getFirestore();
  if (!enough) {
    await db.collection('access').doc(wallet).set({
      active: false,
      wallet,
      balance: holding.balance.toString(),
      decimals: holding.decimals,
      minMuzz: cfg.minMuzz,
      verifiedAt: Timestamp.now(),
      expiresAt: Timestamp.now(),
      reason: 'below_minimum'
    }, { merge: true });
    try { await getAuth().revokeRefreshTokens(wallet); } catch (err) { console.error(err); }
    fail(403, 'below_minimum', {
      balance: holding.balance.toString(),
      decimals: holding.decimals,
      minMuzz: cfg.minMuzz
    });
  }
  const expiresAt = Timestamp.fromMillis(Date.now() + cfg.accessTtlMs);
  await db.collection('access').doc(wallet).set({
    active: true,
    wallet,
    balance: holding.balance.toString(),
    decimals: holding.decimals,
    minMuzz: cfg.minMuzz,
    verifiedAt: Timestamp.now(),
    expiresAt,
    reason: 'ok'
  }, { merge: true });
  res.json({
    ok: true,
    expiresAt: expiresAt.toMillis(),
    balance: holding.balance.toString(),
    decimals: holding.decimals,
    minMuzz: cfg.minMuzz
  });
}));

export const issueServerFactor = onRequest({ region: REGION, invoker: 'public', timeoutSeconds: 20 }, withHttp(async (req, res) => {
  const decoded = await bearerWallet(req);
  if (!(await accessStillValid(decoded.wallet))) fail(403, 'access_expired');

  const messageId = req.body && req.body.messageId;
  const conversationId = req.body && req.body.conversationId;
  const recipients = req.body && req.body.recipients;
  if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/.test(messageId)) fail(400, 'format');
  if (typeof conversationId !== 'string' || conversationId.length > 120) fail(400, 'format');
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 80) fail(400, 'format');

  const sender = decoded.wallet;
  if (conversationId === 'general') {
    /* fan-out del grupo */
  } else {
    if (recipients.length !== 1) fail(400, 'format');
    const expect = [sender, recipients[0]].sort().join('__');
    if (conversationId !== expect) fail(400, 'format');
  }

  const db = getFirestore();
  const batch = db.batch();
  const factors = {};
  for (const recipient of recipients) {
    if (typeof recipient !== 'string' || !/^0x[0-9a-f]{40}$/.test(recipient) || recipient === sender) {
      fail(400, 'format');
    }
    const id = `${messageId}_${recipient}`;
    const factor = randomBytes(32).toString('base64');
    factors[recipient] = { id, factor };
    batch.set(db.collection('serverFactors').doc(id), {
      sender,
      recipient,
      conversationId,
      messageId,
      factor,
      createdAt: Timestamp.now()
    });
  }
  await batch.commit();
  res.json({ ok: true, factors });
}));

async function deleteQuery(query, onDoc) {
  const snap = await query.limit(200).get();
  for (const doc of snap.docs) {
    if (onDoc) await onDoc(doc);
    await doc.ref.delete();
  }
  return snap.size;
}

export const purgeExpired = onSchedule({
  region: REGION,
  schedule: 'every 60 minutes',
  timeoutSeconds: 300,
  memory: '256MiB'
}, async () => {
  const db = getFirestore();
  const now = Timestamp.now();
  const bucket = getStorage().bucket();
  const removed = await deleteQuery(
    db.collectionGroup('messages').where('expireAt', '<', now),
    async (doc) => {
      const data = doc.data() || {};
      const path = data.attachmentPath;
      if (typeof path === 'string' && path.startsWith('attachments/')) {
        try {
          await bucket.file(path).delete({ ignoreNotFound: true });
        } catch (err) {
          console.error('storage', path, err);
        }
      }
      if (typeof data.serverFactorId === 'string' && data.serverFactorId.length < 120) {
        try { await db.collection('serverFactors').doc(data.serverFactorId).delete(); } catch { /* ya no está */ }
      }
    }
  );
  const nonces = await deleteQuery(db.collection('nonces').where('expiresAt', '<', now));
  const old = Timestamp.fromMillis(Date.now() - 96 * 60 * 60 * 1000);
  const factors = await deleteQuery(db.collection('serverFactors').where('createdAt', '<', old));
  console.log(JSON.stringify({ removed, nonces, factors }));
});
