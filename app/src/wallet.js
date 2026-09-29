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
  ONE_CLICK_TIMEOUT_MS,
  authConnectParams,
  buildOneClickAuth,
  connectForLogin,
  createSingleFlight,
  hasLiveSession,
  loginConnectParams,
  muzzMark,
  proofFromSession,
  readWalletChoice,
  releaseStorageWait,
  walletAdvertisesOneClick
} from './wc-auth.js';

export { isMobile, signLogin, watchProvider, discoverInjected, inspectInjected };

let modalPromise = null;
let wcProvider = null;
let latestUri = '';
let connectStarted = false;
let connectPromise = null;
let connectGeneration = 0;
let closingModal = false;
let statusHook = () => {};
let loginAuth = null;
const uriWaiters = [];
const connectFlight = createSingleFlight();
const CONNECT_LOCK_MS = 12000;

function releaseConnectLock() {
  connectGeneration += 1;
  connectPromise = null;
  connectStarted = false;
  latestUri = '';
  loginAuth = null;
  if (typeof connectFlight.reset === 'function') connectFlight.reset();
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

function currentLoginAuth() {
  if (!loginAuth) loginAuth = buildOneClickAuth(authContext());
  return loginAuth;
}

function noteUri(uri) {
  if (!uri) return;
  latestUri = String(uri);
  muzzMark('uri');
  statusHook('Check your wallet to sign');
  const pending = uriWaiters.splice(0);
  pending.forEach((fn) => fn(latestUri));
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

function proposal(params, oneClick) {
  // A normal session proposal emits display_uri and opens the wallet.
  // SIWE stays out of that proposal unless the wallet advertises one-click auth.
  // MetaMask Mobile never does: a SIWE connect request does not return a session.
  wcProvider.namespaces = {};
  const next = loginConnectParams({
    ...params,
    namespaces: {},
    optionalNamespaces: optionalNamespaces(params)
  }, oneClick, oneClick ? authConnectParams(currentLoginAuth()) : null);
  muzzMark(oneClick ? 'wc:proposal:one-click' : 'wc:proposal:plain');
  return next;
}

function plainConnect(originalConnect, params) {
  return originalConnect(proposal(params, false));
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
  releaseStorageWait(universalProvider);
  if (typeof universalProvider.on === 'function') universalProvider.on('display_uri', noteUri);
  ignoreChainSwitch(universalProvider);
  if (typeof window !== 'undefined') {
    ignoreChainSwitch(window.ethereum);
    window.addEventListener('eip6963:announceProvider', (event) => {
      ignoreChainSwitch(event?.detail?.provider);
    });
  }
  const originalConnect = universalProvider.connect.bind(universalProvider);
  universalProvider.connect = (params = {}) => {
    if (hasLiveSession(universalProvider)) return Promise.resolve(universalProvider.session);
    // Reuse a pairing that already has a URI. A hung attempt with no URI must not be reused:
    // AppKit opens the wallet only after display_uri.
    if (connectPromise && latestUri) return connectPromise;
    connectPromise = null;
    const choice = readWalletChoice();
    let run;
    run = connectForLogin({
      choice,
      timeoutMs: ONE_CLICK_TIMEOUT_MS,
      hasCacao: () => Boolean(proofFromSession(universalProvider.session)),
      connect: async (plan) => {
        if (plan.fallback) muzzMark('wc:one-click:fallback');
        if (plan.fallback && hasLiveSession(universalProvider)) return universalProvider.session;
        if (plan.fallback && !hasLiveSession(universalProvider) && typeof universalProvider.disconnect === 'function') {
          try {
            await Promise.race([
              universalProvider.disconnect(),
              new Promise((resolve) => setTimeout(resolve, 1500))
            ]);
          } catch {
            /* the plain proposal still has to go out */
          }
        }
        const oneClick = walletAdvertisesOneClick(choice) && !plan.plain;
        return oneClick ? originalConnect(proposal(params, true)) : plainConnect(originalConnect, params);
      }
    }).then((result) => result.session).finally(() => {
      if (connectPromise === run) connectPromise = null;
    });
    connectPromise = run;
    const stuck = setTimeout(() => {
      if (connectPromise === run && !latestUri && !hasLiveSession(universalProvider)) {
        connectPromise = null;
        connectStarted = false;
      }
    }, CONNECT_LOCK_MS);
    run.finally(() => clearTimeout(stuck));
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
  if (!hasLiveSession(wcProvider) && connectPromise) {
    await Promise.race([
      connectPromise.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 800))
    ]);
  }
  muzzMark('session');
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
  const restored = sessionAddress();
  if (restored || hasLiveSession(wcProvider)) {
    await closeModal(modal);
    return finishConnect(modal, hooks);
  }
  const generation = connectGeneration;
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
      clearTimeout(lockTimer);
      unsubAccount();
      unsubState();
      if (wcProvider && typeof wcProvider.removeListener === 'function') {
        wcProvider.removeListener('connect', onProviderConnect);
      }
      fn();
    };
    let sessionSent = false;
    const notifySession = () => {
      if (sessionSent || !hooks || typeof hooks.onSession !== 'function') return;
      const address = sessionAddress();
      if (!address) return;
      sessionSent = true;
      const proof = proofFromSession(wcProvider && wcProvider.session) || null;
      if (proof) muzzMark('siwe:on-session');
      try {
        hooks.onSession({ provider: wcProvider, address, ...(proof || {}) });
      } catch {
        /* the page starts the one personal_sign only when no session proof exists */
      }
    };
    const connected = () => {
      // The signature has to be requested in this turn. Waiting for the modal
      // animation is what leaves MetaMask on the connect screen.
      notifySession();
      finish(() => resolve(sessionAddress() || modal.getAddress?.() || ''));
      closeModal(modal);
    };
    const lockTimer = setTimeout(() => {
      if (settled || opened || hasLiveSession(wcProvider)) return;
      releaseConnectLock();
      finish(() => reject(walletError('wc_load')));
    }, CONNECT_LOCK_MS);
    unsubAccount = modal.subscribeAccount((account) => {
      if (!account?.isConnected || !account.address) return;
      connected();
    });
    unsubState = modal.subscribeState((state) => {
      if (state?.open) opened = true;
      else if (opened && !closingModal) {
        setTimeout(() => {
          if (settled || closingModal || hasLiveSession(wcProvider) || modal.getIsConnectedState?.()) return;
          // iOS suspends the page while MetaMask is in front. That must not
          // count as the user closing the list.
          try {
            if (globalThis.__muzzClosingModal) return;
            if (globalThis.document && document.visibilityState === 'hidden') return;
          } catch {
            /* no document */
          }
          releaseConnectLock();
          finish(() => reject(walletError('rejected')));
        }, 400);
      }
    });
    if (connectPromise) connectPromise.then(onProviderConnect, () => {});
    modal.open().catch((err) => {
      releaseConnectLock();
      finish(() => reject(err));
    });
  });
  if (generation !== connectGeneration && !hasLiveSession(wcProvider)) throw walletError('rejected');
  closeModal(modal);
  return finishConnect(modal, hooks);
}

export function closeWalletModal() {
  if (!modalPromise) return Promise.resolve();
  return modalPromise.then((modal) => closeModal(modal)).catch(() => {});
}

export function connectModal(hooks = {}) {
  return connectFlight(() => connectModalInner(hooks));
}

let relayReconnect = null;
let relayReconnectAt = 0;

async function reviveRelay() {
  const relayer = wcProvider && wcProvider.client && wcProvider.client.core && wcProvider.client.core.relayer;
  if (!relayer) return false;
  const once = async () => {
    if (typeof relayer.restartTransport === 'function') {
      await relayer.restartTransport();
      return true;
    }
    if (typeof relayer.transportOpen === 'function') {
      await relayer.transportOpen();
      return true;
    }
    return false;
  };
  try {
    return await once();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try { return await once(); } catch { return false; }
  }
}

/** Bring the relay socket back so a personal_sign answer is not dropped after Android resumes. */
export function reconnectWalletConnect() {
  if (relayReconnect) return relayReconnect;
  const now = Date.now();
  if (now - relayReconnectAt < 1500) return Promise.resolve(false);
  relayReconnectAt = now;
  relayReconnect = reviveRelay().finally(() => {
    relayReconnect = null;
  });
  return relayReconnect;
}

/** Drop a stuck session so the next Connect tap can open the wallet again. */
export async function resetWalletConnect() {
  releaseConnectLock();
  const jobs = [];
  if (wcProvider && typeof wcProvider.disconnect === 'function') {
    jobs.push(Promise.resolve(wcProvider.disconnect()).catch(() => {}));
  }
  if (modalPromise) {
    jobs.push(modalPromise.then((modal) => (modal && modal.disconnect ? modal.disconnect() : null)).catch(() => {}));
  }
  await Promise.race([
    Promise.all(jobs),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
}

export async function restoreWalletConnect(hooks = {}) {
  if (!validProjectId(getConfig().walletConnectProjectId)) return null;
  try {
    const modal = await getModal();
    if (connectPromise && !hasLiveSession(wcProvider)) {
      await Promise.race([
        connectPromise.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 800))
      ]);
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
