import { ethers } from 'ethers';
import { matchWalletId, walletById } from './walletCatalog.js';
import { mapWalletError, walletError } from './walletErrors.js';

const MAINNET = {
  chainId: '0x1',
  chainName: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum.publicnode.com'],
  blockExplorerUrls: ['https://etherscan.io']
};

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

export function chainMismatchError(detected) {
  const err = new Error(`Accept the switch to Ethereum mainnet and try again. (detected: ${chainLabel(detected)})`);
  err.code = 'chain';
  return err;
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

async function readChain(provider) {
  try {
    return await provider.request({ method: 'eth_chainId' });
  } catch {
    return undefined;
  }
}

async function requestSwitch(provider) {
  let sawUpdate = false;
  const onUpdate = () => {
    sawUpdate = true;
  };
  if (typeof provider.on === 'function') {
    provider.on('chainChanged', onUpdate);
    provider.on('session_update', onUpdate);
  }
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x1' }]
    });
  } catch (err) {
    const unrecognized = err && (err.code === 4902 || /4902|unrecognized chain/i.test(String(err.message || '')));
    if (unrecognized) {
      try {
        await provider.request({ method: 'wallet_addEthereumChain', params: [MAINNET] });
      } catch {
        /* the next read decides */
      }
    }
  } finally {
    if (typeof provider.removeListener === 'function') {
      provider.removeListener('chainChanged', onUpdate);
      provider.removeListener('session_update', onUpdate);
    }
  }
  if (!sawUpdate) await new Promise((resolve) => setTimeout(resolve, 250));
}

async function ensureMainnet(provider, hint) {
  const first = await readChain(provider);
  if (isMainnet(first)) return;
  await requestSwitch(provider);
  const after = await readChain(provider);
  if (isMainnet(after) || sessionHasMainnet(provider, hint)) return;
  throw chainMismatchError(after != null ? after : first);
}

export async function openSession(provider, hooks = {}) {
  if (!provider || typeof provider.request !== 'function') throw walletError('NO_WALLET');
  let accounts;
  try {
    accounts = await provider.request({ method: 'eth_requestAccounts' });
  } catch (err) {
    throw mapWalletError(err);
  }
  if (!accounts || !accounts.length) throw walletError('NO_WALLET');
  const chainId = await readChain(provider);
  if (!isMainnet(chainId)) hooks.onPhase?.('chain');
  try {
    await ensureMainnet(provider, hooks);
  } catch (err) {
    throw mapWalletError(err);
  }
  if (sessionHasMainnet(provider, hooks)) {
    try {
      provider.setDefaultChain?.('eip155:1');
    } catch {
      /* the session account is enough for personal_sign */
    }
  }
  return {
    provider,
    address: String(accounts[0]).toLowerCase(),
    chainId
  };
}

export async function signLogin(provider, address, message) {
  try {
    const web3 = new ethers.BrowserProvider(provider);
    const signer = await web3.getSigner(address);
    return await signer.signMessage(message);
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
