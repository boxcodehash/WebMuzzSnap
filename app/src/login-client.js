import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { SUPPORTED_WALLETS, NATIVE_RETURN } from './walletCatalog.js';
import { rewriteWalletOpen } from './walletLinks.js';

export const MUZZ_TOKEN = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';
export const MIN_WHOLE = 10_000_000n;
export const EXEMPT_WALLET = '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a';
export const PUBLIC_APP = 'https://muzzsnap-app.vercel.app';
const PROJECT_ID = '8ff03dad157892146048cfe2b4e381ca';
const RPCS = [
  'https://ethereum.publicnode.com',
  'https://eth.drpc.org',
  'https://rpc.ankr.com/eth'
];
const SIGN_KEY = 'muzz_sign_once';

export function buildLoginMessage(address, nonce) {
  return ['MuzzSnap', 'Wallet: ' + address, 'Nonce: ' + String(nonce || '').toLowerCase()].join('\n');
}

export function shortAddress(address) {
  const value = String(address || '');
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return '';
  return value.slice(0, 6) + '…' + value.slice(-4);
}

export function shouldClearStorageKey(key) {
  const name = String(key || '');
  if (!name || name === 'muzz_debug' || name === 'muzz_debug_log') return false;
  return /^(wc@2|W3M|@appkit|walletconnect|WALLETCONNECT|wagmi)/i.test(name)
    || /walletconnect|appkit|^w3m/i.test(name)
    || name === 'muzz_wallet_address'
    || name === 'muzz_session'
    || name === 'muzz_login_hold'
    || name === 'muzz_login_msg'
    || name === 'muzz_login_sig'
    || name === 'muzz_sign_once';
}

function eip155Address(value) {
  const match = String(value || '').match(/eip155:\d+:(0x[a-fA-F0-9]{40})/i);
  return match ? match[1].toLowerCase() : '';
}

function storageKeys(storage) {
  const keys = [];
  if (!storage) return keys;
  try {
    for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
  } catch {
    /* private mode */
  }
  return keys;
}

export function restoredAddressFromStorage(storage) {
  let own = '';
  let walletConnect = '';
  for (const key of storageKeys(storage)) {
    let value = '';
    try { value = storage.getItem(key) || ''; } catch { value = ''; }
    if (key === 'muzz_wallet_address' && /^0x[a-fA-F0-9]{40}$/i.test(value)) own = value.toLowerCase();
    if (key !== 'muzz_wallet_address' && shouldClearStorageKey(key)) {
      const found = eip155Address(value);
      if (found) walletConnect = found;
    }
  }
  return walletConnect || own;
}

export function clearStorageKeys(storage) {
  const removed = [];
  for (const key of storageKeys(storage)) {
    if (!shouldClearStorageKey(key)) continue;
    try {
      storage.removeItem(key);
      removed.push(key);
    } catch {
      /* private mode */
    }
  }
  return removed;
}

export function explainLoginError(err) {
  const msg = String((err && (err.message || err.reason)) || 'Unknown error');
  const code = err && err.code != null ? String(err.code) : '';
  if (/buffer is not defined/i.test(msg) || code === 'buffer') {
    return { title: 'Could not open the wallet list.', desc: msg };
  }
  if (code === 'balance' || /insufficient muzz/i.test(msg)) {
    return { title: 'Insufficient MUZZ balance.', desc: msg };
  }
  if (code === 'rpc' || code === 'balance_unavailable' || /rpc unreachable|could not read the muzz balance/i.test(msg)) {
    return { title: 'Could not read the MUZZ balance.', desc: msg };
  }
  if (code === 'sign_pending') {
    return { title: 'A signature is already open.', desc: msg };
  }
  if (code === 'sign' || code === '4001' || /user rejected|user denied/i.test(msg)) {
    return { title: 'The wallet did not sign.', desc: msg };
  }
  if (code === 'no_account') {
    return { title: 'No account returned.', desc: msg };
  }
  if (code === 'server' || code === 'expired' || code === 'nonce_used' || code === 'bad_signature' || code === 'bad_format') {
    return { title: 'The server refused the sign-in.', desc: msg };
  }
  return { title: 'Could not connect the wallet.', desc: msg };
}

export function isNativeApp(root = globalThis) {
  try {
    const cap = root.Capacitor || (root.window && root.window.Capacitor);
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true;
    const platform = cap && typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
    if (platform === 'android' || platform === 'ios') return true;
  } catch {
    /* a normal browser has no Capacitor bridge */
  }
  return false;
}

/** Native return only inside the APK. A website universal link makes the wallet open its browser. */
export function walletRedirect(origin, nativeApp) {
  const redirect = { native: NATIVE_RETURN };
  if (!nativeApp) redirect.universal = String(origin || PUBLIC_APP).replace(/\/$/, '') + '/login.html';
  return redirect;
}

let pendingWcUri = '';

export function rememberWalletUri(uri) {
  const value = String(uri || '');
  if (value.startsWith('wc:')) pendingWcUri = value;
  return pendingWcUri;
}

/** window.open must not load /dapp/ or another wallet browser. Native wc: links stay. */
export function installWalletReturnGuard(root = globalThis) {
  const win = root.window || root;
  if (!win || win.__muzzWalletGuard) return;
  const original = typeof win.open === 'function' ? win.open.bind(win) : null;
  win.open = (url, target, features) => {
    const next = rewriteWalletOpen(String(url || ''), pendingWcUri);
    if (!next) return null;
    return original ? original(next, target, features) : null;
  };
  win.__muzzWalletGuard = true;
}

export function dappUrl(loc) {
  try {
    const host = loc.hostname;
    const origin = loc.origin;
    if (host && host !== 'localhost' && host !== '127.0.0.1' && /^https?:/i.test(origin)) return origin.replace(/\/$/, '');
  } catch {
    /* the APK WebView origin is https://localhost and must not be sent to WalletConnect */
  }
  return PUBLIC_APP;
}

function formatWhole(raw, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = BigInt(raw) / base;
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function ethCall(fetchImpl, to, data) {
  let last = 'RPC unreachable';
  for (const url of RPCS) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout(8000)
      });
      const json = await res.json();
      if (json && typeof json.result === 'string' && /^0x[0-9a-fA-F]+$/.test(json.result)) return json.result;
      last = (json && json.error && json.error.message) || 'RPC unreachable';
    } catch (err) {
      last = err && err.message ? err.message : 'RPC unreachable';
    }
  }
  const error = new Error('Could not read the MUZZ balance. ' + last);
  error.code = 'rpc';
  throw error;
}

export async function readMuzzBalance(address, fetchImpl = globalThis.fetch) {
  const wallet = String(address || '').toLowerCase();
  if (wallet === EXEMPT_WALLET) return { ok: true, formatted: 'exempt', minimum: '10,000,000', exempt: true };
  const decimals = BigInt(await ethCall(fetchImpl, MUZZ_TOKEN, '0x313ce567'));
  const data = '0x70a08231' + wallet.replace(/^0x/, '').padStart(64, '0');
  const raw = BigInt(await ethCall(fetchImpl, MUZZ_TOKEN, data));
  const min = MIN_WHOLE * (10n ** decimals);
  return {
    ok: raw >= min,
    formatted: formatWhole(raw, decimals),
    raw: raw.toString(),
    minimum: '10,000,000',
    exempt: false
  };
}

export async function fetchNonce(fetchImpl = globalThis.fetch) {
  const res = await fetchImpl('/api/session?op=nonce');
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !/^[a-f0-9]{32}$/.test(String(data.nonce || ''))) {
    const err = new Error((data && data.error) || 'Could not get a sign-in nonce.');
    err.code = 'server';
    throw err;
  }
  return data;
}

export async function exchangeSession(message, signature, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.customToken) {
    const err = new Error((data && data.error) || 'The server refused the sign-in.');
    err.code = (data && data.error) || 'server';
    throw err;
  }
  return data;
}

function projectId() {
  const runtime = globalThis.MUZZ_RUNTIME && globalThis.MUZZ_RUNTIME.walletConnectProjectId;
  const pub = globalThis.MUZZ_PUBLIC && globalThis.MUZZ_PUBLIC.walletConnectProjectId;
  return String(runtime || pub || PROJECT_ID).trim();
}

export const WC_DATABASE = 'WALLET_CONNECT_V2_INDEXED_DB';
let wcProvider = null;

function providerOptions(deps) {
  const id = String(deps.projectId || projectId()).trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) {
    const err = new Error('WalletConnect project id is missing.');
    err.code = 'NO_PROJECT_ID';
    throw err;
  }
  const url = dappUrl(deps.location || globalThis.location || { hostname: 'localhost', origin: '' });
  return {
    projectId: id,
    chains: [1],
    optionalChains: [56],
    showQrModal: true,
    methods: ['personal_sign', 'eth_requestAccounts', 'eth_accounts'],
    events: ['chainChanged', 'accountsChanged'],
    metadata: {
      name: 'MuzzSnap',
      description: 'Group chat and private messages for MUZZ holders',
      url,
      icons: [url + '/icons/icon-512.png'],
      redirect: walletRedirect(url, deps.nativeApp === undefined ? isNativeApp(deps) : Boolean(deps.nativeApp))
    },
    qrModalOptions: {
      themeMode: 'dark',
      explorerRecommendedWalletIds: SUPPORTED_WALLETS.map((wallet) => wallet.wcId)
    }
  };
}

async function loadWalletConnect(deps) {
  if (wcProvider) return wcProvider;
  wcProvider = await EthereumProvider.init(providerOptions(deps));
  return wcProvider;
}

function accountsOf(provider) {
  if (provider && Array.isArray(provider.accounts) && provider.accounts.length) {
    return provider.accounts.map((item) => String(item));
  }
  const namespaces = provider && provider.session && provider.session.namespaces;
  const listed = namespaces && namespaces.eip155 && namespaces.eip155.accounts;
  if (!Array.isArray(listed)) return [];
  return listed.map((item) => {
    const parts = String(item).split(':');
    return parts.length >= 3 ? parts[2] : '';
  }).filter((item) => /^0x[a-fA-F0-9]{40}$/.test(item));
}

function accountFromProvider(provider) {
  const accounts = accountsOf(provider);
  const chainId = provider && provider.chainId != null && provider.chainId !== ''
    ? String(provider.chainId)
    : '';
  return { address: accounts[0] ? String(accounts[0]).toLowerCase() : '', chainId, count: accounts.length };
}

function ignorePrematureModalClose(provider) {
  const modal = provider && provider.modal;
  if (!modal || typeof modal.subscribeState !== 'function' || modal.__muzzCloseGuard) return;
  const original = modal.subscribeState.bind(modal);
  modal.subscribeState = (callback) => {
    let opened = false;
    return original((state) => {
      const open = Boolean(state && state.open);
      if (open) opened = true;
      if (!open && !opened) return undefined;
      return callback(state);
    });
  };
  modal.__muzzCloseGuard = true;
}

async function dropPairings(provider) {
  const client = provider && provider.signer && provider.signer.client;
  const pairing = (client && client.pairing) || (client && client.core && client.core.pairing);
  if (!pairing || typeof pairing.getAll !== 'function') return 0;
  let rows = [];
  try { rows = pairing.getAll() || []; } catch { rows = []; }
  let count = 0;
  for (const row of rows) {
    const topic = row && row.topic;
    if (!topic) continue;
    count += 1;
    try {
      if (typeof pairing.disconnect === 'function') await pairing.disconnect({ topic });
      else if (typeof pairing.delete === 'function') await pairing.delete(topic, { code: 6000, message: 'User disconnected' });
    } catch {
      /* the pairing was already dead */
    }
  }
  return count;
}

async function databaseNames() {
  const idb = globalThis.indexedDB;
  if (!idb || typeof idb.databases !== 'function') return [];
  try {
    const rows = await idb.databases();
    return rows.map((row) => row && row.name).filter(Boolean);
  } catch {
    return [];
  }
}

function walletDatabase(name) {
  return name === WC_DATABASE || /walletconnect|wallet_connect|appkit|^w3m|reown/i.test(String(name || ''));
}

function emptyDatabase(name) {
  const idb = globalThis.indexedDB;
  if (!idb || !name) return Promise.resolve();
  return new Promise((resolve) => {
    let request;
    try { request = idb.open(name); } catch { resolve(); return; }
    request.onerror = () => resolve();
    request.onupgradeneeded = () => {
      try { request.transaction.abort(); } catch { /* no database yet */ }
      resolve();
    };
    request.onsuccess = () => {
      const db = request.result;
      const stores = Array.from(db.objectStoreNames || []);
      if (!stores.length) { db.close(); resolve(); return; }
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach((store) => tx.objectStore(store).clear());
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    };
  });
}

async function deleteDatabase(name) {
  const idb = globalThis.indexedDB;
  if (!idb || !name) return;
  await new Promise((resolve) => {
    try {
      const request = idb.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function addressFromWalletConnectDb() {
  const names = await databaseNames();
  for (const name of names) {
    if (!walletDatabase(name)) continue;
    const found = await readDatabaseAddress(name);
    if (found) return found;
  }
  return '';
}

function readDatabaseAddress(name) {
  const idb = globalThis.indexedDB;
  return new Promise((resolve) => {
    let request;
    try { request = idb.open(name); } catch { resolve(''); return; }
    request.onerror = () => resolve('');
    request.onupgradeneeded = () => {
      try { request.transaction.abort(); } catch { /* missing database */ }
      resolve('');
    };
    request.onsuccess = () => {
      const db = request.result;
      const stores = Array.from(db.objectStoreNames || []);
      if (!stores.length) {
        db.close();
        resolve('');
        return;
      }
      const found = [];
      const tx = db.transaction(stores, 'readonly');
      stores.forEach((store) => {
        const cursor = tx.objectStore(store).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const address = eip155Address(typeof row.value === 'string' ? row.value : JSON.stringify(row.value));
          if (address) found.push(address);
          row.continue();
        };
      });
      tx.oncomplete = () => { db.close(); resolve(found[0] || ''); };
      tx.onerror = () => { db.close(); resolve(found[0] || ''); };
    };
  });
}

export async function readRestoredAddress() {
  let local = '';
  let session = '';
  try { local = restoredAddressFromStorage(globalThis.localStorage); } catch { local = ''; }
  try { session = restoredAddressFromStorage(globalThis.sessionStorage); } catch { session = ''; }
  const stored = await Promise.race([
    addressFromWalletConnectDb(),
    new Promise((resolve) => setTimeout(() => resolve(''), 2000))
  ]);
  return stored || local || session || '';
}

export async function disconnectWallet() {
  if (wcProvider) {
    try { await wcProvider.disconnect(); } catch { /* already disconnected */ }
    try { await dropPairings(wcProvider); } catch { /* already disconnected */ }
  }
  wcProvider = null;
  const removed = [
    ...clearStorageKeys(globalThis.localStorage),
    ...clearStorageKeys(globalThis.sessionStorage)
  ];
  clearSignLock();
  const names = await databaseNames();
  const dbs = [];
  for (const name of names) {
    if (!walletDatabase(name)) continue;
    await emptyDatabase(name);
    await deleteDatabase(name);
    dbs.push(name);
  }
  if (!dbs.includes(WC_DATABASE)) {
    await deleteDatabase(WC_DATABASE);
    dbs.push(WC_DATABASE);
  }
  return { removed, dbs };
}

async function connectFreshWallet(deps) {
  if (wcProvider) {
    try { await wcProvider.disconnect(); } catch { /* start clean */ }
    try { await dropPairings(wcProvider); } catch { /* start clean */ }
  }
  wcProvider = null;
  await disconnectWallet();
  const provider = await loadWalletConnect(deps);
  installWalletReturnGuard(deps);
  if (provider && typeof provider.on === 'function' && !provider.__muzzUriGuard) {
    provider.on('display_uri', (uri) => {
      rememberWalletUri(uri);
      if (typeof deps.log === 'function') deps.log('wallet:uri');
    });
    provider.__muzzUriGuard = true;
  }
  ignorePrematureModalClose(provider);
  try { await dropPairings(provider); } catch { /* no leftover pairing */ }
  if (provider.session) {
    try { await provider.disconnect(); } catch { /* no leftover session */ }
  }
  try {
    await provider.connect();
  } catch (err) {
    const wrapped = new Error(err && err.message ? String(err.message) : 'The wallet did not connect.');
    wrapped.code = /user rejected|user denied/i.test(wrapped.message) ? 'sign' : 'connect';
    throw wrapped;
  }
  return provider;
}

export async function openWalletConnect(deps = {}) {
  return connectFreshWallet(deps);
}

function storageOf(deps) {
  if (deps.storage) return deps.storage;
  try { return globalThis.sessionStorage; } catch { return null; }
}

/**
 * Connect, read the MUZZ balance from a public RPC, then one personal_sign.
 * Injected window.ethereum wins when it exists. Otherwise WalletConnect opens.
 */
export async function loginWithWallet(deps = {}) {
  const log = typeof deps.log === 'function' ? deps.log : () => {};
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const store = storageOf(deps);
  log('connect:start');
  const injected = deps.ethereum !== undefined
    ? deps.ethereum
    : (globalThis.window && globalThis.window.ethereum);
  let provider;
  let address = '';
  let chainId = '';
  let accountCount = 0;
  if (deps.restored) {
    log('session:restored');
    provider = deps.provider || await loadWalletConnect(deps);
    const info = accountFromProvider(provider);
    address = info.address;
    chainId = info.chainId;
    accountCount = info.count;
  } else if (injected && typeof injected.request === 'function') {
    log('connect:injected');
    log('session:new');
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    accountCount = accounts && accounts.length ? accounts.length : 0;
    address = accounts && accounts[0] ? String(accounts[0]).toLowerCase() : '';
    try { chainId = String(await injected.request({ method: 'eth_chainId' })); } catch { chainId = ''; }
    provider = injected;
  } else {
    log('connect:walletconnect');
    log('pairings:clear');
    provider = deps.connectWc ? await deps.connectWc() : await connectFreshWallet(deps);
    const info = accountFromProvider(provider);
    address = info.address;
    chainId = info.chainId;
    accountCount = info.count;
    log('session:new');
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    const err = new Error(deps.restored
      ? 'The saved connection is no longer available. Tap Disconnect / Change wallet, then connect again.'
      : 'The wallet did not return an address.');
    err.code = 'no_account';
    throw err;
  }
  address = address.toLowerCase();
  log('address:' + address);
  log('chainId:' + (chainId || 'unknown'));
  log('accounts:' + accountCount);
  log('balance:start ' + address);
  const holding = deps.readBalance
    ? await deps.readBalance(address)
    : await readMuzzBalance(address, fetchImpl);
  log('balance:result ' + holding.formatted + ' raw=' + (holding.raw || '') + ' ok=' + holding.ok);
  if (!holding.ok) {
    const err = new Error('Wallet ' + shortAddress(address) + ' has ' + holding.formatted + ' MUZZ; minimum is 10,000,000.');
    err.code = 'balance';
    throw err;
  }
  log('nonce:start');
  const issued = deps.nonce ? await deps.nonce() : await fetchNonce(fetchImpl);
  const message = buildLoginMessage(address, issued.nonce);
  const signKey = address.toLowerCase() + ':' + issued.nonce;
  if (store && store.getItem(SIGN_KEY) === signKey) {
    const err = new Error('A signature request is already open in the wallet. Finish it there, or tap Retry.');
    err.code = 'sign_pending';
    throw err;
  }
  log('sign:start');
  if (store) store.setItem(SIGN_KEY, signKey);
  let signature;
  try {
    signature = await provider.request({ method: 'personal_sign', params: [message, address] });
  } catch (err) {
    if (store) store.removeItem(SIGN_KEY);
    const wrapped = new Error(err && err.message ? String(err.message) : 'The wallet did not sign.');
    wrapped.code = (err && (err.code === 4001 || err.code === 'ACTION_REJECTED')) ? 'sign' : 'sign';
    throw wrapped;
  }
  log('server:start');
  const session = deps.exchange
    ? await deps.exchange(message, signature)
    : await exchangeSession(message, signature, fetchImpl);
  if (store) store.removeItem(SIGN_KEY);
  log('server:ok');
  return { address: address.toLowerCase(), customToken: session.customToken, message, signature };
}

export function clearSignLock(store) {
  const target = store || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  if (target) target.removeItem(SIGN_KEY);
}
