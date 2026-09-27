import { ethers } from 'ethers';
import { matchWalletId, walletById } from './walletCatalog.js';
import { mapWalletError, walletError } from './walletErrors.js';
import { muzzMark, openSignDeepLink } from './wc-auth.js';

export function isMobile(userAgent = globalThis.navigator?.userAgent || '') {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function normalizeChainId(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'bigint') return `0x${value.toString(16)}`;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `0x${value.toString(16)}` : '';
  }
  if (typeof value === 'object') {
    if (value.chainId != null) return normalizeChainId(value.chainId);
    if (value.id != null) return normalizeChainId(value.id);
    return '';
  }
  let text = String(value).trim().toLowerCase();
  if (text.startsWith('eip155:')) text = text.slice('eip155:'.length).split(':')[0];
  if (text.startsWith('0x')) {
    const parsed = Number.parseInt(text, 16);
    return Number.isFinite(parsed) ? `0x${parsed.toString(16)}` : '';
  }
  if (/^\d+$/.test(text)) return `0x${Number(text).toString(16)}`;
  return '';
}

export function isMainnet(value) {
  return normalizeChainId(value) === '0x1';
}

export function chainLabel(value) {
  const hex = normalizeChainId(value);
  if (hex) return String(Number.parseInt(hex, 16));
  if (value == null || value === '') return 'unknown';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 48) : 'unknown';
}

function pushNamespaces(values, namespaces) {
  if (!namespaces || typeof namespaces !== 'object') return;
  for (const [key, ns] of Object.entries(namespaces)) {
    values.push(key);
    for (const account of ns?.accounts || []) values.push(account);
    for (const chain of ns?.chains || []) values.push(chain);
  }
}

export function sessionHasMainnet(provider, hint) {
  const values = [];
  pushNamespaces(values, provider?.session?.namespaces);
  pushNamespaces(values, hint?.namespaces);
  if (hint?.caipAddress) values.push(hint.caipAddress);
  if (hint?.caipNetworkId) values.push(hint.caipNetworkId);
  const network = hint?.caipNetwork;
  if (network?.caipNetworkId) values.push(network.caipNetworkId);
  if (network?.id != null) values.push(`eip155:${network.id}`);
  return values.some((item) => {
    const text = String(item || '').trim().toLowerCase();
    return text === 'eip155:1' || text.startsWith('eip155:1:');
  });
}

const SWITCH_METHODS = new Set(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);

function rpcMethod(payload) {
  if (payload && typeof payload === 'object') return String(payload.method || '');
  return '';
}

function sessionChainHex(provider) {
  const namespaces = provider?.session?.namespaces;
  if (!namespaces || typeof namespaces !== 'object') return '';
  for (const [key, ns] of Object.entries(namespaces)) {
    const bag = [key, ...(ns?.chains || []), ...(ns?.accounts || [])];
    for (const item of bag) {
      const match = String(item || '').match(/eip155:(\d+)/);
      if (match) return `0x${Number(match[1]).toString(16)}`;
    }
  }
  return '';
}

function sessionAccounts(provider) {
  const namespaces = provider?.session?.namespaces;
  if (!namespaces || typeof namespaces !== 'object') return null;
  const out = [];
  for (const ns of Object.values(namespaces)) {
    for (const account of ns?.accounts || []) {
      const match = String(account || '').match(/0x[a-fA-F0-9]{40}/);
      if (match && !out.includes(match[0])) out.push(match[0]);
    }
  }
  return out.length ? out : null;
}

/** Login never asks the wallet to change chain, and it does not spend a WalletConnect round-trip on eth_chainId. */
export function ignoreChainSwitch(provider) {
  if (!provider || typeof provider.request !== 'function' || provider.__muzzNoSwitch) return provider;
  const original = provider.request.bind(provider);
  provider.request = async (payload, ...rest) => {
    const method = rpcMethod(payload);
    if (SWITCH_METHODS.has(method)) return null;
    if (method === 'eth_chainId') {
      const local = sessionChainHex(provider);
      if (local && (provider.__muzzRealChain == null || provider.__muzzRealChain === '')) provider.__muzzRealChain = local;
      return 1;
    }
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
      const known = sessionAccounts(provider);
      if (known) return known;
    }
    if (method === 'personal_sign') {
      muzzMark('personal_sign:sent');
      const pending = original(payload, ...rest);
      openSignDeepLink(provider);
      return pending;
    }
    return original(payload, ...rest);
  };
  provider.__muzzNoSwitch = true;
  return provider;
}

function pickAddress(list) {
  for (const item of list || []) {
    const match = String(item || '').match(/0x[a-fA-F0-9]{40}/);
    if (match) return match[0].toLowerCase();
  }
  return '';
}

export function firstEvmAddress(provider, accounts) {
  const direct = pickAddress(accounts);
  if (direct) return direct;
  const namespaces = provider?.session?.namespaces;
  if (!namespaces || typeof namespaces !== 'object') return '';
  const keys = Object.keys(namespaces);
  const ordered = [
    ...keys.filter((key) => key === 'eip155' || key.startsWith('eip155:')),
    ...keys
  ];
  for (const key of ordered) {
    const found = pickAddress(namespaces[key]?.accounts);
    if (found) return found;
  }
  return '';
}

function addWallet(found, item) {
  if (!item?.provider) return;
  for (const current of found.values()) {
    if (current.provider === item.provider) return;
  }
  const key = `${item.id}:${item.rdns || item.name}`;
  if (!found.has(key)) found.set(key, item);
}

function probeGlobals(root) {
  const out = [];
  const push = (id, provider) => {
    if (!provider || typeof provider.request !== 'function') return;
    const known = walletById(id);
    out.push({
      id,
      name: known ? known.name : 'Wallet del navegador',
      rdns: known ? known.rdns : '',
      provider
    });
  };
  push('phantom', root.phantom?.ethereum);
  push('trust', root.trustwallet || root.trustWallet);
  push('coinbase', root.coinbaseWalletExtension);
  push('okx', root.okxwallet);
  push('rainbow', root.rainbow?.ethereum || root.rainbow);
  const eth = root.ethereum;
  if (eth) {
    if (eth.isPhantom) push('phantom', eth);
    else if (eth.isCoinbaseWallet || eth.isCoinbaseBrowser) push('coinbase', eth);
    else if (eth.isTrust || eth.isTrustWallet) push('trust', eth);
    else if (eth.isRainbow) push('rainbow', eth);
    else if (eth.isOkxWallet || eth.isOKExWallet) push('okx', eth);
    else if (eth.isMetaMask) push('metamask', eth);
    else push('injected', eth);
  }
  return out;
}

export function discoverInjected(root = globalThis, timeoutMs = 300) {
  return new Promise((resolve) => {
    const found = new Map();
    const onAnnounce = (event) => {
      const detail = event && event.detail;
      if (!detail?.provider) return;
      const info = detail.info || {};
      const name = String(info.name || 'Wallet');
      const rdns = String(info.rdns || '');
      addWallet(found, {
        id: matchWalletId(rdns, name),
        name,
        rdns,
        provider: detail.provider
      });
    };
    root.addEventListener?.('eip6963:announceProvider', onAnnounce);
    try {
      root.dispatchEvent?.(new Event('eip6963:requestProvider'));
    } catch {
      root.dispatchEvent?.({ type: 'eip6963:requestProvider' });
    }
    setTimeout(() => {
      root.removeEventListener?.('eip6963:announceProvider', onAnnounce);
      for (const item of probeGlobals(root)) addWallet(found, item);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export async function openSession(provider, options = {}) {
  if (!provider || typeof provider.request !== 'function') throw walletError('NO_WALLET');
  ignoreChainSwitch(provider);
  const known = firstEvmAddress(provider, []);
  if (options.silent && known) {
    return { provider, address: known, chainId: provider.__muzzRealChain };
  }
  let accounts = [];
  try {
    accounts = await provider.request({ method: options.silent ? 'eth_accounts' : 'eth_requestAccounts' });
  } catch (err) {
    const mapped = mapWalletError(err);
    if (mapped.code === 'rejected' || mapped.code === 'pending') throw mapped;
    accounts = [];
  }
  let address = firstEvmAddress(provider, accounts);
  if (!address) {
    try {
      const silent = await provider.request({ method: 'eth_accounts' });
      address = firstEvmAddress(provider, silent);
    } catch {
      address = firstEvmAddress(provider, []);
    }
  }
  if (!address) throw walletError('no_account');
  return {
    provider,
    address,
    chainId: provider.__muzzRealChain
  };
}

export async function signLogin(provider, address, message) {
  try {
    ignoreChainSwitch(provider);
    const signature = await provider.request({
      method: 'personal_sign',
      params: [ethers.hexlify(ethers.toUtf8Bytes(message)), address]
    });
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== String(address).toLowerCase()) {
      throw walletError('rejected');
    }
    return signature;
  } catch (err) {
    throw mapWalletError(err);
  }
}

export function watchProvider(provider, handlers) {
  if (!provider) return () => {};
  const onAccounts = (accounts) => handlers.onAccounts?.(accounts);
  const onChain = (chainId) => handlers.onChain?.(chainId);
  const onDisconnect = () => handlers.onDisconnect?.();
  const pairs = [
    ['accountsChanged', onAccounts],
    ['chainChanged', onChain],
    ['disconnect', onDisconnect]
  ];
  for (const [event, fn] of pairs) {
    if (typeof provider.on === 'function') provider.on(event, fn);
    else provider.addEventListener?.(event, fn);
  }
  return () => {
    for (const [event, fn] of pairs) {
      if (typeof provider.removeListener === 'function') provider.removeListener(event, fn);
      else provider.removeEventListener?.(event, fn);
    }
  };
}

export async function inspectInjected(root = globalThis) {
  const wallets = await discoverInjected(root);
  let restored = '';
  for (const item of wallets) {
    try {
      const accounts = await item.provider.request({ method: 'eth_accounts' });
      if (accounts && accounts[0]) {
        restored = String(accounts[0]).toLowerCase();
        break;
      }
    } catch {
      /* una wallet puede no implementar la lectura silenciosa */
    }
  }
  return {
    wallets: wallets.map(({ id, name, rdns }) => ({ id, name, rdns })),
    restored
  };
}
