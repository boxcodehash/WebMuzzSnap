import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { Wallet, getAddress, verifyMessage } from 'ethers';

const root = fileURLToPath(new URL('..', import.meta.url));

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

function loadGate(location) {
  const context = {
    ethers: { utils: { getAddress, verifyMessage } },
    localStorage: memoryStorage(),
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    location,
    URL,
    MUZZ_PUBLIC: { appPublicUrl: 'https://muzzsnap-app.vercel.app', walletConnectProjectId: '' }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../www/js/muzz-gate.js', import.meta.url), 'utf8'), context);
  return context.muzzGate;
}

test('los deep links del APK abren la URL pública, no localhost', () => {
  const gate = loadGate({
    origin: 'https://localhost',
    hostname: 'localhost',
    protocol: 'https:',
    host: 'localhost'
  });
  assert.equal(gate.isEmbeddedOrigin(), true);
  const page = gate.loginPageForWallets(true);
  assert.equal(page, 'https://muzzsnap-app.vercel.app/login.html#from=apk');
  const links = gate.walletDeepLinks(page);
  const names = Array.from(links, (item) => String(item.name)).sort();
  assert.deepEqual(names, ['Coinbase Wallet', 'MetaMask', 'OKX', 'Phantom', 'Rainbow', 'Trust Wallet']);
  for (const item of links) {
    const href = String(item.href);
    assert.match(href, /muzzsnap-app\.vercel\.app/);
    assert.doesNotMatch(href, /localhost/);
    if (item.name === 'MetaMask') {
      assert.match(href, /^https:\/\/metamask\.app\.link\/dapp\/muzzsnap-app\.vercel\.app\/login\.html%23from=apk$/);
      continue;
    }
    const once = decodeURIComponent(href);
    const twice = decodeURIComponent(once);
    assert.ok(once.includes(page) || twice.includes(page), item.name);
  }
});

test('el token de vuelta se verifica una sola vez y caduca', async () => {
  const gate = loadGate({
    origin: 'https://muzzsnap-app.vercel.app',
    hostname: 'muzzsnap-app.vercel.app',
    protocol: 'https:',
    host: 'muzzsnap-app.vercel.app'
  });
  const wallet = Wallet.createRandom();
  const exp = Date.now() + 60_000;
  const nonce = 'ab'.repeat(16);
  const message = gate.buildLoginMessage(wallet.address, { nonce, exp, returnApk: true });
  assert.match(message, /Return: apk/);
  assert.match(message, new RegExp(`Nonce: ${nonce}`));
  const signature = await wallet.signMessage(message);
  const token = gate.encodeHandoff({ a: wallet.address, n: nonce, e: exp, s: signature });
  const url = gate.handoffUrl(token);
  assert.match(url, /^muzzsnap:\/\/auth\?token=/);
  assert.equal(gate.tokenFromUrl(url), token);
  const proof = gate.verifyHandoff(token, Date.now());
  assert.equal(proof.address, wallet.address.toLowerCase());
  assert.throws(() => gate.verifyHandoff(token, Date.now()), /ALREADY_USED/);
  const expired = gate.encodeHandoff({ a: wallet.address, n: 'cd'.repeat(16), e: Date.now() - 1000, s: signature });
  assert.throws(() => gate.verifyHandoff(expired, Date.now()), /EXPIRED/);
  const explained = gate.explainSignError(Object.assign(new Error('EXPIRED'), { code: 'expired' }));
  assert.equal(explained.title, 'Sign-in expired.');
  assert.match(explained.desc, /3 minutes/);
});

test('login.html, el manifest y WalletConnect apuntan a la URL pública', () => {
  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  const pub = readFileSync(new URL('../www/config.public.js', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const activity = readFileSync(new URL('../android/app/src/main/java/app/muzzsnap/chat/MainActivity.java', import.meta.url), 'utf8');
  const wallet = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');
  assert.match(pub, /https:\/\/muzzsnap-app\.vercel\.app/);
  assert.match(login, /config\.public\.js/);
  assert.match(login, /loginPageForWallets\(runningInApk\(\) \|\| wantsApkReturn\(\)\)/);
  assert.doesNotMatch(login, /walletDeepLinks\(location\.href/);
  assert.match(login, /muzzAcceptAuth/);
  assert.match(login, /Connect with WalletConnect/);
  assert.match(login, /Continue in this browser/);
  assert.match(login, /explainSignError/);
  assert.match(login, /\.\/js\/wc-login\.js/);
  assert.match(manifest, /android:host="auth"/);
  assert.match(manifest, /android:host="wc"/);
  assert.match(activity, /muzzAcceptAuth/);
  assert.match(activity, /"auth"/);
  assert.match(wallet, /MUZZ_PUBLIC/);
  assert.doesNotMatch(wallet, /return 'https:\/\/localhost'/);
  assert.match(readFileSync(new URL('../src/wc-login.js', import.meta.url), 'utf8'), /connectWalletConnect/);
});

test('APP_PUBLIC_URL se escribe solo si es https', () => {
  const dir = mkdtempSync(join(tmpdir(), 'muzz-pub-'));
  const out = join(dir, 'config.local.json');
  const ok = spawnSync(process.execPath, ['scripts/write-local-config.mjs', out], {
    cwd: root,
    env: { ...process.env, APP_PUBLIC_URL: 'https://muzzsnap-app.vercel.app/', WALLETCONNECT_PROJECT_ID: '' },
    encoding: 'utf8'
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).appPublicUrl, 'https://muzzsnap-app.vercel.app');
  const bad = spawnSync(process.execPath, ['scripts/write-local-config.mjs', join(dir, 'bad.json')], {
    cwd: root,
    env: { ...process.env, APP_PUBLIC_URL: 'http://insecure.example' },
    encoding: 'utf8'
  });
  assert.equal(bad.status, 1);
  rmSync(dir, { recursive: true, force: true });
});
