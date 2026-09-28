import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { resetGoogleCaches, signJwt } from '../server/google.js';
import {
  decodeCiphertext,
  handlePrivateBlob,
  handlePrivateBlobDelete,
  handlePrivateBlobRead,
  handlePrivateExpire,
  handleWalletKey
} from '../server/blob.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const account = {
  type: 'service_account',
  project_id: 'pulsari',
  private_key_id: 'blobkey',
  private_key: privatePem,
  client_email: 'firebase-adminsdk-blob@pulsari.iam.gserviceaccount.com'
};
const env = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(account),
  FIREBASE_DATABASE_URL: 'https://pulsari-default-rtdb.firebaseio.com',
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test',
  CRON_SECRET: 'cron-test-secret'
};
const alice = '0x' + 'ab'.repeat(20);
const bob = '0x' + 'cd'.repeat(20);

function idToken(wallet) {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    { alg: 'RS256', typ: 'JWT', kid: 'blobkey' },
    {
      iss: 'https://securetoken.google.com/pulsari',
      aud: 'pulsari',
      sub: wallet,
      user_id: wallet,
      wallet,
      iat,
      exp: iat + 3600
    },
    privatePem
  );
}

function jsonResponse(status, body) {
  const raw = Buffer.from(JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return 'max-age=60'; } },
    json: async () => body,
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  };
}

function bytesResponse(status, bytes) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return ''; } },
    json: async () => ({}),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

function mockBackend(db, blobs) {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.includes('/robot/v1/metadata/x509/')) return jsonResponse(200, { blobkey: publicPem });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return jsonResponse(200, { access_token: 'ya29.blob', expires_in: 3600 });
    if (u.startsWith('https://vercel.com/api/blob/delete')) {
      const body = JSON.parse(opts.body);
      blobs.delete(body.urls[0]);
      return jsonResponse(200, {});
    }
    if (u.startsWith('https://vercel.com/api/blob/')) {
      assert.equal(opts.headers.authorization, 'Bearer vercel_blob_rw_test');
      const stored = Buffer.from(opts.body);
      const blobUrl = 'https://example.blob.vercel-storage.com/muzzsnap/private/file';
      blobs.set(blobUrl, stored);
      return jsonResponse(200, { url: blobUrl, pathname: 'muzzsnap/private/file-suffix' });
    }
    if (blobs.has(u)) return bytesResponse(200, blobs.get(u));
    if (u.includes('firebaseio.com')) {
      const path = decodeURIComponent(new URL(u).pathname.replace(/^\//, '').replace(/\.json$/, ''));
      if (method === 'GET') {
        if (Object.prototype.hasOwnProperty.call(db, path)) return jsonResponse(200, db[path]);
        const prefix = path + '/';
        const nested = {};
        let found = false;
        for (const key of Object.keys(db)) {
          if (!key.startsWith(prefix)) continue;
          nested[key.slice(prefix.length)] = db[key];
          found = true;
        }
        return jsonResponse(200, found ? nested : null);
      }
      if (method === 'PUT') {
        db[path] = JSON.parse(opts.body);
        return jsonResponse(200, db[path]);
      }
      if (method === 'DELETE') {
        delete db[path];
        return jsonResponse(200, null);
      }
    }
    return jsonResponse(500, { error: 'unexpected ' + u });
  };
}

function bootE2EE() {
  const src = readFileSync(new URL('../www/js/private-e2ee.js', import.meta.url), 'utf8');
  const store = new Map();
  const sandbox = {
    crypto: globalThis.crypto,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); }
    },
    console,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    fetch: async () => { throw new Error('no network'); },
    location: { hostname: 'localhost' }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox, { filename: 'private-e2ee.js' });
  return sandbox.MuzzE2EE;
}

test('a private message decrypts only for the two phones', async () => {
  const alicePhone = bootE2EE();
  const bobPhone = bootE2EE();
  const aliceKeys = await alicePhone.loadOrCreate();
  const bobKeys = await bobPhone.loadOrCreate();
  const box = await alicePhone.encryptBytes(
    aliceKeys.privateKey,
    bobKeys.pub,
    new TextEncoder().encode('hello private')
  );
  const opened = await bobPhone.decryptBytes(bobKeys.privateKey, aliceKeys.pub, box.iv, box.ct);
  assert.equal(new TextDecoder().decode(opened), 'hello private');
  const stranger = bootE2EE();
  const strangerKeys = await stranger.loadOrCreate();
  await assert.rejects(stranger.decryptBytes(strangerKeys.privateKey, aliceKeys.pub, box.iv, box.ct));
  const client = readFileSync(new URL('../www/js/private-e2ee.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /BLOB_READ_WRITE_TOKEN|BEGIN PRIVATE KEY/);
  const page = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  assert.match(page, /aria-label="Photo"/);
  assert.match(page, /private-e2ee\.js/);
});

test('ciphertext goes to Blob and is deleted when the recipient opens it or after 24h', async () => {
  resetGoogleCaches();
  assert.equal(decodeCiphertext(''), null);
  const ct = Buffer.from('cipher-bytes').toString('base64');
  const db = {};
  const blobs = new Map();
  const fetchImpl = mockBackend(db, blobs);
  const now = Date.now();
  const uploaded = await handlePrivateBlob({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { to: bob, ct },
    now
  }, { env, fetchImpl });
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.id, /^[a-f0-9]{32}$/);
  assert.equal(uploaded.body.url, undefined);
  const record = db['privateBlobs/' + uploaded.body.id];
  assert.equal(record.from, alice);
  assert.equal(record.to, bob);
  assert.equal(blobs.size, 1);

  const denied = await handlePrivateBlobDelete({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { id: uploaded.body.id },
    now
  }, { env, fetchImpl });
  assert.equal(denied.status, 403);
  assert.equal(blobs.size, 1);

  const read = await handlePrivateBlobRead({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: { id: uploaded.body.id },
    now
  }, { env, fetchImpl });
  assert.equal(read.status, 200);
  assert.equal(Buffer.from(read.body.ct, 'base64').toString(), 'cipher-bytes');

  const removed = await handlePrivateBlobDelete({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: { id: uploaded.body.id },
    now
  }, { env, fetchImpl });
  assert.equal(removed.status, 200);
  assert.equal(blobs.size, 0);
  assert.equal(db['privateBlobs/' + uploaded.body.id], undefined);

  const again = await handlePrivateBlob({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { to: bob, ct },
    now
  }, { env, fetchImpl });
  assert.equal(again.status, 200);
  db['privateBlobs/' + again.body.id].createdAt = now - (25 * 60 * 60 * 1000);
  const expired = await handlePrivateExpire({
    method: 'GET',
    headers: { authorization: 'Bearer cron-test-secret' },
    body: {},
    now
  }, { env, fetchImpl });
  assert.equal(expired.status, 200);
  assert.equal(expired.body.removed, 1);
  assert.equal(db['privateBlobs/' + again.body.id], undefined);

  const missing = await handleWalletKey({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { pub: 'A'.repeat(80) },
    now
  }, { env: { ...env, BLOB_READ_WRITE_TOKEN: '' }, fetchImpl });
  assert.equal(missing.status, 200);
  assert.equal(db['walletKeys/' + alice].alg, 'P-256');
});
