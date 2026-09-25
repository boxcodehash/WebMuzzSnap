import { ethers } from 'ethers';
import { getConfig } from './config.js';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

function walletError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

export function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

export function metamaskDeepLink() {
  const hostPath = `${location.host}${location.pathname}${location.search}`;
  return `https://metamask.app.link/dapp/${hostPath}`;
}

function discoverInjected() {
  return new Promise((resolve) => {
    const found = [];
    const onAnnounce = (event) => {
      if (event.detail) found.push(event.detail);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const metamask = found.find((item) => {
        const id = `${item.info?.rdns || ''} ${item.info?.name || ''}`.toLowerCase();
        return id.includes('metamask');
      });
      resolve((metamask || found[0])?.provider || window.ethereum || null);
    }, 200);
  });
}

async function ensureMainnet(provider) {
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (chainId === '0x1') return;
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x1' }]
  });
}

async function sessionFromProvider(raw) {
  await raw.request({ method: 'eth_requestAccounts' });
  await ensureMainnet(raw);
  const web3 = new ethers.BrowserProvider(raw);
  const signer = await web3.getSigner();
  const address = (await signer.getAddress()).toLowerCase();
  return { raw, web3, signer, address };
}

export async function connectMetaMask() {
  const raw = await discoverInjected();
  if (!raw) throw walletError('NO_WALLET');
  try {
    return await sessionFromProvider(raw);
  } catch (err) {
    if (err && (err.code === 4001 || /reject|denied|cancel/i.test(String(err.message || '')))) {
      throw walletError('rejected');
    }
    if (err && /chain|network|4902/i.test(String(err.message || ''))) throw walletError('chain');
    throw err;
  }
}

export async function connectWalletConnect() {
  const cfg = getConfig();
  if (!cfg.walletConnectProjectId) throw walletError('NO_PROJECT_ID');
  let EthereumProvider;
  try {
    const mod = await import('https://esm.sh/@walletconnect/ethereum-provider@2.19.1');
    EthereumProvider = mod.EthereumProvider || mod.default;
  } catch {
    throw walletError('wc_load');
  }
  const provider = await EthereumProvider.init({
    projectId: cfg.walletConnectProjectId,
    chains: [1],
    showQrModal: true,
    methods: ['personal_sign'],
    events: ['chainChanged', 'accountsChanged'],
    metadata: {
      name: 'MuzzSnap',
      description: 'Chat cifrado para holders de MUZZ',
      url: location.origin,
      icons: [new URL('muzzsnap.jpg', location.href).href]
    }
  });
  await provider.connect();
  try {
    return await sessionFromProvider(provider);
  } catch (err) {
    if (err && (err.code === 4001 || /reject|denied|cancel/i.test(String(err.message || '')))) {
      throw walletError('rejected');
    }
    throw err;
  }
}

export async function previewBalance(web3, address) {
  const cfg = getConfig();
  const contract = new ethers.Contract(cfg.tokenAddress, ERC20_ABI, web3);
  const [balance, decimals] = await Promise.all([
    contract.balanceOf(address),
    contract.decimals()
  ]);
  return { balance: balance.toString(), decimals: Number(decimals) };
}

export async function signLogin(signer, message) {
  return signer.signMessage(message);
}
