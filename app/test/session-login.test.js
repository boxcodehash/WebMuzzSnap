import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { getAddress, Wallet } from 'ethers';
import { SIWE_DOMAIN, SIWE_STATEMENT, SIWE_URI } from '../server/login-proof.js';
import { formatMessage } from '@walletconnect/utils';
import { CLOCK_SKEW_MS, MAX_AGE_MS, proveLogin } from '../server/login-proof.js';
import { handleSession } from '../server/push.js';
import { buildOneClickAuth, cacaoProof } from '../src/wc-auth.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
    type: 'service_account',
    project_id: 'pulsari',
    private_key_id: 'testkey',
    private_key: privatePem,
    client_email: 'firebase-adminsdk-test@pulsari.iam.gserviceaccount.com'
  }),
  FIREBASE_DATABASE_URL: 'https://pulsari-default-rtdb.firebaseio.com'
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function mockBackend(db) {
  return async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse(200, { access_token: 'ya29.test', expires_in: 3600 });
    }
    if (u.includes('ethereum.publicnode.com') || u.includes('eth.drpc.org') || u.includes('rpc.ankr.com')) {
      const body = JSON.parse(opts.body || '{}');
      const data = body.params && body.params[0] && body.params[0].data || '';
      if (String(data).startsWith('0x313ce567')) {
        return jsonResponse(200, { jsonrpc: '2.0', id: 1, result: '0x12' });
      }
      return jsonResponse(200, { jsonrpc: '2.0', id: 1, result: '0x84595161401484a000000' });
    }
    if (u.includes('firebaseio.com')) {
      const path = decodeURIComponent(new URL(u).pathname.replace(/^\//, '').replace(/\.json$/, ''));
      if (method === 'GET') return jsonResponse(200, Object.prototype.hasOwnProperty.call(db, path) ? db[path] : null);
      if (method === 'PUT') {
        db[path] = JSON.parse(opts.body);
        return jsonResponse(200, db[path]);
      }
    }
    return jsonResponse(500, { error: 'unexpected' });
  };
}

function personalMessage(wallet, { nonce, exp, issuedAt }) {
  const checksum = getAddress(String(wallet.address).toLowerCase());
  const when = Number(exp);
  const issued = issuedAt || new Date(Math.min(Date.now(), when - 1000)).toISOString();
  return [
    SIWE_DOMAIN + ' wants you to sign in with your Ethereum account:',
    checksum,
    '',
    SIWE_STATEMENT,
    '',
    'URI: ' + SIWE_URI,
    'Version: 1',
    'Chain ID: 1',
    'Nonce: ' + String(nonce).toLowerCase(),
    'Issued At: ' + issued,
    'Expiration Time: ' + new Date(when).toISOString()
  ].join('\n');
}

function seedIssued(db, message) {
  const nonceLine = String(message || '').split('\n').find((line) => line.startsWith('Nonce: '));
  const expLine = String(message || '').split('\n').find((line) => line.startsWith('Expiration Time: '));
  if (!nonceLine || !expLine) return;
  const nonce = nonceLine.slice('Nonce: '.length).trim();
  const exp = Date.parse(expLine.slice('Expiration Time: '.length).trim());
  if (!db['loginIssued/' + nonce]) db['loginIssued/' + nonce] = { exp };
}

async function postSession(body, now, db = {}) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    if (body && body.message) seedIssued(db, body.message);
    const result = await handleSession(
      { method: 'POST', headers: {}, body, now },
      { env, fetchImpl: mockBackend(db) }
    );
    return { result, warnings, db };
  } finally {
    console.warn = original;
  }
}

function tokenUid(token) {
  const part = String(token).split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).uid;
}

test('fresh personal_sign and one-click SIWE proofs exchange once', async () => {
  const wallet = Wallet.createRandom();
  const now = Date.now();
  const nonce = 'ab'.repeat(16);
  const exp = now + 9 * 60 * 1000;
  const message = personalMessage(wallet, { nonce, exp });
  const signature = await wallet.signMessage(message);
  const fresh = await postSession({ message, signature }, now);
  assert.equal(fresh.result.status, 200);
  assert.equal(tokenUid(fresh.result.body.customToken), wallet.address.toLowerCase());
  assert.equal(fresh.warnings.length, 0);
  assert.equal(proveLogin(message, signature, now).wallet, wallet.address.toLowerCase());

  const skewed = now + MAX_AGE_MS + CLOCK_SKEW_MS;
  const skewMessage = personalMessage(wallet, { nonce: 'cd'.repeat(16), exp: skewed, issuedAt: new Date(now).toISOString() });
  const skewSig = await wallet.signMessage(skewMessage);
  const skew = await postSession({ message: skewMessage, signature: skewSig }, now, {});
  assert.equal(skew.result.status, 200);

  for (const chain of ['eip155:1', 'eip155:56']) {
    const auth = buildOneClickAuth({
      domain: 'muzzsnap-app.vercel.app',
      uri: 'https://muzzsnap-app.vercel.app/login.html',
      nonce: 'ef'.repeat(16),
      exp: now + 60_000
    });
    const payload = {
      domain: auth.domain,
      aud: auth.uri,
      nonce: auth.nonce,
      version: '1',
      iat: new Date(now).toISOString(),
      exp: auth.exp,
      statement: auth.statement,
      resources: auth.resources
    };
    const siwe = formatMessage(payload, `did:pkh:${chain}:${wallet.address}`);
    const siweSig = await wallet.signMessage(siwe);
    const cacao = cacaoProof({ p: { ...payload, iss: `did:pkh:${chain}:${wallet.address}` }, s: { t: 'eip191', s: siweSig } });
    assert.equal(cacao.address, wallet.address.toLowerCase());
    const opened = await postSession({ message: cacao.message, signature: cacao.signature }, now, {});
    assert.equal(opened.result.status, 401, chain);
    assert.equal(opened.result.body.error, 'bad_format');
    if (chain === 'eip155:56') assert.match(cacao.message, /Chain ID: 56/);
  }
});

test('expired, reused, bad signature, and a clock that is too far ahead are distinct 401s', async () => {
  const wallet = Wallet.createRandom();
  const other = Wallet.createRandom();
  const now = Date.now();
  const nonce = '11'.repeat(16);
  const exp = now + 60_000;
  const message = personalMessage(wallet, { nonce, exp });
  const signature = await wallet.signMessage(message);

  const expired = await postSession({ message, signature }, exp + 1);
  assert.equal(expired.result.status, 401);
  assert.equal(expired.result.body.error, 'expired');
  assert.match(expired.warnings.join('\n'), /session rejected: expired/);
  assert.equal(expired.warnings.join('\n').includes(signature), false);
  assert.equal(expired.warnings.join('\n').includes(message), false);
  assert.equal(proveLogin(message, signature, exp + 1), null);

  const db = {};
  const first = await postSession({ message, signature }, now, db);
  assert.equal(first.result.status, 200);
  const reused = await postSession({ message, signature }, now, db);
  assert.equal(reused.result.status, 401);
  assert.equal(reused.result.body.error, 'nonce_used');
  assert.match(reused.warnings.join('\n'), /session rejected: nonce_used/);
  assert.equal(reused.warnings.join('\n').includes(signature), false);

  const bad = await postSession({ message, signature: await other.signMessage(message) }, now, {});
  assert.equal(bad.result.status, 401);
  assert.equal(bad.result.body.error, 'bad_signature');
  assert.equal(bad.warnings.join('\n').includes(message), false);

  const ahead = personalMessage(wallet, {
    nonce: '22'.repeat(16),
    exp: now + MAX_AGE_MS + CLOCK_SKEW_MS + 1,
    issuedAt: new Date(now).toISOString()
  });
  const aheadSig = await wallet.signMessage(ahead);
  const format = await postSession({ message: ahead, signature: aheadSig }, now, {});
  assert.equal(format.result.status, 401);
  assert.equal(format.result.body.error, 'bad_format');
  assert.equal(format.warnings.join('\n').includes(aheadSig), false);
});

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

function loadClient(session, local, fetchImpl, authState) {
  function firebaseAuth() {
    return {
      get currentUser() { return authState.user; },
      setPersistence() { return Promise.resolve(); },
      authStateReady() { return Promise.resolve(); },
      onAuthStateChanged(cb) {
        const unsub = function () {};
        Promise.resolve().then(function () { cb(authState.user || null); });
        return unsub;
      },
      signInAnonymously() { return Promise.reject(new Error('anonymous disabled')); },
      signInWithCustomToken() {
        authState.user = { uid: authState.wallet };
        return Promise.resolve({ user: authState.user });
      }
    };
  }
  firebaseAuth.Auth = { Persistence: { LOCAL: 'local' } };
  const context = {
    sessionStorage: session,
    localStorage: local,
    location: { hostname: 'localhost' },
    fetch: fetchImpl,
    firebase: { auth: firebaseAuth },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    document: {
      readyState: 'complete',
      getElementById() { return null; },
      addEventListener() {}
    },
    addEventListener() {},
    dispatchEvent() {},
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Promise,
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../www/js/muzz-gate.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../www/js/fcm-client.js', import.meta.url), 'utf8'), context);
  return context;
}

test('a 401 clears the stale proof and a later chat load does not send it again', async () => {
  const wallet = '0x' + 'ab'.repeat(20);
  const nonce = '33'.repeat(16);
  const exp = Date.now() + 60_000;
  const message = personalMessage({ address: wallet }, { nonce, exp });
  const signature = '0x' + 'cd'.repeat(65);
  const session = memoryStorage();
  const local = memoryStorage();
  session.setItem('muzz_login_msg', message);
  session.setItem('muzz_login_sig', signature);
  local.setItem('muzz_session', JSON.stringify({
    address: wallet,
    until: Date.now() + 30 * 24 * 60 * 60 * 1000,
    message,
    signature
  }));
  const posts = [];
  const context = loadClient(session, local, async (url, opts) => {
    posts.push(String(url));
    assert.equal(String(opts.body).includes(signature), true);
    return { status: 401, ok: false, json: async () => ({ error: 'nonce_used' }) };
  }, { user: null, wallet });

  const first = await context.MuzzPush.signInForChat(wallet);
  assert.equal(first.needsSign, true);
  assert.equal(first.reason, 'nonce_used');
  assert.equal(posts.length, 1);
  assert.equal(session.getItem('muzz_login_msg'), null);
  assert.equal(session.getItem('muzz_login_sig'), null);
  assert.equal(local.getItem('muzz_session'), null);
  assert.equal(session.getItem('muzz_login_hold'), 'nonce_used');

  session.setItem('muzz_login_msg', message);
  session.setItem('muzz_login_sig', signature);
  local.setItem('muzz_session', JSON.stringify({
    address: wallet,
    until: Date.now() + 30 * 24 * 60 * 60 * 1000,
    message,
    signature
  }));
  const second = await context.MuzzPush.signInForChat(wallet);
  assert.equal(second.needsSign, true);
  assert.equal(posts.length, 1);

  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  assert.match(login, /id="loginRetry"/);
  assert.match(login, />Retry</);
  assert.match(login, /js\/login-page\.js/);
  const chat = readFileSync(new URL('../www/chat.html', import.meta.url), 'utf8');
  assert.match(chat, /user\.needsSign/);
  assert.match(chat, /muzz_login_hold/);
  assert.match(chat, /location\.replace\('login\.html'\)/);
  const gate = readFileSync(new URL('../www/js/muzz-gate.js', import.meta.url), 'utf8');
  assert.match(gate, /HANDOFF_MS = 10 \* 60 \* 1000/);
  assert.match(gate, /0xbeec8f1fee64627f83f0188eae621f367a6bcb8a/);
  assert.match(gate, /10000000/);
  assert.match(readFileSync(new URL('../src/wc-auth.js', import.meta.url), 'utf8'), /AUTH_TTL_MS = 10 \* 60 \* 1000/);
});

test('an expired stored proof is not posted, and a wallet user is not exchanged again', async () => {
  const wallet = '0x' + '11'.repeat(20);
  const nonce = '44'.repeat(16);
  const message = personalMessage({ address: wallet }, { nonce, exp: Date.now() - 1000 });
  const signature = '0x' + 'ab'.repeat(65);
  const session = memoryStorage();
  const local = memoryStorage();
  local.setItem('muzz_session', JSON.stringify({
    address: wallet,
    until: Date.now() + 86_000_000,
    message,
    signature
  }));
  const posts = [];
  const authState = { user: null, wallet };
  const context = loadClient(session, local, async (url) => {
    posts.push(String(url));
    return { status: 200, ok: true, json: async () => ({ customToken: 'nope' }) };
  }, authState);
  const stale = await context.MuzzPush.signInForChat(wallet);
  assert.equal(stale.needsSign, true);
  assert.equal(stale.reason, 'expired');
  assert.equal(posts.length, 0);
  assert.equal(local.getItem('muzz_session'), null);

  const liveNonce = '55'.repeat(16);
  const live = personalMessage({ address: wallet }, { nonce: liveNonce, exp: Date.now() + 60_000 });
  session.setItem('muzz_login_msg', live);
  session.setItem('muzz_login_sig', signature);
  session.removeItem('muzz_login_hold');
  authState.user = { uid: wallet };
  const kept = await context.MuzzPush.signInForChat(wallet);
  assert.equal(kept.uid, wallet);
  assert.equal(posts.length, 0);
});
