import { SUPPORTED_WALLETS } from './walletCatalog.js';

/** Enlaces que abren esta página dentro del navegador de la wallet (móvil). */
export function walletDeepLinks(pageUrl) {
  const url = String(pageUrl || '');
  let hostPath = url;
  try {
    const parsed = new URL(url);
    hostPath = `${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    hostPath = url.replace(/^https?:\/\//, '');
  }
  const encoded = encodeURIComponent(url);
  const byId = {
    metamask: `https://metamask.app.link/dapp/${hostPath}`,
    trust: `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}`,
    coinbase: `https://go.cb-w.com/dapp?cb_url=${encoded}`,
    rainbow: `https://rnbwapp.com/dapp?url=${encoded}`,
    okx: `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encoded}`)}`,
    phantom: `https://phantom.app/ul/browse/${encoded}?ref=${encoded}`
  };
  return SUPPORTED_WALLETS.map((wallet) => ({
    id: wallet.id,
    name: wallet.name,
    href: byId[wallet.id]
  }));
}

export function inAppWalletId(userAgent) {
  const ua = String(userAgent || '');
  if (/Phantom/i.test(ua)) return 'phantom';
  if (/CoinbaseWallet|CBWallet/i.test(ua)) return 'coinbase';
  if (/Trust/i.test(ua)) return 'trust';
  if (/Rainbow/i.test(ua)) return 'rainbow';
  if (/OKApp|OKX/i.test(ua)) return 'okx';
  if (/MetaMask/i.test(ua)) return 'metamask';
  return '';
}
