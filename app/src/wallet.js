import { mainnet } from 'viem/chains';
import { getConfig } from './config.js';
import { NATIVE_RETURN, SUPPORTED_WALLETS } from './walletCatalog.js';
import { walletError } from './walletErrors.js';
import {
  discoverInjected,
  ignoreChainSwitch,
  inspectInjected,
  isMobile,
  openSession,
  signLogin,
  watchProvider
} from './walletSession.js';

export { isMobile, signLogin, watchProvider, discoverInjected, inspectInjected };

let modalPromise = null;
let wcProvider = null;
let latestUri = '';
let connectStarted = false;
const uriWaiters = [];

function noteUri(uri) {
  if (!uri) return;
  latestUri = String(uri);
  const pending = uriWaiters.splice(0);
  pending.forEach((fn) => fn(latestUri));
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
  if (typeof universalProvider.on === 'function') universalProvider.on('display_uri', noteUri);
  ignoreChainSwitch(universalProvider);
  if (typeof window !== 'undefined') {
    ignoreChainSwitch(window.ethereum);
    window.addEventListener('eip6963:announceProvider', (event) => {
      ignoreChainSwitch(event?.detail?.provider);
    });
  }
  const originalConnect = universalProvider.connect.bind(universalProvider);
  universalProvider.connect = async (params = {}) => {
    // Do not send a required chain. Wallets may approve any eip155 account,
    // including a session that only contains eip155:56.
    universalProvider.namespaces = {};
    const incoming = (params && params.optionalNamespaces) || {};
    const eip = incoming.eip155 || {};
    const methods = [...new Set([...(eip.methods || []), 'personal_sign', 'eth_sign', 'eth_requestAccounts', 'eth_accounts'])]
      .filter((method) => method !== 'wallet_switchEthereumChain' && method !== 'wallet_addEthereumChain');
    return originalConnect({
      ...params,
      namespaces: {},
      optionalNamespaces: {
        ...incoming,
        eip155: {
          ...eip,
          chains: [...new Set([...(eip.chains || []), 'eip155:1', 'eip155:56'])],
          methods,
          events: [...new Set([...(eip.events || []), 'chainChanged', 'accountsChanged'])]
        }
      }
    });
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

async function providerOf(modal) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const provider = modal.getWalletProvider?.();
    if (provider && typeof provider.request === 'function') return provider;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw walletError('NO_WALLET');
}

async function finishConnect(modal, hooks) {
  const provider = await providerOf(modal);
  ignoreChainSwitch(provider);
  const hint = sessionHint(modal);
  const session = await openSession(provider, hooks);
  return {
    ...session,
    ...hint,
    namespaces: provider.session?.namespaces || null
  };
}

export async function walletConnectUri() {
  if (latestUri) return latestUri;
  await getModal();
  if (!wcProvider) throw walletError('wc_load');
  if (!connectStarted) {
    connectStarted = true;
    wcProvider.connect({
      namespaces: {},
      optionalNamespaces: {
        eip155: {
          chains: ['eip155:1', 'eip155:56'],
          methods: ['personal_sign', 'eth_sign', 'eth_requestAccounts', 'eth_accounts'],
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

export async function connectModal(hooks = {}) {
  const modal = await getModal();
  if (modal.getIsConnectedState?.() && modal.getAddress?.()) {
    return finishConnect(modal, hooks);
  }
  await new Promise((resolve, reject) => {
    let opened = false;
    let settled = false;
    let unsubAccount = () => {};
    let unsubState = () => {};
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      unsubAccount();
      unsubState();
      fn();
    };
    unsubAccount = modal.subscribeAccount((account) => {
      if (!account?.isConnected || !account.address) return;
      finish(() => resolve(account.address));
    });
    unsubState = modal.subscribeState((state) => {
      if (state?.open) opened = true;
      else if (opened) finish(() => reject(walletError('rejected')));
    });
    modal.open().catch((err) => finish(() => reject(err)));
  });
  return finishConnect(modal, hooks);
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
