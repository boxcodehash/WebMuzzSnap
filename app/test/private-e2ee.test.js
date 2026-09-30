import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { resetGoogleCaches, signJwt } from '../server/google.js';
import { getAddress, isAddress, Wallet } from 'ethers';
import {
  decodeCiphertext,
  handlePhotoMailbox,
  handlePrekeyClaim,
  handlePrivateBlob,
  handlePrivateBlobAck,
  handlePrivateBlobDelete,
  handlePrivateBlobLink,
  handlePrivateBlobRead,
  handlePrivateExpire,
  handlePrivateReceipt,
  handlePrivateRelay,
  handlePrivateUnwrap,
  handleWalletKey
} from '../server/blob.js';
import { loadServerKey, unwrapFromStorage } from '../server/server-key.js';

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
          found = true;
          const parts = key.slice(prefix.length).split('/');
          let cursor = nested;
          for (let i = 0; i < parts.length - 1; i += 1) {
            cursor[parts[i]] = cursor[parts[i]] && typeof cursor[parts[i]] === 'object' ? cursor[parts[i]] : {};
            cursor = cursor[parts[i]];
          }
          cursor[parts[parts.length - 1]] = db[key];
        }
        return jsonResponse(200, found ? nested : null);
      }
      if (method === 'PUT') {
        db[path] = JSON.parse(opts.body);
        return jsonResponse(200, db[path]);
      }
      if (method === 'DELETE') {
        delete db[path];
        const prefix = path + '/';
        for (const key of Object.keys(db)) {
          if (key.startsWith(prefix)) delete db[key];
        }
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
    location: { hostname: 'localhost' },
    ethers: { getAddress, isAddress, utils: { getAddress, isAddress } }
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
  const pubs = { iv: Buffer.from('0123456789ab').toString('base64'), fromPub: 'A'.repeat(120), toPub: 'B'.repeat(120) };
  const db = {};
  const blobs = new Map();
  const fetchImpl = mockBackend(db, blobs);
  const now = Date.now();
  const uploaded = await handlePrivateBlob({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { to: bob, ct, ...pubs },
    now
  }, { env, fetchImpl });
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.id, /^[a-f0-9]{32}$/);
  assert.equal(uploaded.body.url, undefined);
  const record = db['privateBlobs/' + uploaded.body.id];
  assert.equal(record.from, alice);
  assert.equal(record.to, bob);
  assert.equal(record.url.startsWith('https://'), true);
  assert.equal(db['photoMailbox/' + bob + '/' + uploaded.body.id].from, alice);
  assert.equal(db['photoMailbox/' + bob + '/' + uploaded.body.id].url, undefined);
  assert.equal(blobs.size, 1);

  const senderRead = await handlePrivateBlobRead({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { id: uploaded.body.id },
    now
  }, { env, fetchImpl });
  assert.equal(senderRead.status, 403);

  const stranger = '0x' + '11'.repeat(20);
  const strangerList = await handlePhotoMailbox({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(stranger) },
    body: {},
    now
  }, { env, fetchImpl });
  assert.equal(strangerList.status, 200);
  assert.equal(strangerList.body.items.length, 0);
  const bobList = await handlePhotoMailbox({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: {},
    now
  }, { env, fetchImpl });
  assert.equal(bobList.body.items.length, 1);
  assert.equal(bobList.body.items[0].url, undefined);

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

  const thread = [alice, bob].sort().join('_');
  db['privateInbox/' + thread + '/messages/msg1'] = {
    from: alice,
    to: bob,
    text: 'Photo',
    seal: { id: uploaded.body.id, kind: 'photo' }
  };
  const linked = await handlePrivateBlobLink({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { id: uploaded.body.id, thread, msgId: 'msg1' },
    now
  }, { env, fetchImpl });
  assert.equal(linked.status, 200);
  const removed = await handlePrivateBlobAck({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: { id: uploaded.body.id },
    now
  }, { env, fetchImpl });
  assert.equal(removed.status, 200);
  assert.equal(blobs.size, 0);
  assert.equal(db['privateBlobs/' + uploaded.body.id], undefined);
  assert.equal(db['photoMailbox/' + bob + '/' + uploaded.body.id], undefined);
  assert.equal(db['privateInbox/' + thread + '/messages/msg1'], undefined);

  const again = await handlePrivateBlob({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { to: bob, ct, ...pubs },
    now
  }, { env, fetchImpl });
  assert.equal(again.status, 200);
  db['privateBlobs/' + again.body.id].createdAt = now - (25 * 60 * 60 * 1000);
  db['privateSignal/' + bob + '/' + alice + '/offer'] = { at: now - (25 * 60 * 60 * 1000), sdp: 'old' };
  db['privateSignal/' + alice + '/' + bob + '/offer'] = { at: now, sdp: 'live' };
  db['privateInbox/' + thread + '/messages/oldphoto'] = {
    from: alice, to: bob, text: 'Photo', timestamp: now - (25 * 60 * 60 * 1000), seal: { kind: 'photo', id: 'old' }
  };
  db['privateInbox/' + thread + '/messages/hello'] = {
    from: alice, to: bob, text: 'Encrypted message', timestamp: now - (25 * 60 * 60 * 1000), seal: { kind: 'text' }
  };
  db['privateInbox/' + thread + '/messages/freshtext'] = {
    from: alice, to: bob, text: 'Encrypted message', timestamp: now, seal: { kind: 'text' }
  };
  db['privateInbox/' + thread + '/messages/readold'] = {
    from: alice,
    to: bob,
    timestamp: now,
    readAt: now - (25 * 60 * 60 * 1000),
    expireAt: now - (60 * 60 * 1000),
    outer: 'abc',
    outerIv: 'def',
    v: 2
  };
  db['privateInbox/' + thread + '/messages/readnew'] = {
    from: alice,
    to: bob,
    timestamp: now - 1000,
    readAt: now - (60 * 60 * 1000),
    expireAt: now + (23 * 60 * 60 * 1000),
    outer: 'abc',
    outerIv: 'def',
    v: 2
  };
  db['privateInbox/' + thread + '/messages/newphoto'] = {
    from: alice, to: bob, text: 'Photo', timestamp: now, seal: { kind: 'photo', id: 'new' }
  };
  const expired = await handlePrivateExpire({
    method: 'GET',
    headers: { authorization: 'Bearer cron-test-secret' },
    body: {},
    now
  }, { env, fetchImpl });
  assert.equal(expired.status, 200);
  assert.equal(expired.body.removed, 5);
  assert.equal(db['privateBlobs/' + again.body.id], undefined);
  assert.equal(db['privateSignal/' + bob + '/' + alice + '/offer'], undefined);
  assert.equal(db['privateSignal/' + alice + '/' + bob + '/offer'].sdp, 'live');
  assert.equal(db['privateInbox/' + thread + '/messages/oldphoto'], undefined);
  assert.equal(db['privateInbox/' + thread + '/messages/hello'], undefined);
  assert.equal(db['privateInbox/' + thread + '/messages/readold'], undefined);
  assert.equal(db['privateInbox/' + thread + '/messages/freshtext'].seal.kind, 'text');
  assert.equal(db['privateInbox/' + thread + '/messages/readnew'].outer, 'abc');
  assert.equal(db['privateInbox/' + thread + '/messages/newphoto'].seal.id, 'new');

  const missing = await handleWalletKey({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { pub: 'A'.repeat(80) },
    now
  }, { env: { ...env, BLOB_READ_WRITE_TOKEN: '' }, fetchImpl });
  assert.equal(missing.status, 200);
  assert.equal(db['walletKeys/' + alice].alg, 'P-256');
});

function breakChecksum(address) {
  const chars = String(address).split('');
  for (let i = 2; i < chars.length; i += 1) {
    if (!/[a-fA-F]/.test(chars[i])) continue;
    const flipped = chars[i] === chars[i].toLowerCase() ? chars[i].toUpperCase() : chars[i].toLowerCase();
    chars[i] = flipped;
    const next = chars.join('');
    if (next !== address) return next;
  }
  return address;
}

test('two wallets: encrypt, order, relay, and prove the server cannot read', async () => {
  const alicePhone = bootE2EE();
  const bobPhone = bootE2EE();
  const aliceBundle = await alicePhone.ensureBundle(alice);
  const bobBundle = await bobPhone.ensureBundle(bob);
  const otherWallet = '0x' + '33'.repeat(20);
  const otherBundle = await alicePhone.ensureBundle(otherWallet);
  assert.notEqual(aliceBundle.pub, bobBundle.pub);
  assert.notEqual(aliceBundle.pub, otherBundle.pub);
  assert.equal(bobBundle.prekeys.length, 10);
  assert.equal(alicePhone.resolveDelivery(true, false), 'direct');
  assert.equal(alicePhone.resolveDelivery(false, true), 'relay');
  assert.equal(alicePhone.resolveDelivery(true, true), 'direct+relay');
  assert.equal(alicePhone.resolveDelivery(false, false), 'failed');

  const searched = Wallet.createRandom();
  const found = alicePhone.parseWalletSearch(searched.address.toLowerCase());
  assert.equal(found.wallet, searched.address.toLowerCase());
  assert.equal(found.checksum, getAddress(searched.address));
  assert.equal(alicePhone.parseWalletSearch('').empty, true);
  assert.match(alicePhone.parseWalletSearch('not-a-wallet').error, /valid 0x wallet address/);
  assert.match(alicePhone.parseWalletSearch(breakChecksum(searched.address)).error, /checksum/);

  const db = {};
  const blobs = new Map();
  const fetchImpl = mockBackend(db, blobs);
  const serverKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const keyed = { ...env, PRIVATE_SERVER_KEY: serverKey };
  const now = Date.now();
  const thread = [alice, bob].sort().join('_');
  const published = await handleWalletKey({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: { pub: bobBundle.pub, prekeys: bobBundle.prekeys },
    now
  }, { env: keyed, fetchImpl });
  assert.equal(published.status, 200);

  const blocked = await handlePrivateRelay({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { inner: { text: 'hello private' } },
    now
  }, { env, fetchImpl });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.error, 'server_key_missing');
  assert.equal(Object.keys(db).some((key) => key.startsWith('privateInbox')), false);

  const firstClaim = await handlePrekeyClaim({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { wallet: bob },
    now
  }, { env: keyed, fetchImpl });
  const secondClaim = await handlePrekeyClaim({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { wallet: bob },
    now
  }, { env: keyed, fetchImpl });
  assert.equal(firstClaim.status, 200);
  assert.equal(secondClaim.status, 200);
  assert.notEqual(firstClaim.body.id, secondClaim.body.id);

  const later = await alicePhone.sealMessage(alice, bob, 'hello private', {
    prekey: firstClaim.body,
    seq: 2,
    sentAt: now + 20,
    id: 'ab'.repeat(16)
  });
  const earlier = await alicePhone.sealMessage(alice, bob, 'second line', {
    prekey: secondClaim.body,
    seq: 1,
    sentAt: now + 20,
    id: 'cd'.repeat(16)
  });
  assert.notEqual(later.ephPub, earlier.ephPub);
  assert.equal(JSON.stringify(later).includes('hello private'), false);
  assert.equal(JSON.stringify(earlier).includes('second line'), false);

  const smuggle = await handlePrivateRelay({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { inner: { ...later, text: 'hello private' } },
    now
  }, { env: keyed, fetchImpl });
  assert.equal(smuggle.status, 400);
  assert.equal(Object.keys(db).some((key) => key.startsWith('privateInbox')), false);

  for (const inner of [later, earlier]) {
    const relayed = await handlePrivateRelay({
      method: 'POST',
      headers: { authorization: 'Bearer ' + idToken(alice) },
      body: { inner },
      now
    }, { env: keyed, fetchImpl });
    assert.equal(relayed.status, 200, JSON.stringify(relayed.body));
    const stored = db['privateInbox/' + thread + '/messages/' + inner.id];
    assert.equal(stored.text, undefined);
    assert.equal(stored.ct, undefined);
    assert.equal(stored.plaintext, undefined);
    assert.equal(JSON.stringify(stored).includes('hello private'), false);
    assert.equal(JSON.stringify(stored).includes('second line'), false);
    assert.equal(stored.readAt, null);
    assert.equal(stored.expireAt - stored.timestamp, 24 * 60 * 60 * 1000);
    const peeled = unwrapFromStorage(loadServerKey(keyed), stored.outer, stored.outerIv);
    assert.equal(JSON.stringify(peeled).includes('hello private'), false);
    assert.equal(JSON.stringify(peeled).includes('second line'), false);
    const serverAes = await crypto.subtle.importKey('raw', loadServerKey(keyed), 'AES-GCM', false, ['decrypt']);
    await assert.rejects(crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(peeled.iv, 'base64') },
      serverAes,
      Buffer.from(peeled.ct, 'base64')
    ));
    assert.throws(() => unwrapFromStorage(Buffer.alloc(32, 7), stored.outer, stored.outerIv));
  }
  assert.equal(db['privateIndex/' + bob + '/' + alice].lastText, 'Encrypted message');

  const openedEarly = await handlePrivateUnwrap({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: { id: earlier.id, peer: alice },
    now
  }, { env: keyed, fetchImpl });
  const openedLate = await handlePrivateUnwrap({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: { id: later.id, peer: alice },
    now
  }, { env: keyed, fetchImpl });
  assert.equal(await bobPhone.openMessage(bob, openedEarly.body.inner), 'second line');
  const tampered = { ...openedLate.body.inner, from: '0x' + '22'.repeat(20) };
  await assert.rejects(bobPhone.openMessage(bob, tampered));
  assert.equal(await bobPhone.openMessage(bob, openedLate.body.inner), 'hello private');
  await assert.rejects(bobPhone.openMessage(bob, openedLate.body.inner));
  const eve = bootE2EE();
  await eve.ensureBundle('0x' + '11'.repeat(20));
  await assert.rejects(eve.openMessage('0x' + '11'.repeat(20), openedLate.body.inner));

  const ordered = bobPhone.sortMessages([
    { id: later.id, timestamp: later.sentAt, seq: later.seq },
    { id: earlier.id, timestamp: earlier.sentAt, seq: earlier.seq }
  ]);
  assert.deepEqual(ordered.map((row) => row.id), [earlier.id, later.id]);

  const receipt = await handlePrivateReceipt({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(bob) },
    body: { id: later.id, peer: alice },
    now: now + 5000
  }, { env: keyed, fetchImpl });
  assert.equal(receipt.status, 200);
  const saved = db['privateInbox/' + thread + '/messages/' + later.id];
  assert.equal(saved.readAt, now + 5000);
  assert.equal(saved.expireAt - saved.readAt, 24 * 60 * 60 * 1000);
  const senderReceipt = await handlePrivateReceipt({
    method: 'POST',
    headers: { authorization: 'Bearer ' + idToken(alice) },
    body: { id: earlier.id, peer: bob },
    now
  }, { env: keyed, fetchImpl });
  assert.equal(senderReceipt.status, 403);

  await bobPhone.rememberPlain({ id: 'aa'.repeat(16), text: 'gone', expireAt: now - 1, thread });
  await bobPhone.rememberPlain({ id: 'bb'.repeat(16), text: 'stay', expireAt: now + 100000, thread });
  const gone = await bobPhone.sweepLocal(now);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].text, 'gone');
  const left = await bobPhone.listPlain();
  assert.equal(left.some((row) => row.text === 'stay'), true);
  assert.equal(left.some((row) => row.text === 'gone'), false);

  const page = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../www/js/private-e2ee.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server/server-key.js', import.meta.url), 'utf8');
  assert.match(page, /walletSearch/);
  assert.match(page, /muzzPrivateBack/);
  assert.match(page, /muzzConsumeBack/);
  assert.match(page, /directSendJson/);
  assert.doesNotMatch(page, /seal \? 'Encrypted message' : text/);
  assert.match(client, /PRIVATE_SERVER_KEY|server_key_missing|muzzsnap-wrap-v2/);
  assert.match(server, /PRIVATE_SERVER_KEY/);
  assert.doesNotMatch(server, /PRIVATE_SERVER_KEY\s*=\s*['"][A-Za-z0-9+/=]{8,}/);
  assert.equal(loadServerKey({}), null);
  assert.equal(loadServerKey({ PRIVATE_SERVER_KEY: 'too-short' }), null);
});
