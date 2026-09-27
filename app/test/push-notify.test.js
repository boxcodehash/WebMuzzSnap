import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { resetGoogleCaches, signJwt, tokenId } from '../server/google.js';
import { proveLogin } from '../server/login-proof.js';
import {
  NOTIFICATION_BODY,
  PUBLIC_VAPID_KEY,
  buildFcmMessage,
  handleNotify,
  handlePushConfig,
  handleRegisterToken,
  handleSession,
  nextRate
} from '../server/push.js';
import { applyAndroidPush, googleServicesPresent, installGoogleServices, stripGradlePush, stripPluginJson } from '../scripts/android-push.mjs';
import { SLIM_PACKAGE, stageVercelProject } from '../scripts/pack-vercel.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const account = {
  type: 'service_account',
  project_id: 'pulsari',
  private_key_id: 'testkey',
  private_key: privatePem,
  client_email: 'firebase-adminsdk-test@pulsari.iam.gserviceaccount.com'
};
const env = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(account),
  FIREBASE_VAPID_KEY: 'public-vapid-key',
  FIREBASE_DATABASE_URL: 'https://pulsari-default-rtdb.firebaseio.com'
};
const SECRET = 'secret phrase xyz';

function idToken(wallet, extra = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    { alg: 'RS256', typ: 'JWT', kid: 'testkey' },
    {
      iss: 'https://securetoken.google.com/pulsari',
      aud: 'pulsari',
      sub: wallet,
      user_id: wallet,
      wallet,
      iat,
      exp: iat + 3600,
      ...extra
    },
    privatePem
  );
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers[String(name).toLowerCase()] || ''; } },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function mockBackend(db, calls) {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body });
    if (u.includes('/robot/v1/metadata/x509/')) {
      return jsonResponse(200, { testkey: publicPem }, { 'cache-control': 'max-age=60' });
    }
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse(200, { access_token: 'ya29.test', expires_in: 3600 });
    }
    if (u.startsWith('https://fcm.googleapis.com/')) {
      const payload = JSON.parse(opts.body);
      if (String(payload.message.token).includes('dead')) {
        return jsonResponse(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
      }
      return jsonResponse(200, { name: 'projects/pulsari/messages/1' });
    }
    if (u.includes('firebaseio.com')) {
      const path = decodeURIComponent(new URL(u).pathname.replace(/^\//, '').replace(/\.json$/, ''));
      if (method === 'GET') {
        if (path.startsWith('privateIndex/') && !u.includes('shallow=true')) {
          return jsonResponse(200, { lastText: SECRET, lastAt: 1 });
        }
        return jsonResponse(200, Object.prototype.hasOwnProperty.call(db, path) ? db[path] : null);
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
    return jsonResponse(500, { error: 'unexpected' });
  };
}

test('notification text is fixed and message text is ignored', () => {
  const web = buildFcmMessage({ token: 'abc', peer: '0x' + 'a'.repeat(40), platform: 'web', text: SECRET });
  const android = buildFcmMessage({ token: 'abc', peer: '0x' + 'b'.repeat(40), platform: 'android', text: SECRET });
  assert.equal(web.message.data.body, NOTIFICATION_BODY);
  assert.equal(android.message.notification.body, NOTIFICATION_BODY);
  assert.equal(web.message.notification, undefined);
  assert.equal(JSON.stringify(web).includes(SECRET), false);
  assert.equal(JSON.stringify(android).includes(SECRET), false);
  const rate = { windowStart: 1_000, count: 0 };
  for (let i = 0; i < 20; i += 1) {
    const next = nextRate(i === 0 ? null : rate, 1_000);
    assert.equal(next.allowed, true);
    rate.windowStart = next.windowStart;
    rate.count = next.count;
  }
  assert.equal(nextRate(rate, 1_000).allowed, false);
  assert.equal(nextRate(rate, 1_000 + 60_000).allowed, true);
});

test('session proof, notify, register, and push config', async () => {
  resetGoogleCaches();
  const sender = Wallet.createRandom();
  const recipient = Wallet.createRandom();
  const senderWallet = sender.address.toLowerCase();
  const recipientWallet = recipient.address.toLowerCase();
  const now = Date.now();
  const nonce = 'cd'.repeat(16);
  const exp = now + 60_000;
  const message = [
    'MuzzSnap Login',
    '',
    sender.address + ' wants to sign in to MuzzSnap.',
    'Sign this message to prove you control this wallet. It does not spend gas.',
    '',
    'Wallet: ' + sender.address,
    'Chain ID: 1',
    'Nonce: ' + nonce,
    'Expires: ' + exp,
    'Token: 0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0',
    'Minimum: 10000000 MUZZ'
  ].join('\n');
  const signature = await sender.signMessage(message);
  assert.equal(proveLogin(message, signature, now).wallet, senderWallet);
  assert.equal(proveLogin(message, signature, exp + 1), null);
  const issued = new Date(now).toISOString();
  const rootMessage = [
    'MuzzSnap Login',
    '',
    'Sign this message to verify your wallet.',
    'You will continue in this browser after signing.',
    '',
    'Wallet: ' + sender.address,
    'Issued: ' + issued
  ].join('\n');
  const rootSig = await sender.signMessage(rootMessage);
  assert.equal(proveLogin(rootMessage, rootSig, now).wallet, senderWallet);
  assert.equal(proveLogin(rootMessage, rootSig, now + 11 * 60 * 1000), null);
  assert.equal(proveLogin(message, await recipient.signMessage(message), now), null);

  const db = {};
  const calls = [];
  const fetchImpl = mockBackend(db, calls);
  const session = await handleSession(
    { method: 'POST', headers: {}, body: { message, signature }, now },
    { env, fetchImpl }
  );
  assert.equal(session.status, 200);
  const parts = session.body.customToken.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(payload.uid, senderWallet);
  assert.equal(payload.claims.wallet, senderWallet);
  assert.equal(payload.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  const verify = createVerify('RSA-SHA256');
  verify.update(parts[0] + '.' + parts[1]);
  verify.end();
  assert.equal(verify.verify(publicKey, Buffer.from(parts[2], 'base64url')), true);
  const replay = await handleSession(
    { method: 'POST', headers: {}, body: { message, signature }, now },
    { env, fetchImpl }
  );
  assert.equal(replay.status, 401);

  const missing = await handleNotify(
    { method: 'POST', headers: {}, body: { to: recipientWallet }, now },
    { env: {}, fetchImpl }
  );
  assert.equal(missing.status, 503);

  const token = idToken(senderWallet);
  const stranger = await handleNotify(
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: { to: recipientWallet, text: SECRET },
      now
    },
    { env, fetchImpl }
  );
  assert.equal(stranger.status, 403);

  db['privateIndex/' + senderWallet + '/' + recipientWallet] = { lastAt: true };
  db['privateIndex/' + recipientWallet + '/' + senderWallet] = { lastAt: true };
  db['notifyRate/' + senderWallet] = { windowStart: now, count: 20 };
  const limited = await handleNotify(
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: { to: recipientWallet, text: SECRET },
      now
    },
    { env, fetchImpl }
  );
  assert.equal(limited.status, 429);

  delete db['notifyRate/' + senderWallet];
  const webToken = 'web-token-12345678901234567890';
  const deadToken = 'dead-token-12345678901234567890';
  db['fcmTokens/' + recipientWallet] = {
    [tokenId(webToken)]: { token: webToken, platform: 'web', updatedAt: 1 },
    [tokenId(deadToken)]: { token: deadToken, platform: 'android', updatedAt: 1 }
  };
  const sent = await handleNotify(
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: { to: recipientWallet, text: SECRET, content: SECRET },
      now
    },
    { env, fetchImpl }
  );
  assert.equal(sent.status, 200);
  assert.equal(sent.body.sent, 1);
  const fcmCalls = calls.filter((call) => call.url.startsWith('https://fcm.googleapis.com/'));
  assert.equal(fcmCalls.length, 2);
  const encoded = fcmCalls.map((call) => String(call.body)).join('\n');
  assert.equal(encoded.includes(SECRET), false);
  assert.equal(encoded.includes(NOTIFICATION_BODY), true);
  const indexCalls = calls.filter((call) => call.url.includes('privateIndex'));
  assert.ok(indexCalls.every((call) => call.url.includes('shallow=true')));
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.url.includes(tokenId(deadToken))));
  assert.equal(calls.some((call) => call.method === 'DELETE' && call.url.includes(tokenId(webToken))), false);

  const registered = await handleRegisterToken(
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + idToken(recipientWallet) },
      body: { token: webToken, platform: 'web', wallet: senderWallet },
      now
    },
    { env, fetchImpl }
  );
  assert.equal(registered.status, 200);
  assert.equal(db['fcmTokens/' + recipientWallet + '/' + tokenId(webToken)].platform, 'web');
  assert.equal(db['fcmTokens/' + senderWallet + '/' + tokenId(webToken)], undefined);

  const config = handlePushConfig({ method: 'GET', headers: {} }, { env });
  assert.deepEqual(Object.keys(config.body), ['vapidKey']);
  assert.equal(config.body.vapidKey, 'public-vapid-key');
  assert.equal(JSON.stringify(config.body).includes('PRIVATE'), false);
  const fallback = handlePushConfig({ method: 'GET', headers: {} }, { env: {} });
  assert.equal(fallback.body.vapidKey, PUBLIC_VAPID_KEY);
  assert.equal(fallback.body.vapidKey.startsWith('BD4Waq9'), true);
});

test('clients, rules, and the Android fallback do not ship the service account', () => {
  const appClient = readFileSync(new URL('../www/js/fcm-client.js', import.meta.url), 'utf8');
  const rootClient = readFileSync(new URL('../../fcm-client.js', import.meta.url), 'utf8');
  for (const source of [appClient, rootClient]) {
    assert.match(source, /JSON\.stringify\(\{ to: peer \}\)/);
    assert.doesNotMatch(source, /FIREBASE_SERVICE_ACCOUNT|BEGIN PRIVATE KEY|text:/);
    assert.match(source, /\/api\/notify/);
    assert.match(source, /muzzsnap-app\.vercel\.app/);
    assert.match(source, /BD4Waq9Zdd8iVPmAvv3K4brWllOezeIREB_X_m6ijlit0ffs9Ff9GQJc8pjzCefT03A3lshYXCNDmUOPk6sIkew/);
  }
  const notifyFn = readFileSync(new URL('../api/notify.js', import.meta.url), 'utf8');
  assert.match(notifyFn, /process\.env\.FIREBASE_SERVICE_ACCOUNT/);
  assert.match(notifyFn, /env: process\.env/);
  for (const file of ['www/private.html', 'www/chat.html']) {
    const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(html, /fcm-client\.js/);
    assert.match(html, /MuzzPush\.signInForChat/);
  }
  const appPrivate = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  const rootPrivate = readFileSync(new URL('../../private.html', import.meta.url), 'utf8');
  assert.match(appPrivate, /MuzzPush\.notify\(activeWallet\)/);
  assert.match(rootPrivate, /MuzzPush\.notify\(activeWallet\)/);
  for (const file of ['www/sw.js', '../sw.js']) {
    const sw = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(sw, /body: 'New private message'/);
    assert.doesNotMatch(sw, /payload\.body/);
  }
  const rules = JSON.parse(readFileSync(new URL('../rtdb.fcm.rules.snippet.json', import.meta.url), 'utf8'));
  assert.match(rules.fcmTokens.$wallet['.write'], /auth\.uid == \$wallet/);
  assert.equal(rules.notifyRate['.write'], false);
  assert.equal(rules.loginNonces['.write'], false);
  const firebaseJson = readFileSync(new URL('../firebase.json', import.meta.url), 'utf8');
  assert.doesNotMatch(firebaseJson, /rtdb\.fcm\.rules/);
  const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(gradle, /google-services\.json not found/);
  assert.equal(googleServicesPresent(fileURLToPath(new URL('..', import.meta.url))), false);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies['@capacitor/push-notifications']);
  const sample = "include ':capacitor-push-notifications'\nproject(':capacitor-push-notifications').projectDir = new File('../node_modules/@capacitor/push-notifications/android')\n";
  assert.equal(stripGradlePush('keep\n' + sample + 'tail\n').includes('push-notifications'), false);
  const stripped = stripPluginJson(JSON.stringify([
    { pkg: '@capacitor/app', classpath: 'App' },
    { pkg: '@capacitor/push-notifications', classpath: 'Push' }
  ]));
  assert.equal(stripped.includes('push-notifications'), false);
  const dir = mkdtempSync(join(tmpdir(), 'muzz-push-'));
  mkdirSync(join(dir, 'android', 'app', 'src', 'main', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'android', 'capacitor.settings.gradle'), 'keep\n' + sample);
  writeFileSync(join(dir, 'android', 'app', 'capacitor.build.gradle'), "dependencies {\n    implementation project(':capacitor-push-notifications')\n}\n");
  writeFileSync(join(dir, 'android', 'app', 'src', 'main', 'assets', 'capacitor.plugins.json'), JSON.stringify([
    { pkg: '@capacitor/local-notifications' },
    { pkg: '@capacitor/push-notifications' }
  ]));
  assert.equal(applyAndroidPush(dir), 'local');
  assert.equal(readFileSync(join(dir, 'android', 'capacitor.settings.gradle'), 'utf8').includes('push-notifications'), false);
  writeFileSync(join(dir, 'android', 'app', 'google-services.json'), '{ "project_id": "pulsari" }\n');
  assert.equal(applyAndroidPush(dir), 'fcm');
  const uploaded = mkdtempSync(join(tmpdir(), 'muzz-up-'));
  mkdirSync(join(uploaded, 'uploads'), { recursive: true });
  const services = JSON.stringify({
    project_info: { project_id: 'pulsari' },
    client: [{ client_info: { android_client_info: { package_name: 'app.muzzsnap.chat' } } }]
  });
  writeFileSync(join(uploaded, 'uploads', 'google-services.json'), services);
  const appDir = join(uploaded, 'app');
  mkdirSync(join(appDir, 'android', 'app'), { recursive: true });
  assert.equal(installGoogleServices(appDir).endsWith('google-services.json'), true);
  const saved = JSON.parse(readFileSync(join(appDir, 'android', 'app', 'google-services.json'), 'utf8'));
  assert.equal(saved.project_info.project_id, 'pulsari');
  assert.equal(saved.client[0].client_info.android_client_info.package_name, 'app.muzzsnap.chat');
  const staged = stageVercelProject(join(uploaded, 'stage'));
  const slim = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'));
  assert.equal(slim.dependencies.ethers, SLIM_PACKAGE.dependencies.ethers);
  assert.equal(slim.type, 'module');
  assert.equal(readFileSync(join(staged, 'api', 'notify.js'), 'utf8').includes('process.env.FIREBASE_SERVICE_ACCOUNT'), true);
  assert.equal(readFileSync(join(staged, 'www', 'js', 'fcm-client.js'), 'utf8').includes(PUBLIC_VAPID_KEY), true);
  assert.equal(existsSync(join(staged, 'www', 'config.local.json')), false);
  assert.equal(existsSync(join(staged, 'www', 'js', 'app.js')), false);
  assert.equal(readFileSync(join(staged, 'vercel.json'), 'utf8').includes('"outputDirectory": "www"'), true);
});
