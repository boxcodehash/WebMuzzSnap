import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { getGoogleAccessToken, resetGoogleCaches, signJwt, tokenId } from '../server/google.js';
import { proveLogin } from '../server/login-proof.js';
import { buildLoginMessage } from '../src/login-client.js';
import {
  NOTIFICATION_BODY,
  PUBLIC_VAPID_KEY,
  buildFcmMessage,
  handleNotify,
  handleNotifySelf,
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
    if (u.includes('ethereum.publicnode.com') || u.includes('eth.drpc.org') || u.includes('rpc.ankr.com')) {
      const rpcBody = JSON.parse(opts.body || '{}');
      const data = rpcBody.params && rpcBody.params[0] && rpcBody.params[0].data || '';
      if (String(data).startsWith('0x313ce567')) {
        return jsonResponse(200, { jsonrpc: '2.0', id: 1, result: '0x12' });
      }
      return jsonResponse(200, { jsonrpc: '2.0', id: 1, result: '0x84595161401484a000000' });
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
  assert.equal(android.message.notification.title, 'MuzzSnap');
  assert.equal(android.message.notification.body, NOTIFICATION_BODY);
  assert.equal(android.message.android.priority, 'HIGH');
  assert.equal(android.message.android.notification.channel_id, 'private');
  assert.equal(android.message.android.notification.icon, 'ic_stat_muzzsnap');
  assert.equal(android.message.android.notification.notification_priority, 'PRIORITY_HIGH');
  assert.equal(android.message.data.open, 'private.html');
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
  const message = buildLoginMessage(sender.address, nonce, exp, new Date(now).toISOString());
  const signature = await sender.signMessage(message);
  assert.equal(proveLogin(message, signature, now).wallet, senderWallet);
  assert.equal(proveLogin(message, signature, exp + 1), null);
  const rootMessage = [
    'MuzzSnap Login',
    '',
    'Sign this message to verify your wallet.',
    'You will continue in this browser after signing.',
    '',
    'Wallet: ' + sender.address,
    'Issued: ' + new Date(now).toISOString()
  ].join('\n');
  const rootSig = await sender.signMessage(rootMessage);
  assert.equal(proveLogin(rootMessage, rootSig, now), null);
  assert.equal(proveLogin(message, await recipient.signMessage(message), now), null);
  assert.equal(rootSig.startsWith('0x'), true);

  const db = {};
  db['loginIssued/' + nonce] = { exp };
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
  assert.equal(replay.body.error, 'nonce_used');

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

  const selfDenied = await handleNotifySelf(
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: { to: recipientWallet, text: SECRET },
      now
    },
    { env, fetchImpl }
  );
  assert.equal(selfDenied.status, 200);
  assert.equal(selfDenied.body.sent, 0);
  const ownToken = 'android-self-token-1234567890';
  db['fcmTokens/' + senderWallet] = {
    [tokenId(ownToken)]: { token: ownToken, platform: 'android', updatedAt: 1 }
  };
  const before = calls.filter((call) => call.url.startsWith('https://fcm.googleapis.com/')).length;
  const selfSent = await handleNotifySelf(
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: { to: recipientWallet, text: SECRET },
      now: now + 60_000
    },
    { env, fetchImpl }
  );
  assert.equal(selfSent.status, 200);
  assert.equal(selfSent.body.sent, 1);
  const selfCalls = calls.filter((call) => call.url.startsWith('https://fcm.googleapis.com/')).slice(before);
  assert.equal(selfCalls.length, 1);
  const selfBody = JSON.parse(selfCalls[0].body);
  assert.equal(selfBody.message.token, ownToken);
  assert.equal(selfBody.message.notification.body, NOTIFICATION_BODY);
  assert.equal(selfBody.message.android.priority, 'HIGH');
  assert.equal(selfBody.message.android.notification.channel_id, 'private');
  assert.equal(JSON.stringify(selfBody).includes(SECRET), false);
  assert.equal(JSON.stringify(selfBody).includes(recipientWallet), false);

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
    assert.match(source, /\/api\/notify-self/);
    assert.match(source, /\/api\/register-token/);
    assert.match(source, /statusLine/);
    assert.match(source, /__muzzNativeFcmToken/);
    if (source === appClient) assert.match(source, /authStateReady/);
    assert.match(source, /muzzsnap-app\.vercel\.app/);
    assert.match(source, /BD4Waq9Zdd8iVPmAvv3K4brWllOezeIREB_X_m6ijlit0ffs9Ff9GQJc8pjzCefT03A3lshYXCNDmUOPk6sIkew/);
  }
  const notifyFn = readFileSync(new URL('../api/push.js', import.meta.url), 'utf8');
  assert.match(notifyFn, /process\.env\.FIREBASE_SERVICE_ACCOUNT/);
  assert.match(notifyFn, /env: process\.env/);
  assert.match(notifyFn, /handleNotifySelf/);
  for (const file of ['www/private.html', 'www/chat.html']) {
    const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(html, /fcm-client\.js/);
    assert.match(html, /MuzzPush\.signInForChat/);
  }
  const appPrivate = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  const rootPrivate = readFileSync(new URL('../../private.html', import.meta.url), 'utf8');
  assert.match(appPrivate, /MuzzPush\.notify\(activeWallet\)/);
  assert.match(rootPrivate, /MuzzPush\.notify\(activeWallet\)/);
  assert.doesNotMatch(appPrivate, /Send test notification/);
  assert.doesNotMatch(appPrivate, /Check for updates|Check update/);
  assert.match(appPrivate, /id="muzzPushStatus"/);
  assert.doesNotMatch(readFileSync(new URL('../www/chat.html', import.meta.url), 'utf8'), /Send test notification/);
  assert.doesNotMatch(readFileSync(new URL('../www/chat.html', import.meta.url), 'utf8'), /Check for updates|Check update/);
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /POST_NOTIFICATIONS/);
  assert.match(manifest, /default_notification_icon/);
  assert.match(manifest, /ic_stat_muzzsnap/);
  assert.match(manifest, /default_notification_channel_id/);
  assert.match(manifest, /android:name="\.MuzzApp"/);
  const icon = readFileSync(new URL('../android/app/src/main/res/drawable/ic_stat_muzzsnap.xml', import.meta.url), 'utf8');
  assert.match(icon, /#FFFFFF/);
  const alerts = readFileSync(new URL('../android/app/src/main/java/app/muzzsnap/chat/PushAlerts.java', import.meta.url), 'utf8');
  assert.match(alerts, /IMPORTANCE_HIGH/);
  assert.match(alerts, /POST_NOTIFICATIONS/);
  assert.match(alerts, /fcm token obtained/);
  assert.match(alerts, /getScheme\(\)/);
  assert.match(alerts, /getHost\(\)/);
  assert.match(alerts, /\/private\.html/);
  assert.doesNotMatch(alerts, /https:\/\/localhost\/private\.html/);
  assert.match(readFileSync(new URL('../api/push.js', import.meta.url), 'utf8'), /handleNotifySelf/);
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
  const appRoot = fileURLToPath(new URL('..', import.meta.url));
  assert.equal(googleServicesPresent(appRoot), true);
  const services = JSON.parse(readFileSync(new URL('../android/app/google-services.json', import.meta.url), 'utf8'));
  assert.equal(services.project_info.project_id, 'pulsari');
  assert.equal(services.project_info.project_number, '824306321233');
  assert.equal(services.client[0].client_info.mobilesdk_app_id, '1:824306321233:android:ad4f9716c07ef75f60b570');
  assert.equal(services.client[0].client_info.android_client_info.package_name, 'app.muzzsnap.chat');
  assert.equal(services.client[0].api_key[0].current_key, 'AIzaSyD3fgJ1qJ5s3qOItx5Ykuk-XEutROtRX0w');
  assert.equal(JSON.stringify(services).includes('private_key'), false);
  const settings = readFileSync(new URL('../android/capacitor.settings.gradle', import.meta.url), 'utf8');
  const capBuild = readFileSync(new URL('../android/app/capacitor.build.gradle', import.meta.url), 'utf8');
  assert.match(settings, /capacitor-push-notifications/);
  assert.match(capBuild, /capacitor-push-notifications/);
  const capacitor = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'));
  assert.deepEqual(capacitor.plugins.PushNotifications.presentationOptions, ['badge', 'sound', 'alert']);
  assert.equal(capacitor.server.url, undefined);
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
  const uploadedServices = JSON.stringify({
    project_info: { project_id: 'pulsari' },
    client: [{ client_info: { android_client_info: { package_name: 'app.muzzsnap.chat' } } }]
  });
  writeFileSync(join(uploaded, 'uploads', 'google-services.json'), uploadedServices);
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
  assert.equal(existsSync(join(staged, 'api', 'notify.js')), false);
  assert.equal(readFileSync(join(staged, 'api', 'push.js'), 'utf8').includes('process.env.FIREBASE_SERVICE_ACCOUNT'), true);
  assert.ok(readdirSync(join(staged, 'api')).filter((name) => name.endsWith('.js')).length <= 8);
  assert.equal(readFileSync(join(staged, 'www', 'js', 'fcm-client.js'), 'utf8').includes(PUBLIC_VAPID_KEY), true);
  assert.equal(existsSync(join(staged, 'www', 'config.local.json')), false);
  assert.equal(existsSync(join(staged, 'www', 'js', 'app.js')), false);
  assert.equal(readFileSync(join(staged, 'vercel.json'), 'utf8').includes('"outputDirectory": "www"'), true);
});

test('the Google token includes the email scope Firebase RTDB requires', async () => {
  resetGoogleCaches();
  let scope = '';
  await getGoogleAccessToken(account, async (url, opts = {}) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(opts.body).get('assertion');
    scope = JSON.parse(Buffer.from(String(assertion).split('.')[1], 'base64url').toString('utf8')).scope;
    return jsonResponse(200, { access_token: 'ya29.test', expires_in: 3600 });
  }, Date.now());
  assert.match(scope, /https:\/\/www\.googleapis\.com\/auth\/firebase\.messaging/);
  assert.match(scope, /https:\/\/www\.googleapis\.com\/auth\/firebase\.database/);
  assert.match(scope, /https:\/\/www\.googleapis\.com\/auth\/userinfo\.email/);
});

test('a failed nonce logs the RTDB status and not the token', async () => {
  resetGoogleCaches();
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await handleSession(
      { method: 'GET', url: '/api/session?op=nonce', query: { op: 'nonce' }, now: Date.now() },
      {
        env,
        fetchImpl: async (url) => {
          const u = String(url);
          if (u.startsWith('https://oauth2.googleapis.com/token')) {
            return jsonResponse(200, { access_token: 'ya29.secret-token', expires_in: 3600 });
          }
          return jsonResponse(401, { error: 'Unauthorized request.' });
        }
      }
    );
    assert.equal(result.status, 502);
    assert.equal(result.body.error, 'session_failed');
    const text = warnings.join('\n');
    assert.match(text, /session failed: rtdb 401/);
    assert.equal(text.includes('ya29.secret-token'), false);
    assert.equal(text.includes('FIREBASE_SERVICE_ACCOUNT'), false);
  } finally {
    console.warn = original;
  }
});
