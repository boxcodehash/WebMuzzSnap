import { mainnet } from 'viem/chains';
import { getConfig } from './config.js';
import { NATIVE_RETURN, SUPPORTED_WALLETS } from './walletCatalog.js';
import { walletError } from './walletErrors.js';
import {
  discoverInjected,
  firstEvmAddress,
  ignoreChainSwitch,
  inspectInjected,
  isMobile,
  openSession,
  signLogin,
  watchProvider
} from './walletSession.js';
import {
  AUTH_CHAINS,
  AUTH_METHODS,
  authConnectParams,
  buildOneClickAuth,
  createSingleFlight,
  hasLiveSession,
  muzzMark,
  proofFromSession,
  readWalletChoice,
  settleLoginConnection
} from './wc-auth.js';

export { isMobile, signLogin, watchProvider, discoverInjected, inspectInjected };

let modalPromise = null;
let wcProvider = null;
let latestUri = '';
let connectStarted = false;
let connectPromise = null;
let pendingAuth = null;
let closingModal = false;
let statusHook = () => {};
const uriWaiters = [];
const connectFlight = createSingleFlight();

function noteUri(uri) {
  if (!uri) return;
  latestUri = String(uri);
  muzzMark('uri');
  statusHook('Check your wallet to sign');
  const pending = uriWaiters.splice(0);
  pending.forEach((fn) => fn(latestUri));
}

function authContext() {
  const url = dappUrl();
  let domain = 'muzzsnap-app.vercel.app';
  try {
    domain = new URL(url).host;
  } catch {
    /* the public host is the fallback */
  }
  return { domain, uri: `${url.replace(/\/$/, '')}/login.html` };
}

function nextAuth() {
  if (!pendingAuth) pendingAuth = buildOneClickAuth(authContext());
  return pendingAuth;
}

async function closeModal(modal) {
  if (!modal || typeof modal.close !== 'function') return;
  closingModal = true;
  try {
    await modal.close();
  } catch {
    /* already closed */
  } finally {
    setTimeout(() => {
      closingModal = false;
    }, 0);
  }
}

function optionalNamespaces(params) {
  const incoming = (params && params.optionalNamespaces) || {};
  const eip = incoming.eip155 || {};
  const methods = [...new Set([...(eip.methods || []), ...AUTH_METHODS])]
    .filter((method) => method !== 'wallet_switchEthereumChain' && method !== 'wallet_addEthereumChain');
  return {
    ...incoming,
    eip155: {
      ...eip,
      chains: [...new Set([...(eip.chains || []), ...AUTH_CHAINS])],
      methods,
      events: [...new Set([...(eip.events || []), 'chainChanged', 'accountsChanged'])]
    }
  };
}

async function runWalletConnect(originalAuthenticate, originalConnect, params) {
  // originalAuthenticate waits at least one hour (wc_sessionAuthenticate ttl floor).
  // MetaMask approves the session long before that promise settles, so personal_sign never starts.
  void originalAuthenticate;
  if (hasLiveSession(wcProvider)) return wcProvider.session;
  const settled = await settleLoginConnection({
    choice: readWalletChoice(),
    connect: (plan) => {
      wcProvider.namespaces = {};
      const request = {
        ...params,
        namespaces: {},
        optionalNamespaces: optionalNamespaces(params),
        authentication: plan.plain ? undefined : [authConnectParams(nextAuth())]
      };
      if (plan.plain) delete request.authentication;
      return originalConnect(request);
    }
  });
  const session = settled.session || wcProvider.session;
  if (hasLiveSession(wcProvider) || session) return session || wcProvider.session;
  return session;
}

function nativeReturnUrl(url) {
  try {
    const cap = globalThis.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return NATIVE_RETURN;
  } catch {
    /* browser */
  }
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return `${url.replace(/\/$/, '')}/login.html`;
  return NATIVE_RETURN;
}

const DEFAULT_PUBLIC_URL = 'https://muzzsnap-app.vercel.app';

function configuredPublicUrl() {
  const raw = globalThis.MUZZ_PUBLIC && globalThis.MUZZ_PUBLIC.appPublicUrl;
  const value = String(raw || DEFAULT_PUBLIC_URL).trim().replace(/\/$/, '');
  return /^https:\/\/[^/]+/i.test(value) ? value : DEFAULT_PUBLIC_URL;
}

export function dappUrl() {
  try {
    const origin = location.origin;
    const host = location.hostname;
    const local = !origin || origin === 'null' || host === 'localhost' || host === '127.0.0.1';
    if (!local && origin && /^https?:/i.test(origin)) return origin;
  } catch {
    /* sin location, o el WebView del APK */
  }
  return configuredPublicUrl();
}

function validProjectId(value) {
  return /^[a-f0-9]{32}$/i.test(String(value || '').trim());
}

async function buildModal() {
  muzzMark('appkit-init');
  const projectId = getConfig().walletConnectProjectId.trim();
  if (!validProjectId(projectId)) throw walletError('NO_PROJECT_ID');
  let createAppKit;
  let EthersAdapter;
  let UniversalProvider;
  try {
    const [appkit, adapter, wc] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-ethers'),
      import('@walletconnect/universal-provider')
    ]);
    createAppKit = appkit.createAppKit;
    EthersAdapter = adapter.EthersAdapter;
    UniversalProvider = wc.default || wc.UniversalProvider;
  } catch (err) {
    console.error(err);
    throw walletError('wc_load');
  }
  const url = dappUrl();
  const icon = new URL('icons/icon-512.png', location.href).href;
  const metadata = {
    name: 'MuzzSnap',
    description: 'Group chat and private messages for MUZZ holders',
    url,
    icons: [icon],
    redirect: {
      native: nativeReturnUrl(url),
      universal: `${url.replace(/\/$/, '')}/login.html`
    }
  };
  let universalProvider;
  try {
    universalProvider = await UniversalProvider.init({ projectId, metadata });
  } catch (err) {
    console.error(err);
    throw walletError('wc_load');
  }
  wcProvider = universalProvider;
  muzzMark('relay');
  if (typeof universalProvider.on === 'function') universalProvider.on('display_uri', noteUri);
  ignoreChainSwitch(universalProvider);
  if (typeof window !== 'undefined') {
    ignoreChainSwitch(window.ethereum);
    window.addEventListener('eip6963:announceProvider', (event) => {
      ignoreChainSwitch(event?.detail?.provider);
    });
  }
  const originalConnect = universalProvider.connect.bind(universalProvider);
  const originalAuthenticate = typeof universalProvider.authenticate === 'function'
    ? universalProvider.authenticate.bind(universalProvider)
    : null;
  universalProvider.connect = (params = {}) => {
    if (hasLiveSession(universalProvider)) return Promise.resolve(universalProvider.session);
    if (connectPromise) return connectPromise;
    const run = runWalletConnect(originalAuthenticate, originalConnect, params).finally(() => {
      if (connectPromise === run) connectPromise = null;
      pendingAuth = null;
    });
    connectPromise = run;
    return run;
  };
  return createAppKit({
    adapters: [new EthersAdapter()],
    networks: [mainnet],
    defaultNetwork: mainnet,
    projectId,
    metadata,
    universalProvider,
    featuredWalletIds: SUPPORTED_WALLETS.map((wallet) => wallet.wcId),
    enableEIP6963: true,
    enableInjected: true,
    enableCoinbase: false,
    enableWalletConnect: true,
    enableBaseAccount: false,
    coinbasePreference: 'eoaOnly',
    allWallets: 'SHOW',
    enableReconnect: true,
    enableAuthLogger: false,
    debug: false,
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#ff2d2d',
      '--w3m-z-index': '10000'
    },
    defaultAccountTypes: { eip155: 'eoa' },
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
      history: false,
      send: false,
      receive: false,
      pay: false,
      reownAuthentication: false,
      connectMethodsOrder: ['wallet']
    }
  });
}

function getModal() {
  if (!modalPromise) {
    modalPromise = buildModal().catch((err) => {
      modalPromise = null;
      throw err;
    });
  }
  return modalPromise;
}

export function preloadWalletConnect() {
  muzzMark('preload:start');
  return getModal();
}

async function providerOf(modal) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const provider = modal.getWalletProvider?.();
    if (provider && typeof provider.request === 'function') return provider;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw walletError('NO_WALLET');
}

async function finishConnect(modal) {
  if (hasLiveSession(wcProvider)) {
    muzzMark('session');
  } else if (connectPromise) {
    try {
      await connectPromise;
    } catch {
      /* the session may still be on the provider after a late approval */
    }
    muzzMark('session');
  } else {
    muzzMark('session');
  }
  const provider = wcProvider && typeof wcProvider.request === 'function'
    ? wcProvider
    : await providerOf(modal);
  ignoreChainSwitch(provider);
  const hint = sessionHint(modal);
  const proof = proofFromSession(provider.session) || null;
  let opened = { provider, address: '', chainId: provider.__muzzRealChain };
  try {
    opened = await openSession(provider, { silent: true });
  } catch (err) {
    if (!proof) throw err;
  }
  const address = (proof && proof.address) || opened.address;
  if (!address) throw walletError('no_account');
  return {
    ...opened,
    provider,
    address,
    ...hint,
    namespaces: provider.session?.namespaces || null,
    ...(proof || {})
  };
}

export async function walletConnectUri() {
  if (latestUri) return latestUri;
  await getModal();
  if (!wcProvider) throw walletError('wc_load');
  if (hasLiveSession(wcProvider)) return latestUri;
  if (!connectStarted) {
    connectStarted = true;
    wcProvider.connect({
      namespaces: {},
      optionalNamespaces: {
        eip155: {
          chains: ['eip155:1', 'eip155:56'],
          methods: AUTH_METHODS.slice(),
          events: ['chainChanged', 'accountsChanged']
        }
      }
    }).catch(() => {
      connectStarted = false;
    });
  }
  if (latestUri) return latestUri;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(walletError('NO_WALLET')), 20000);
    uriWaiters.push((uri) => {
      clearTimeout(timer);
      resolve(uri);
    });
  });
}

function sessionAddress() {
  if (!hasLiveSession(wcProvider)) return '';
  return firstEvmAddress(wcProvider, []);
}

function waitForAddress(modal, ms) {
  const immediate = sessionAddress() || (modal.getIsConnectedState?.() && modal.getAddress?.()) || '';
  if (immediate) return Promise.resolve(String(immediate));
  return new Promise((resolve) => {
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      resolve(sessionAddress() || '');
    }, ms);
    unsub = modal.subscribeAccount((account) => {
      if (account?.isConnected && account.address) {
        clearTimeout(timer);
        unsub();
        resolve(String(account.address));
      } else if (account?.status === 'disconnected') {
        clearTimeout(timer);
        unsub();
        resolve(sessionAddress() || '');
      }
    });
  });
}

async function connectModalInner(hooks = {}) {
  const modal = await getModal();
  if (hooks.onStatus) statusHook = hooks.onStatus;
  statusHook('Connecting…');
  if (connectPromise && !hasLiveSession(wcProvider)) {
    statusHook('Check your wallet to sign');
    try {
      await connectPromise;
    } catch {
      /* a rejected in-flight attempt still reports below if no session landed */
    }
  }
  const restored = sessionAddress();
  if (restored || hasLiveSession(wcProvider)) {
    await closeModal(modal);
    return finishConnect(modal, hooks);
  }
  await new Promise((resolve, reject) => {
    let opened = false;
    let settled = false;
    let unsubAccount = () => {};
    let unsubState = () => {};
    const onProviderConnect = () => {
      if (hasLiveSession(wcProvider)) connected();
    };
    if (wcProvider && typeof wcProvider.on === 'function') wcProvider.on('connect', onProviderConnect);
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      unsubAccount();
      unsubState();
      if (wcProvider && typeof wcProvider.removeListener === 'function') {
        wcProvider.removeListener('connect', onProviderConnect);
      }
      fn();
    };
    const connected = () => {
      closeModal(modal).finally(() => finish(() => resolve(sessionAddress() || modal.getAddress?.() || '')));
    };
    unsubAccount = modal.subscribeAccount((account) => {
      if (!account?.isConnected || !account.address) return;
      connected();
    });
    unsubState = modal.subscribeState((state) => {
      if (state?.open) opened = true;
      else if (opened && !closingModal) {
        setTimeout(() => {
          if (settled || closingModal || hasLiveSession(wcProvider) || modal.getIsConnectedState?.()) return;
          connectPromise = null;
          pendingAuth = null;
          finish(() => reject(walletError('rejected')));
        }, 400);
      }
    });
    if (connectPromise) connectPromise.then(onProviderConnect, () => {});
    modal.open().catch((err) => finish(() => reject(err)));
  });
  await closeModal(modal);
  return finishConnect(modal, hooks);
}

export function connectModal(hooks = {}) {
  return connectFlight(() => connectModalInner(hooks));
}

export async function restoreWalletConnect(hooks = {}) {
  if (!validProjectId(getConfig().walletConnectProjectId)) return null;
  try {
    const modal = await getModal();
    if (connectPromise && !hasLiveSession(wcProvider)) {
      try {
        await connectPromise;
      } catch {
        /* resume still inspects whatever session survived */
      }
    }
    const address = sessionAddress() || await waitForAddress(modal, Math.min(hooks.waitMs == null ? 800 : Number(hooks.waitMs) || 800, 800));
    if (!address && !hasLiveSession(wcProvider)) return null;
    await closeModal(modal);
    return finishConnect(modal, hooks);
  } catch {
    return null;
  }
}

function sessionHint(modal) {
  let caipAddress = '';
  let caipNetwork = null;
  let appKitChainId;
  try {
    caipAddress = modal.getCaipAddress?.() || '';
    caipNetwork = modal.getCaipNetwork?.() || null;
    appKitChainId = modal.getChainId?.();
  } catch {
    /* the provider session is the source of truth */
  }
  return { caipAddress, caipNetwork, appKitChainId };
}

export async function connectInjected(id, hooks = {}) {
  const list = await discoverInjected();
  const item = list.find((wallet) => wallet.id === id) || (id ? null : list[0]);
  if (!item) throw walletError('NO_WALLET');
  return openSession(item.provider, hooks);
}

export async function disconnectWallet() {
  if (!modalPromise) return;
  try {
    const modal = await modalPromise;
    await modal.disconnect?.();
    await modal.close?.();
  } catch {
    /* cerrar sesión no debe bloquear el logout */
  }
}

export async function peekWalletConnect() {
  if (!validProjectId(getConfig().walletConnectProjectId)) return '';
  try {
    const modal = await getModal();
    const current = modal.getAddress?.();
    if (current) return String(current).toLowerCase();
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve('');
      }, 2500);
      const unsub = modal.subscribeAccount((account) => {
        if (account?.status === 'connected' && account.address) {
          clearTimeout(timer);
          unsub();
          resolve(String(account.address).toLowerCase());
        } else if (account?.status === 'disconnected') {
          clearTimeout(timer);
          unsub();
          resolve('');
        }
      });
    });
  } catch {
    return '';
  }
}
