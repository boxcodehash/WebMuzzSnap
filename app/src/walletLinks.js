import { NATIVE_RETURN, SUPPORTED_WALLETS } from './walletCatalog.js';

const NATIVE_WC = {
  metamask: 'metamask://wc',
  trust: 'trust://wc',
  coinbase: 'cbwallet://wc',
  rainbow: 'rainbow://wc',
  okx: 'okx://wc',
  phantom: 'phantom://wc'
};

/** A link that would load this app inside the wallet's browser instead of a WalletConnect request. */
export function isInAppBrowserLink(href) {
  const value = String(href || '');
  if (/\/dapp(\/|$|\?|#)/i.test(value) || /\/browse(\/|$|\?|#)/i.test(value) || /\/open_url(\/|$|\?|#)/i.test(value)) return true;
  if (/[?&](open_url|cb_url|dappUrl)=/i.test(value)) return true;
  if (/wallet\/dapp/i.test(value)) return true;
  return false;
}

/**
 * Native WalletConnect links. The wallet shows approve and one signature, then
 * returns with muzzsnap://wc. Page URLs are not embedded.
 */
export function walletNativeLinks(wcUri, returnTo = NATIVE_RETURN) {
  const uri = String(wcUri || '');
  const wc = uri.startsWith('wc:') ? uri : '';
  const enc = encodeURIComponent(wc);
  const back = encodeURIComponent(returnTo || NATIVE_RETURN);
  const byId = {
    metamask: wc ? `metamask://wc?uri=${enc}` : NATIVE_WC.metamask,
    trust: wc ? `trust://wc?uri=${enc}` : NATIVE_WC.trust,
    coinbase: wc ? `cbwallet://wc?uri=${enc}` : NATIVE_WC.coinbase,
    rainbow: wc ? `rainbow://wc?uri=${enc}` : NATIVE_WC.rainbow,
    okx: wc ? `okx://wc?uri=${enc}` : NATIVE_WC.okx,
    phantom: wc ? `phantom://wc?uri=${enc}&redirect_link=${back}` : NATIVE_WC.phantom
  };
  return SUPPORTED_WALLETS.map((wallet) => ({
    id: wallet.id,
    name: wallet.name,
    href: byId[wallet.id]
  }));
}

/** Same as walletNativeLinks. A normal https page is never opened in the wallet browser. */
export function walletDeepLinks(wcUriOrPage) {
  const value = String(wcUriOrPage || '');
  return walletNativeLinks(value.startsWith('wc:') ? value : '');
}

/** Rewrite a wallet-browser or universal link into a native wc: link. Empty string means "do not navigate". */
export function rewriteWalletOpen(href, wcUri) {
  const value = String(href || '');
  if (!value) return '';
  if (isInAppBrowserLink(value)) {
    const uri = String(wcUri || '');
    if (!uri.startsWith('wc:')) return '';
    const metamask = walletNativeLinks(uri).find((item) => item.id === 'metamask');
    return metamask ? metamask.href : '';
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const uriParam = url.searchParams.get('uri') || '';
    if (!uriParam.startsWith('wc:')) return value;
    const enc = encodeURIComponent(uriParam);
    if (host === 'metamask.app.link') return `metamask://wc?uri=${enc}`;
    if (host === 'link.trustwallet.com') return `trust://wc?uri=${enc}`;
    if (host === 'go.cb-w.com') return `cbwallet://wc?uri=${enc}`;
    if (host === 'rnbwapp.com') return `rainbow://wc?uri=${enc}`;
    if (host === 'phantom.app') return `phantom://wc?uri=${enc}`;
  } catch {
    /* already a native scheme or a relative path */
  }
  return value;
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
