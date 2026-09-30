import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { Wallet } from 'ethers';
import { readMuzzHolding } from '../server/muzz-balance.js';
import { handleSession } from '../server/push.js';
import {
  EXEMPT_WALLET,
  MIN_WHOLE,
  MUZZ_TOKEN,
  PUBLIC_APP,
  buildLoginMessage,
  clearStorageKeys,
  dappUrl,
  discoverInjected,
  explainLoginError,
  guardWalletReturn,
  installWalletReturnGuard,
  isMobileBrowser,
  isNativeApp,
  loginWithWallet,
  openWalletForSignature,
  pickInjected,
  readMuzzBalance,
  rememberWalletUri,
  restoredAddressFromStorage,
  shortAddress,
  shouldShowQrModal,
  useDeepLinks,
  walletConnectPlan,
  walletRedirect
} from '../src/login-client.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
    type: 'service_account',
    project_id: 'pulsari',
    private_key_id: 'testkey',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
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

function rpcResult(data, balance = '0x84595161401484a000000') {
  if (String(data).startsWith('0x313ce567')) return '0x12';
  return balance;
}

function mockBackend(db, opts = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = String(url);
    calls.push(u);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse(200, { access_token: 'ya29.test', expires_in: 3600 });
    }
    if (u.includes('ethereum.publicnode.com') || u.includes('eth.drpc.org') || u.includes('rpc.ankr.com')) {
      if (opts.rpcFails) throw new Error('RPC unreachable');
      const body = JSON.parse(init.body || '{}');
      const data = body.params && body.params[0] && body.params[0].data || '';
      return jsonResponse(200, { jsonrpc: '2.0', id: 1, result: rpcResult(data, opts.balance) });
    }
    if (u.includes('firebaseio.com')) {
      const path = decodeURIComponent(new URL(u).pathname.replace(/^\//, '').replace(/\.json$/, ''));
      if (method === 'GET') return jsonResponse(200, Object.prototype.hasOwnProperty.call(db, path) ? db[path] : null);
      if (method === 'PUT') {
        db[path] = JSON.parse(init.body);
        return jsonResponse(200, db[path]);
      }
    }
    return jsonResponse(500, { error: 'unexpected' });
  };
  return { fetchImpl, calls };
}

test('the SIWE login message and error text stay specific', () => {
  const address = '0x' + 'ab'.repeat(20);
  const exp = Date.parse('2026-09-30T02:00:00.000Z');
  const message = buildLoginMessage(address, 'CD'.repeat(16), exp, '2026-09-30T01:50:00.000Z');
  assert.match(message, /^muzzsnap-app\.vercel\.app wants you to sign in with your Ethereum account:\n/);
  assert.match(message, /Sign in to MuzzSnap\. This request does not spend gas or approve a token\./);
  assert.match(message, /URI: https:\/\/muzzsnap-app\.vercel\.app\/login\.html/);
  assert.match(message, /Chain ID: 1/);
  assert.match(message, new RegExp('Nonce: ' + 'cd'.repeat(16)));
  assert.match(message, /Expiration Time: 2026-09-30T02:00:00.000Z/);
  assert.doesNotMatch(message, /MuzzSnap Login|Token:|optionalChains|eth_sign/);
  assert.equal(message.split('\n')[0], 'muzzsnap-app.vercel.app wants you to sign in with your Ethereum account:');
  assert.equal(MUZZ_TOKEN, '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0');
  assert.equal(MIN_WHOLE, 10_000_000n);
  assert.equal(EXEMPT_WALLET, '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a');

  const crashed = explainLoginError(Object.assign(new Error('Buffer is not defined'), { code: 'rejected' }));
  assert.equal(crashed.title, 'Could not open the wallet list.');
  assert.match(crashed.desc, /Buffer is not defined/);
  assert.doesNotMatch(crashed.title + ' ' + crashed.desc, /Signature rejected|cancelled the connection/);

  const denied = explainLoginError(Object.assign(new Error('user rejected the request'), { code: 4001 }));
  assert.equal(denied.title, 'The wallet did not sign.');
  assert.match(denied.desc, /user rejected the request/);

  const low = explainLoginError(Object.assign(new Error('Insufficient MUZZ balance. You have 1 MUZZ'), { code: 'balance' }));
  assert.equal(low.title, 'Insufficient MUZZ balance.');
  assert.equal(dappUrl({ hostname: 'localhost', origin: 'https://localhost' }), PUBLIC_APP);
  assert.equal(dappUrl({ hostname: 'muzzsnap-app.vercel.app', origin: 'https://muzzsnap-app.vercel.app' }), PUBLIC_APP);
});

test('balance reads the public RPC and the exempt wallet skips it', async () => {
  let fetches = 0;
  const exempt = await readMuzzBalance(EXEMPT_WALLET, async () => {
    fetches += 1;
    throw new Error('should not fetch');
  });
  assert.equal(exempt.ok, true);
  assert.equal(exempt.exempt, true);
  assert.equal(fetches, 0);

  const holding = await readMuzzBalance('0x' + '11'.repeat(20), async (url, init) => {
    fetches += 1;
    const body = JSON.parse(init.body);
    const data = body.params[0].data;
    const result = String(data).startsWith('0x313ce567') ? '0x12' : '0x1';
    return { json: async () => ({ result }) };
  });
  assert.equal(holding.ok, false);
  assert.equal(fetches, 2);

  const enough = await readMuzzBalance('0x' + '22'.repeat(20), async (_url, init) => {
    const data = JSON.parse(init.body).params[0].data;
    const result = String(data).startsWith('0x313ce567') ? '0x12' : '0x84595161401484a000000';
    return { json: async () => ({ result }) };
  });
  assert.equal(enough.ok, true);
  assert.equal(enough.formatted, '10,000,000');
});

test('wallet login checks balance before the single personal_sign', async () => {
  const address = '0x' + 'cd'.repeat(20);
  const order = [];
  const ethereum = {
    async request({ method }) {
      order.push(method);
      if (method === 'eth_requestAccounts') return [address];
      if (method === 'personal_sign') return '0x' + '22'.repeat(65);
      throw new Error(method);
    }
  };
  await assert.rejects(
    loginWithWallet({
      ethereum,
      storage: { getItem: () => null, setItem() {}, removeItem() {} },
      readBalance: async () => {
        order.push('balance');
        return { ok: false, formatted: '3,470,436', raw: '1' };
      },
      nonce: async () => { order.push('nonce'); return { nonce: 'ab'.repeat(16) }; }
    }),
    (err) => err && err.code === 'balance' && err.message === 'Wallet ' + shortAddress(address) + ' has 3,470,436 MUZZ; minimum is 10,000,000.'
  );
  assert.deepEqual(order, ['nonce', 'eth_requestAccounts', 'eth_chainId', 'balance', 'personal_sign']);

  order.length = 0;
  const result = await loginWithWallet({
    ethereum: null,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    connectWc: async () => {
      order.push('wc');
      return {
        accounts: [address],
        request: async ({ method }) => {
          order.push(method);
          return '0x' + '33'.repeat(65);
        }
      };
    },
    readBalance: async () => { order.push('balance'); return { ok: true, formatted: '10,000,000' }; },
      nonce: async () => { order.push('nonce'); return { nonce: 'ef'.repeat(16), exp: Date.now() + 60_000 }; },
    exchange: async (message, signature) => {
      order.push('exchange');
      assert.match(message, /^muzzsnap-app\.vercel\.app wants you to sign in/);
      assert.match(message, /Chain ID: 1/);
      assert.doesNotMatch(message, /Chain ID: 56|eth_sign/);
      assert.match(signature, /^0x/);
      return { customToken: 'custom' };
    }
  });
  assert.equal(result.customToken, 'custom');
  assert.deepEqual(order, ['nonce', 'wc', 'balance', 'personal_sign', 'exchange']);

  order.length = 0;
  const slow = await loginWithWallet({
    ethereum: null,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    connectWc: async () => {
      order.push('wc');
      return {
        accounts: [address],
        request: async ({ method }) => {
          order.push(method);
          return '0x' + '33'.repeat(65);
        }
      };
    },
    readBalance: () => {
      order.push('balance');
      return new Promise(() => {});
    },
    nonce: async () => { order.push('nonce'); return { nonce: 'ef'.repeat(16), exp: Date.now() + 60_000 }; },
    exchange: async () => {
      order.push('exchange');
      return { customToken: 'custom' };
    }
  });
  assert.equal(slow.customToken, 'custom');
  assert.deepEqual(order, ['nonce', 'wc', 'balance', 'personal_sign', 'exchange']);
});

test('the server nonce, short signature, balance, and exempt wallet', async () => {
  const wallet = Wallet.createRandom();
  const now = 1_700_000_000_000;
  const db = {};
  const backend = mockBackend(db);
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const issued = await handleSession(
      { method: 'GET', url: '/api/session?op=nonce', query: { op: 'nonce' }, now },
      { env, fetchImpl: backend.fetchImpl }
    );
    assert.equal(issued.status, 200);
    assert.match(issued.body.nonce, /^[a-f0-9]{32}$/);
    assert.equal(db['loginIssued/' + issued.body.nonce].exp, now + 10 * 60 * 1000);

    const message = buildLoginMessage(wallet.address, issued.body.nonce, issued.body.exp, new Date(now).toISOString());
    const signature = await wallet.signMessage(message);
    const ok = await handleSession(
      { method: 'POST', body: { message, signature }, now },
      { env, fetchImpl: backend.fetchImpl }
    );
    assert.equal(ok.status, 200);
    assert.ok(ok.body.customToken);

    const reused = await handleSession(
      { method: 'POST', body: { message, signature }, now },
      { env, fetchImpl: backend.fetchImpl }
    );
    assert.equal(reused.status, 401);
    assert.equal(reused.body.error, 'nonce_used');

    const missing = buildLoginMessage(wallet.address, 'ab'.repeat(16), now + 60_000, new Date(now).toISOString());
    const missingSig = await wallet.signMessage(missing);
    const unknown = await handleSession(
      { method: 'POST', body: { message: missing, signature: missingSig }, now },
      { env, fetchImpl: backend.fetchImpl }
    );
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, 'bad_format');

    const bad = await handleSession(
      { method: 'POST', body: { message, signature: await Wallet.createRandom().signMessage(message) }, now: now + 1 },
      { env, fetchImpl: mockBackend(db).fetchImpl }
    );
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'bad_signature');

    const staleNonce = '12'.repeat(16);
    db['loginIssued/' + staleNonce] = { exp: now - 1 };
    const staleMessage = buildLoginMessage(wallet.address, staleNonce, now - 1, new Date(now - 60_000).toISOString());
    const stale = await handleSession(
      { method: 'POST', body: { message: staleMessage, signature: await wallet.signMessage(staleMessage) }, now },
      { env, fetchImpl: backend.fetchImpl }
    );
    assert.equal(stale.status, 401);
    assert.equal(stale.body.error, 'expired');
    assert.equal(db['loginNonces/' + staleNonce], undefined);

    const lowNonce = '34'.repeat(16);
    db['loginIssued/' + lowNonce] = { exp: now + 60_000 };
    const lowMessage = buildLoginMessage(wallet.address, lowNonce, now + 60_000, new Date(now).toISOString());
    const lowBackend = mockBackend(db, { balance: '0x1' });
    const low = await handleSession(
      { method: 'POST', body: { message: lowMessage, signature: await wallet.signMessage(lowMessage) }, now },
      { env, fetchImpl: lowBackend.fetchImpl }
    );
    assert.equal(low.status, 403);
    assert.equal(low.body.error, 'balance');
    assert.equal(db['loginNonces/' + lowNonce], undefined);

    const downNonce = '56'.repeat(16);
    db['loginIssued/' + downNonce] = { exp: now + 60_000 };
    const downMessage = buildLoginMessage(wallet.address, downNonce, now + 60_000, new Date(now).toISOString());
    const down = await handleSession(
      { method: 'POST', body: { message: downMessage, signature: await wallet.signMessage(downMessage) }, now },
      { env, fetchImpl: mockBackend(db, { rpcFails: true }).fetchImpl }
    );
    assert.equal(down.status, 503);
    assert.equal(down.body.error, 'balance_unavailable');

    let exemptFetches = 0;
    const exemptHolding = await readMuzzHolding(EXEMPT_WALLET, async () => {
      exemptFetches += 1;
      throw new Error('exempt wallet must not hit an RPC');
    });
    assert.equal(exemptHolding.ok, true);
    assert.equal(exemptHolding.exempt, true);
    assert.equal(exemptFetches, 0);
    assert.equal(warnings.join('\n').includes(signature), false);
    assert.match(warnings.join('\n'), /session rejected: nonce_used/);
  } finally {
    console.warn = original;
  }
});

function mapStorage(initial) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key(index) { return Array.from(data.keys())[index] || null; },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

test('a stored WalletConnect account is shown data, not the cached address, and disconnect clears it', async () => {
  const stale = '0x' + 'b'.repeat(40);
  const cached = '0x' + 'a'.repeat(40);
  const storage = mapStorage({
    muzz_wallet_address: cached,
    'wc@2:client:0.3//session': JSON.stringify({
      namespaces: { eip155: { accounts: ['eip155:1:' + stale] } }
    }),
    muzz_debug: '1'
  });
  assert.equal(restoredAddressFromStorage(storage), stale);
  assert.equal(shortAddress(stale), '0xbbbb…bbbb');
  const removed = clearStorageKeys(storage);
  assert.equal(storage.getItem('wc@2:client:0.3//session'), null);
  assert.equal(storage.getItem('muzz_wallet_address'), null);
  assert.equal(storage.getItem('muzz_debug'), '1');
  assert.ok(removed.includes('wc@2:client:0.3//session'));

  const logs = [];
  let checked = '';
  const restored = '0x' + 'c'.repeat(40);
  const result = await loginWithWallet({
    restored: true,
    ethereum: null,
    provider: {
      accounts: [restored, '0x' + 'd'.repeat(40)],
      chainId: 1,
      async request({ method }) {
        if (method === 'personal_sign') return '0x' + '44'.repeat(65);
        throw new Error(method);
      }
    },
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    readBalance: async (address) => {
      checked = address;
      return { ok: true, formatted: '100,000,000', raw: '2' };
    },
    nonce: async () => ({ nonce: 'ab'.repeat(16) }),
    exchange: async () => ({ customToken: 'token' }),
    connectWc: async () => { throw new Error('fresh connect should not run'); },
    log: (label) => logs.push(label)
  });
  assert.equal(checked, restored);
  assert.equal(result.address, restored);
  assert.equal(logs.includes('session:restored'), true);
  assert.equal(logs.includes('address:' + restored), true);
  assert.equal(logs.includes('chainId:1'), true);
  assert.equal(logs.includes('accounts:2'), true);
  assert.match(logs.find((line) => line.startsWith('balance:result')), /100,000,000/);
});

test('the APK return is muzzsnap://wc and wallet browsers are not opened', () => {
  assert.deepEqual(walletRedirect(PUBLIC_APP, true), { native: 'muzzsnap://wc' });
  assert.equal(walletRedirect(PUBLIC_APP, true).universal, undefined);
  assert.deepEqual(walletRedirect(PUBLIC_APP, false), { universal: PUBLIC_APP + '/login.html' });
  assert.equal(walletRedirect(PUBLIC_APP, false).native, undefined);
  const opened = [];
  const root = {
    open(url) {
      opened.push(url);
      return null;
    }
  };
  installWalletReturnGuard(root);
  rememberWalletUri('wc:abc');
  root.open('https://metamask.app.link/dapp/muzzsnap-app.vercel.app/login.html');
  root.open('https://phantom.app/ul/browse/https%3A%2F%2Fexample');
  root.open('https://metamask.app.link/wc?uri=' + encodeURIComponent('wc:abc'));
  const native = 'metamask://wc?uri=' + encodeURIComponent('wc:abc');
  assert.deepEqual(opened, [native, native, native]);
});

function desktopRoot() {
  return { navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0', platform: 'Win32', maxTouchPoints: 0 } };
}

function mobileRoot() {
  return { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5 } };
}

function apkRoot() {
  return {
    Capacitor: { isNativePlatform() { return true; }, getPlatform() { return 'android'; } },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile', platform: 'Linux armv8l', maxTouchPoints: 5 }
  };
}

test('desktop shows the QR, mobile browsers deep-link back to the site, and the APK keeps muzzsnap://wc', () => {
  const desk = walletConnectPlan(desktopRoot());
  assert.equal(isMobileBrowser(desktopRoot()), false);
  assert.equal(isNativeApp(desktopRoot()), false);
  assert.equal(useDeepLinks(desktopRoot()), false);
  assert.equal(desk.deepLinks, false);
  assert.equal(desk.guard, false);
  assert.equal(desk.showQrModal, true);
  assert.deepEqual(desk.redirect, { universal: PUBLIC_APP + '/login.html' });
  assert.equal(desk.linkReturn, PUBLIC_APP + '/login.html');
  assert.equal(shouldShowQrModal(desktopRoot()), true);

  const phone = walletConnectPlan(mobileRoot());
  assert.equal(isMobileBrowser(mobileRoot()), true);
  assert.equal(phone.deepLinks, true);
  assert.equal(phone.guard, false);
  assert.equal(phone.showQrModal, false);
  assert.deepEqual(phone.redirect, { universal: PUBLIC_APP + '/login.html' });
  assert.equal(phone.linkReturn, PUBLIC_APP + '/login.html');
  assert.equal(shouldShowQrModal({ ...mobileRoot(), showModal: true }), true);

  const apk = walletConnectPlan(apkRoot());
  assert.equal(isNativeApp(apkRoot()), true);
  assert.equal(isMobileBrowser(apkRoot()), false);
  assert.equal(apk.deepLinks, true);
  assert.equal(apk.guard, true);
  assert.equal(apk.showQrModal, false);
  assert.deepEqual(apk.redirect, { native: 'muzzsnap://wc' });
  assert.equal(apk.linkReturn, 'muzzsnap://wc');
  assert.equal(guardWalletReturn(desktopRoot()), false);
  assert.equal(guardWalletReturn(mobileRoot()), false);
  const opened = [];
  const native = apkRoot();
  native.window = { open(url) { opened.push(url); return null; } };
  assert.equal(guardWalletReturn(native), true);
  rememberWalletUri('wc:abc');
  native.window.open('https://metamask.app.link/dapp/muzzsnap-app.vercel.app/login.html');
  assert.equal(opened[0], 'metamask://wc?uri=' + encodeURIComponent('wc:abc'));
  rememberWalletUri('wc:sign');
  const phoneHref = openWalletForSignature({ ...mobileRoot(), walletId: 'metamask' });
  assert.equal(phoneHref, 'metamask://');
  assert.doesNotMatch(phoneHref, /uri=/);
  const apkHref = openWalletForSignature({ ...apkRoot(), walletId: 'phantom' });
  assert.equal(apkHref, 'phantom://');
  assert.doesNotMatch(apkHref, /uri=/);
});

test('EIP-6963 prefers MetaMask over a hijacked window.ethereum', async () => {
  const calls = [];
  const address = '0x' + 'ab'.repeat(20);
  const phantom = {
    isMetaMask: true,
    async request() { calls.push('phantom'); return [address]; }
  };
  const metamask = {
    async request({ method }) {
      calls.push('metamask:' + method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'personal_sign') return '0x' + '11'.repeat(65);
      throw new Error(method);
    }
  };
  const root = new EventTarget();
  root.navigator = desktopRoot().navigator;
  root.ethereum = phantom;
  root.addEventListener('eip6963:requestProvider', () => {
    root.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { rdns: 'app.phantom', name: 'Phantom' }, provider: phantom }
    }));
    root.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { rdns: 'io.metamask', name: 'MetaMask' }, provider: metamask }
    }));
  });
  const found = await discoverInjected(root, 0);
  assert.equal(pickInjected(found, phantom), metamask);
  const result = await loginWithWallet({
    root,
    discoverMs: 0,
    walletId: 'metamask',
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    readBalance: async () => ({ ok: true, formatted: '10,000,000' }),
    nonce: async () => ({ nonce: 'cd'.repeat(16), exp: Date.now() + 60_000 }),
    exchange: async (message, signature) => {
      assert.match(message, /Chain ID: 1/);
      assert.equal(signature, '0x' + '11'.repeat(65));
      return { customToken: 'custom' };
    }
  });
  assert.equal(result.customToken, 'custom');
  assert.equal(calls.filter((item) => item === 'phantom').length, 0);
  assert.equal(calls.filter((item) => item === 'metamask:personal_sign').length, 1);
});
