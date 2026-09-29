import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { SUPPORTED_WALLETS, NATIVE_RETURN } from './walletCatalog.js';

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
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] })
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

export async function openWalletConnect(deps = {}) {
  const id = String(deps.projectId || projectId()).trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) {
    const err = new Error('WalletConnect project id is missing.');
    err.code = 'NO_PROJECT_ID';
    throw err;
  }
  const url = dappUrl(deps.location || globalThis.location || { hostname: 'localhost', origin: '' });
  const provider = await EthereumProvider.init({
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
      redirect: {
        native: NATIVE_RETURN,
        universal: url + '/login.html'
      }
    },
    qrModalOptions: {
      themeMode: 'dark',
      explorerRecommendedWalletIds: SUPPORTED_WALLETS.map((wallet) => wallet.wcId)
    }
  });
  if (provider.session && provider.accounts && provider.accounts[0]) return provider;
  try {
    await provider.connect();
  } catch (err) {
    const wrapped = new Error(err && err.message ? String(err.message) : 'The wallet did not connect.');
    wrapped.code = /user rejected|user denied/i.test(wrapped.message) ? 'sign' : 'connect';
    throw wrapped;
  }
  return provider;
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
  if (injected && typeof injected.request === 'function') {
    log('connect:injected');
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    address = accounts && accounts[0] ? String(accounts[0]) : '';
    provider = injected;
  } else {
    log('connect:walletconnect');
    provider = deps.connectWc ? await deps.connectWc() : await openWalletConnect(deps);
    address = (provider.accounts && provider.accounts[0]) || '';
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    const err = new Error('The wallet did not return an address.');
    err.code = 'no_account';
    throw err;
  }
  log('balance:start');
  const holding = deps.readBalance
    ? await deps.readBalance(address)
    : await readMuzzBalance(address, fetchImpl);
  if (!holding.ok) {
    const err = new Error('Insufficient MUZZ balance. You have ' + holding.formatted + ' MUZZ and the minimum is 10,000,000 MUZZ.');
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
