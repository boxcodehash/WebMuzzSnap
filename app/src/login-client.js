import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { getAddress } from 'ethers';
import { SUPPORTED_WALLETS, NATIVE_RETURN } from './walletCatalog.js';
import { rewriteWalletOpen, walletNativeLinks } from './walletLinks.js';
import { buildSignDeepLink, noteWalletChoice } from './wc-auth.js';

export { walletNativeLinks };

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

export const SIWE_DOMAIN = 'muzzsnap-app.vercel.app';
export const SIWE_URI = 'https://muzzsnap-app.vercel.app/login.html';
export const SIWE_STATEMENT = 'Sign in to MuzzSnap. This request does not spend gas or approve a token.';

/** One EIP-4361 personal_sign. Nonce and Expiration Time come from GET /api/session?op=nonce. */
export function buildLoginMessage(address, nonce, exp, issuedAt) {
  const checksum = getAddress(String(address || '').toLowerCase());
  const id = String(nonce || '').toLowerCase();
  const when = Number(exp);
  const expiration = Number.isFinite(when) ? new Date(when).toISOString() : '';
  const issued = issuedAt || new Date().toISOString();
  return [
    SIWE_DOMAIN + ' wants you to sign in with your Ethereum account:',
    checksum,
    '',
    SIWE_STATEMENT,
    '',
    'URI: ' + SIWE_URI,
    'Version: 1',
    'Chain ID: 1',
    'Nonce: ' + id,
    'Issued At: ' + issued,
    'Expiration Time: ' + expiration
  ].join('\n');
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
  const seen = new Set();
  const scopes = [];
  const add = (scope) => {
    if (!scope || (typeof scope !== 'object' && typeof scope !== 'function') || seen.has(scope)) return;
    seen.add(scope);
    scopes.push(scope);
  };
  add(root);
  if (root && root.window) add(root.window);
  try { add(globalThis); } catch { /* no global */ }
  try {
    for (const scope of scopes) {
      const cap = scope.Capacitor;
      if (!cap) continue;
      if (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true;
      const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
      if (platform === 'android' || platform === 'ios') return true;
    }
  } catch {
    /* a normal browser has no Capacitor bridge */
  }
  return false;
}

function navigatorOf(root) {
  if (root && root.navigator) return root.navigator;
  if (root && root.window && root.window.navigator) return root.window.navigator;
  try { return typeof navigator !== 'undefined' ? navigator : null; } catch { return null; }
}

/** A phone or tablet browser. The APK WebView is not a mobile browser. */
export function isMobileBrowser(root = globalThis) {
  if (isNativeApp(root)) return false;
  const nav = navigatorOf(root);
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1) return true;
  return false;
}

function nativeFlag(deps = {}) {
  if (deps.nativeApp !== undefined) return Boolean(deps.nativeApp);
  return isNativeApp(deps);
}

/** Deep links belong in the APK and in mobile browsers. Desktop stays on the QR. */
export function useDeepLinks(deps = {}) {
  if (deps.useDeepLinks != null) return Boolean(deps.useDeepLinks);
  return nativeFlag(deps) || isMobileBrowser(deps);
}

export function shouldShowQrModal(deps = {}) {
  return deps.showModal === true || !useDeepLinks(deps);
}

/**
 * How this connect should talk to the wallet.
 * Desktop browsers show the QR and never install the native-link guard.
 */
export function walletConnectPlan(deps = {}) {
  const native = nativeFlag(deps);
  const deep = useDeepLinks(deps);
  const origin = dappUrl(deps.location || (typeof location !== 'undefined' ? location : { hostname: 'localhost', origin: '' }));
  const browserReturn = String(origin || PUBLIC_APP).replace(/\/$/, '') + '/login.html';
  return {
    showQrModal: deps.showModal === true || !deep,
    redirect: walletRedirect(origin, native),
    deepLinks: deep,
    guard: native,
    linkReturn: native ? NATIVE_RETURN : browserReturn
  };
}

/** APK returns with muzzsnap://wc. A browser returns to this site's login page. */
export function walletRedirect(origin, nativeApp) {
  const page = String(origin || PUBLIC_APP).replace(/\/$/, '') + '/login.html';
  if (nativeApp) return { native: NATIVE_RETURN };
  return { universal: page };
}

let pendingWcUri = '';

export function rememberWalletUri(uri) {
  const value = String(uri || '');
  if (value.startsWith('wc:')) pendingWcUri = value;
  return pendingWcUri;
}

/** Rewrite window.open only inside the APK. A desktop browser must keep https links. */
export function guardWalletReturn(deps = {}) {
  if (!walletConnectPlan(deps).guard) return false;
  installWalletReturnGuard(deps.window || globalThis);
  return true;
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
    /* a browser preview on localhost must still advertise the public origin */
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
  const plan = walletConnectPlan(deps);
  return {
    projectId: id,
    chains: [1],
    /* Desktop browsers always show the QR. Deep links are for the APK and mobile browsers. */
    showQrModal: plan.showQrModal,
    methods: ['personal_sign', 'eth_requestAccounts', 'eth_accounts'],
    events: ['chainChanged', 'accountsChanged'],
    metadata: {
      name: 'MuzzSnap',
      description: 'Group chat and private messages for MUZZ holders',
      url,
      icons: [url + '/icons/icon-512.png'],
      redirect: plan.redirect
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

function openWalletHref(href) {
  if (!href || typeof document === 'undefined' || !document.body) return;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function connectFreshWallet(deps) {
  if (wcProvider) {
    try { await wcProvider.disconnect(); } catch { /* start clean */ }
    try { await dropPairings(wcProvider); } catch { /* start clean */ }
  }
  wcProvider = null;
  await disconnectWallet();
  const plan = walletConnectPlan(deps);
  if (typeof deps.log === 'function') deps.log('redirect:' + JSON.stringify(plan.redirect));
  const provider = await loadWalletConnect(deps);
  guardWalletReturn(deps);
  if (provider && typeof provider.on === 'function' && !provider.__muzzUriGuard) {
    provider.on('display_uri', (uri) => {
      rememberWalletUri(uri);
      if (typeof deps.log === 'function') deps.log('wallet:uri');
      if (!plan.deepLinks || !deps.walletId) return;
      const link = walletNativeLinks(uri, plan.linkReturn).find((item) => item.id === deps.walletId);
      if (!link || !link.href) return;
      if (typeof deps.log === 'function') deps.log('wallet:open ' + deps.walletId);
      openWalletHref(link.href);
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
  wcProvider = provider;
  noteWalletChoice(walletChoiceFor(deps.walletId));
  attachRelayLogs(provider, deps.log);
  return provider;
}

export async function openWalletConnect(deps = {}) {
  return connectFreshWallet(deps);
}

function storageOf(deps) {
  if (deps.storage) return deps.storage;
  try { return globalThis.sessionStorage; } catch { return null; }
}

/** EIP-6963. MetaMask (io.metamask) wins, then the first announcement, then window.ethereum. */
export function discoverInjected(root = globalThis, timeoutMs = 200) {
  const wait = Number.isFinite(timeoutMs) ? timeoutMs : 200;
  return new Promise((resolve) => {
    const found = [];
    const target = root && typeof root.addEventListener === 'function' ? root : globalThis;
    const onAnnounce = (event) => {
      const detail = event && event.detail;
      const provider = detail && detail.provider;
      if (!provider || typeof provider.request !== 'function') return;
      const info = (detail && detail.info) || {};
      found.push({
        rdns: String(info.rdns || ''),
        name: String(info.name || ''),
        provider
      });
    };
    if (typeof target.addEventListener === 'function') target.addEventListener('eip6963:announceProvider', onAnnounce);
    try {
      if (typeof Event === 'function') target.dispatchEvent(new Event('eip6963:requestProvider'));
      else target.dispatchEvent({ type: 'eip6963:requestProvider' });
    } catch {
      try { target.dispatchEvent({ type: 'eip6963:requestProvider' }); } catch { /* no events */ }
    }
    setTimeout(() => {
      if (typeof target.removeEventListener === 'function') target.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve(found);
    }, wait);
  });
}

export function pickInjected(announced, ethereum) {
  const list = Array.isArray(announced) ? announced.filter((item) => item && item.provider && typeof item.provider.request === 'function') : [];
  const metamask = list.find((item) => item.rdns === 'io.metamask' || /metamask/i.test(item.rdns) || /metamask/i.test(item.name || ''));
  if (metamask) return metamask.provider;
  if (list[0]) return list[0].provider;
  if (ethereum && typeof ethereum.request === 'function') return ethereum;
  return null;
}

async function resolveInjected(deps) {
  if (deps.ethereum !== undefined) return deps.ethereum;
  if (deps.showModal) return null;
  if (deps.walletId && deps.walletId !== 'metamask') return null;
  const root = deps.root || globalThis;
  const announced = await discoverInjected(root, deps.discoverMs == null ? 200 : deps.discoverMs);
  const eth = (root.ethereum)
    || (root.window && root.window.ethereum)
    || (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.ethereum)
    || null;
  return pickInjected(announced, eth);
}

export function hasPendingWalletLink() {
  return pendingWcUri.startsWith('wc:');
}

const WALLET_CHOICE = {
  metamask: { id: 'metamask', href: 'metamask://', name: 'MetaMask' },
  trust: { id: 'trust', href: 'trust://', name: 'Trust Wallet' },
  coinbase: { id: 'coinbase', href: 'cbwallet://', name: 'Coinbase Wallet' },
  rainbow: { id: 'rainbow', href: 'rainbow://', name: 'Rainbow' },
  okx: { id: 'okx', href: 'okx://', name: 'OKX Wallet' },
  phantom: { id: 'phantom', href: 'phantom://', name: 'Phantom' }
};

function walletChoiceFor(walletId) {
  return WALLET_CHOICE[walletId] || WALLET_CHOICE.metamask;
}

/** Restart the relay this long after the app returns, then again if the signature is still open. */
export const SIGN_NUDGE_MS = 8000;
/** Replace the spinner when a signature has been waiting this long after sign:start. */
export const SIGN_STUCK_MS = 45000;

export function shouldShowSignRecovery(elapsedMs, deep) {
  return Boolean(deep) && Number(elapsedMs) >= SIGN_STUCK_MS;
}

export function applySignRecovery(els, elapsedMs, deep) {
  const show = shouldShowSignRecovery(elapsedMs, deep);
  const nodes = els || {};
  if (nodes.stuck) nodes.stuck.hidden = !show;
  if (nodes.spinner) nodes.spinner.hidden = show;
  return show;
}

/**
 * Sign prompt for the wallet that was chosen. A live request uses requestId and
 * sessionTopic. Without those, open the wallet itself — never the pairing URI.
 */
export function signPromptHref({ walletId, requestId, topic, userAgent } = {}) {
  const choice = walletChoiceFor(walletId);
  if (requestId && topic) {
    return buildSignDeepLink({
      href: choice.href,
      name: choice.name,
      id: choice.id,
      topic: String(topic),
      requestId: String(requestId),
      userAgent: userAgent || ''
    });
  }
  return choice.href;
}

let pendingSign = null;
let pendingSignWait = null;

function relayerOf(provider) {
  const target = provider || wcProvider;
  if (!target) return null;
  return (target.signer && target.signer.client && target.signer.client.core && target.signer.client.core.relayer)
    || (target.signer && target.signer.client && target.signer.client.relayer)
    || (target.client && target.client.core && target.client.core.relayer)
    || null;
}

function historyOf(provider) {
  const target = provider || wcProvider;
  if (!target) return null;
  return (target.signer && target.signer.client && target.signer.client.core && target.signer.client.core.history)
    || (target.client && target.client.core && target.client.core.history)
    || null;
}

function attachRelayLogs(provider, log) {
  const relayer = relayerOf(provider);
  const write = typeof log === 'function' ? log : () => {};
  if (!relayer || typeof relayer.on !== 'function' || relayer.__muzzRelayWatch) return;
  relayer.__muzzRelayWatch = true;
  relayer.on('relayer_connect', () => write('relayer_connect'));
  relayer.on('relayer_disconnect', () => write('relayer_disconnect'));
}

function listHistory(history) {
  const rows = [];
  if (!history) return rows;
  if (history.records && typeof history.records.values === 'function') {
    for (const item of history.records.values()) rows.push(item);
  }
  if (typeof history.values === 'function') {
    try {
      const values = history.values();
      const list = Array.isArray(values) ? values : Array.from(values || []);
      rows.push(...list);
    } catch {
      /* history store is not iterable */
    }
  }
  return rows;
}

function armSignature(provider, walletId) {
  const session = provider && provider.session;
  pendingSign = {
    id: '',
    topic: session && session.topic ? String(session.topic) : '',
    walletId: walletId || 'metamask'
  };
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pendingSignWait = { promise, resolve, reject, settled: false };
  const history = historyOf(provider);
  if (history && typeof history.on === 'function' && !history.__muzzSignWatch) {
    history.__muzzSignWatch = true;
    history.on('history_created', (record) => {
      if (!record || !pendingSign) return;
      const method = record.request && record.request.method;
      if (method && method !== 'personal_sign') return;
      if (record.id != null) pendingSign.id = record.id;
      if (record.topic) pendingSign.topic = String(record.topic);
    });
  }
}

function captureSignRecord(provider) {
  if (!pendingSign) return;
  const rows = listHistory(historyOf(provider));
  const match = rows.find((item) => item && item.request && item.request.method === 'personal_sign');
  if (!match) return;
  if (match.id != null) pendingSign.id = match.id;
  if (match.topic) pendingSign.topic = String(match.topic);
}

function settleSign(ok, value) {
  const wait = pendingSignWait;
  if (!wait || wait.settled) return;
  wait.settled = true;
  if (ok) {
    wait.resolve(value);
    pendingSign = null;
  } else {
    wait.reject(value);
  }
}

function historyRecord() {
  const history = historyOf(wcProvider);
  if (!history || !pendingSign) return null;
  const id = pendingSign.id;
  const topic = pendingSign.topic;
  if (id !== '' && id != null && typeof history.get === 'function') {
    try {
      const found = history.get(topic, id);
      if (found) return found;
    } catch {
      /* store miss */
    }
  }
  const rows = listHistory(history);
  if (id !== '' && id != null) {
    const match = rows.find((item) => item && String(item.id) === String(id));
    if (match) return match;
  }
  return rows.find((item) => item && item.request && item.request.method === 'personal_sign' && item.response) || null;
}

function settleFromHistory() {
  const record = historyRecord();
  const response = record && record.response;
  if (!response || !pendingSignWait || pendingSignWait.settled) return '';
  if (response.error) {
    const err = new Error((response.error && response.error.message) || 'The wallet did not sign.');
    err.code = 'sign';
    settleSign(false, err);
    return '';
  }
  if (typeof response.result === 'string' && response.result) {
    const signature = response.result;
    settleSign(true, signature);
    return signature;
  }
  return '';
}

/**
 * The relay WebSocket dies while the APK is frozen, and the browser ping watchdog
 * never runs. restartTransport resubscribes so a signature parked on the relay arrives.
 */
export async function resumeRelay(log) {
  const write = typeof log === 'function' ? log : () => {};
  const relayer = wcProvider?.signer?.client?.core?.relayer
    || wcProvider?.signer?.client?.relayer
    || wcProvider?.client?.core?.relayer;
  try {
    if (!relayer || typeof relayer.restartTransport !== 'function') throw new Error('no relayer');
    await relayer.restartTransport();
    write('relay:restart ok');
  } catch {
    write('relay:restart fail');
  }
  return settleFromHistory();
}

export function createResumeBinder({ resume, debounceMs = 1000, schedule, clear, phase } = {}) {
  const set = schedule || ((fn, ms) => setTimeout(fn, ms));
  const unset = clear || ((id) => clearTimeout(id));
  let timer = 0;
  let nudge = 0;

  function kick(reason) {
    Promise.resolve(typeof resume === 'function' ? resume(reason) : undefined).catch(() => {});
  }

  function scheduleRelay(reason) {
    if (timer) unset(timer);
    timer = set(() => {
      timer = 0;
      kick(reason);
    }, debounceMs);
    if (typeof phase === 'function' && phase() === 'sign') {
      if (nudge) unset(nudge);
      nudge = set(() => {
        nudge = 0;
        if (phase() === 'sign') kick('sign-nudge');
      }, SIGN_NUDGE_MS);
    }
  }

  return {
    onReturn() { scheduleRelay('return'); },
    onVisible(state) {
      if (state !== 'visible') return;
      scheduleRelay('visible');
    },
    onAppState(state) {
      const active = state === true || Boolean(state && state.isActive);
      if (!active) return;
      scheduleRelay('app');
    },
    onResume() { scheduleRelay('resume'); },
    scheduleRelay,
    cancel() {
      if (timer) unset(timer);
      if (nudge) unset(nudge);
      timer = 0;
      nudge = 0;
    }
  };
}

/** Foreground the wallet for the pending personal_sign, not for a new pairing. */
export function openWalletForSignature(deps = {}) {
  const walletId = deps.walletId || (pendingSign && pendingSign.walletId) || 'metamask';
  const requestId = pendingSign && pendingSign.id != null && pendingSign.id !== '' ? pendingSign.id : '';
  const topic = pendingSign && pendingSign.topic ? pendingSign.topic : '';
  const nav = navigatorOf(deps);
  const href = signPromptHref({
    walletId,
    requestId,
    topic,
    userAgent: (nav && nav.userAgent) || ''
  });
  if (href) openWalletHref(href);
  return href;
}

function cancelled(deps) {
  return typeof deps.alive === 'function' && deps.alive() === false;
}

function cancelledError() {
  const err = new Error('cancelled');
  err.code = 'cancelled';
  return err;
}

/**
 * Connect, then one personal_sign. The nonce overlaps the connect. The client
 * balance read must not delay the signature; the server still requires 10M MUZZ.
 * EIP-6963 prefers MetaMask over a hijacked window.ethereum. Otherwise WalletConnect opens.
 */
export async function loginWithWallet(deps = {}) {
  const log = typeof deps.log === 'function' ? deps.log : () => {};
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const store = storageOf(deps);
  log('connect:start');
  log('nonce:start');
  const noncePromise = deps.nonce ? deps.nonce() : fetchNonce(fetchImpl);
  const injected = await resolveInjected(deps);
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
  } else if (injected && typeof injected.request === 'function' && !deps.showModal && deps.walletId !== 'trust' && deps.walletId !== 'coinbase' && deps.walletId !== 'rainbow' && deps.walletId !== 'okx' && deps.walletId !== 'phantom') {
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
    wcProvider = provider;
    noteWalletChoice(walletChoiceFor(deps.walletId));
    attachRelayLogs(provider, log);
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
  let balanceState = { settled: false, holding: null };
  const balancePromise = Promise.resolve().then(() => (
    deps.readBalance ? deps.readBalance(address) : readMuzzBalance(address, fetchImpl)
  )).then((holding) => {
    balanceState = { settled: true, holding };
    return holding;
  }, () => {
    balanceState = { settled: true, holding: null };
    return null;
  });
  void balancePromise;
  const issued = await noncePromise;
  if (!issued || !issued.nonce) {
    const err = new Error('The server did not issue a nonce.');
    err.code = 'server';
    throw err;
  }
  const message = buildLoginMessage(address, issued.nonce, issued.exp);
  const signKey = address.toLowerCase() + ':' + issued.nonce;
  if (store && store.getItem(SIGN_KEY) === signKey) {
    const err = new Error('A signature request is already open in the wallet. Finish it there, or tap Retry.');
    err.code = 'sign_pending';
    throw err;
  }
  if (cancelled(deps)) throw cancelledError();
  log('sign:start');
  if (store) store.setItem(SIGN_KEY, signKey);
  armSignature(provider, deps.walletId || 'metamask');
  const wait = pendingSignWait;
  let signature;
  try {
    const rpc = provider.request({ method: 'personal_sign', params: [message, address] });
    captureSignRecord(provider);
    Promise.resolve(rpc).then((value) => {
      if (!wait || wait.settled) return;
      wait.settled = true;
      wait.resolve(value);
      if (pendingSignWait === wait) pendingSign = null;
    }, (err) => {
      if (!wait || wait.settled) return;
      wait.settled = true;
      const wrapped = new Error(err && err.message ? String(err.message) : 'The wallet did not sign.');
      wrapped.code = 'sign';
      wait.reject(wrapped);
    });
    signature = await wait.promise;
  } catch (err) {
    if (store && store.getItem(SIGN_KEY) === signKey) store.removeItem(SIGN_KEY);
    if (err && err.code === 'sign') throw err;
    const wrapped = new Error(err && err.message ? String(err.message) : 'The wallet did not sign.');
    wrapped.code = 'sign';
    throw wrapped;
  }
  if (cancelled(deps)) {
    if (store && store.getItem(SIGN_KEY) === signKey) store.removeItem(SIGN_KEY);
    throw cancelledError();
  }
  if (!balanceState.settled) await Promise.race([balancePromise, Promise.resolve()]);
  if (!balanceState.settled) await Promise.race([balancePromise, Promise.resolve()]);
  if (balanceState.settled && balanceState.holding) {
    const holding = balanceState.holding;
    log('balance:result ' + holding.formatted + ' raw=' + (holding.raw || '') + ' ok=' + holding.ok);
    if (holding.ok === false) {
      if (store && store.getItem(SIGN_KEY) === signKey) store.removeItem(SIGN_KEY);
      const err = new Error('Wallet ' + shortAddress(address) + ' has ' + holding.formatted + ' MUZZ; minimum is 10,000,000.');
      err.code = 'balance';
      throw err;
    }
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
