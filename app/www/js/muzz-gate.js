/**
 * Client gate for the real pulsari chat.
 * Balance is read from a public Ethereum RPC until Cloud Functions are deployed.
 * Server verification stays in app/functions (verifyAccess). Do not encrypt the
 * live Realtime Database: chat.html and private.html store plaintext, and
 * ciphertext would break the current website.
 */
(function (global) {
  const TOKEN = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';
  const MIN_WHOLE = '10000000';
  const RPCS = ['https://ethereum.publicnode.com', 'https://eth.drpc.org', 'https://rpc.ankr.com/eth'];
  const ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)'
  ];
  const READ_MS = 24 * 60 * 60 * 1000;
  const SEEN_KEY = 'muzz_seen_v1';
  const DEFAULT_PUBLIC = 'https://muzzsnap-app.vercel.app';
  const HANDOFF_MS = 3 * 60 * 1000;
  const NONCE_KEY = 'muzz_used_nonces_v1';

  function formatWhole(raw, decimals) {
    const text = ethers.utils.formatUnits(raw, decimals);
    const whole = text.split('.')[0] || '0';
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  async function readMuzzBalance(address) {
    if (typeof ethers === 'undefined') throw new Error('Wallet library failed to load.');
    const wallet = ethers.utils.getAddress(address);
    let last = null;
    for (const url of RPCS) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(url);
        const token = new ethers.Contract(TOKEN, ABI, provider);
        const [raw, decimals] = await Promise.all([token.balanceOf(wallet), token.decimals()]);
        const min = ethers.utils.parseUnits(MIN_WHOLE, decimals);
        return {
          ok: raw.gte(min),
          formatted: formatWhole(raw, decimals),
          minimum: '10,000,000'
        };
      } catch (err) {
        last = err;
      }
    }
    throw last || new Error('Could not read the MUZZ balance.');
  }

  function readSeen() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function visible(list, now) {
    const clock = Number(now) || Date.now();
    const map = readSeen();
    let changed = false;
    (list || []).forEach((msg) => {
      if (!msg || !msg.id || map[msg.id]) return;
      map[msg.id] = clock;
      changed = true;
    });
    const keys = Object.keys(map);
    if (keys.length > 400) {
      keys.sort((a, b) => map[a] - map[b]).slice(0, keys.length - 300).forEach((key) => {
        delete map[key];
        changed = true;
      });
    }
    if (changed) localStorage.setItem(SEEN_KEY, JSON.stringify(map));
    return (list || []).filter((msg) => msg && msg.id && clock - Number(map[msg.id] || clock) < READ_MS);
  }

  function isMainnet(value) {
    if (value == null || value === '') return false;
    if (typeof value === 'number') return value === 1;
    let text = String(value).trim().toLowerCase();
    if (text.startsWith('eip155:')) text = text.slice('eip155:'.length);
    if (text.startsWith('0x')) return parseInt(text, 16) === 1;
    return text === '1';
  }

  function appPublicUrl() {
    const configured = global.MUZZ_PUBLIC && global.MUZZ_PUBLIC.appPublicUrl;
    const value = String(configured || DEFAULT_PUBLIC).trim().replace(/\/$/, '');
    if (!/^https:\/\/[^/]+/i.test(value)) return DEFAULT_PUBLIC;
    return value;
  }

  function isEmbeddedOrigin() {
    try {
      const origin = String(location.origin || '');
      const host = String(location.hostname || '');
      if (!origin || origin === 'null') return true;
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    } catch (err) {
      return true;
    }
  }

  function publicLoginUrl(returnToApk) {
    return appPublicUrl() + '/login.html' + (returnToApk ? '#from=apk' : '');
  }

  function loginPageForWallets(returnToApk) {
    if (returnToApk || isEmbeddedOrigin()) return publicLoginUrl(true);
    try {
      if (location.protocol === 'https:' && location.host) return location.origin + '/login.html';
    } catch (err) {
      /* configured public URL */
    }
    return publicLoginUrl(false);
  }

  function walletConnectProjectId() {
    const pub = global.MUZZ_PUBLIC && global.MUZZ_PUBLIC.walletConnectProjectId;
    const runtime = global.MUZZ_RUNTIME && global.MUZZ_RUNTIME.walletConnectProjectId;
    const value = String(pub || runtime || '').trim();
    return /^[a-f0-9]{32}$/i.test(value) ? value : '';
  }

  function walletDeepLinks(pageUrl) {
    const page = String(pageUrl || '');
    const bare = page.replace(/^https?:\/\//, '').replace(/#/g, '%23');
    const enc = encodeURIComponent(page);
    return [
      { name: 'MetaMask', href: 'https://metamask.app.link/dapp/' + bare },
      { name: 'Trust Wallet', href: 'https://link.trustwallet.com/open_url?coin_id=60&url=' + enc },
      { name: 'Coinbase Wallet', href: 'https://go.cb-w.com/dapp?cb_url=' + enc },
      { name: 'Rainbow', href: 'https://rnbwapp.com/dapp?url=' + enc },
      { name: 'OKX', href: 'https://www.okx.com/download?deeplink=' + encodeURIComponent('okx://wallet/dapp/url?dappUrl=' + enc) },
      { name: 'Phantom', href: 'https://phantom.app/ul/browse/' + enc + '?ref=' + enc }
    ];
  }

  function randomNonce() {
    const bytes = new Uint8Array(16);
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function buildLoginMessage(address, opts) {
    const options = opts || {};
    const wallet = ethers.utils.getAddress(address);
    const lines = [
      'MuzzSnap Login',
      '',
      wallet + ' wants to sign in to MuzzSnap.',
      'Sign this message to prove you control this wallet. It does not spend gas.',
      '',
      'Wallet: ' + wallet,
      'Chain ID: 1',
      'Nonce: ' + options.nonce,
      'Expires: ' + options.exp,
      'Token: ' + TOKEN,
      'Minimum: 10000000 MUZZ'
    ];
    if (options.returnApk) lines.push('Return: apk');
    return lines.join('\n');
  }

  function bytesToBase64Url(bytes) {
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    const text = String(value || '');
    const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function encodeHandoff(payload) {
    const json = JSON.stringify({
      v: 1,
      a: String(payload.a).toLowerCase(),
      n: String(payload.n).toLowerCase(),
      e: Number(payload.e),
      s: payload.s
    });
    return bytesToBase64Url(new TextEncoder().encode(json));
  }

  function decodeHandoff(token) {
    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token)));
    } catch (err) {
      const bad = new Error('BAD_TOKEN');
      bad.code = 'bad_token';
      throw bad;
    }
    if (!data || data.v !== 1 || !/^0x[a-f0-9]{40}$/i.test(data.a || '')) {
      const bad = new Error('BAD_TOKEN');
      bad.code = 'bad_token';
      throw bad;
    }
    if (!/^[a-f0-9]{32}$/i.test(data.n || '') || !/^0x[a-f0-9]+$/i.test(data.s || '')) {
      const bad = new Error('BAD_TOKEN');
      bad.code = 'bad_token';
      throw bad;
    }
    const exp = Number(data.e);
    if (!Number.isFinite(exp)) {
      const bad = new Error('BAD_TOKEN');
      bad.code = 'bad_token';
      throw bad;
    }
    return { v: 1, a: String(data.a).toLowerCase(), n: String(data.n).toLowerCase(), e: exp, s: data.s };
  }

  function handoffUrl(token) {
    return 'muzzsnap://auth?token=' + encodeURIComponent(token);
  }

  function tokenFromUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol !== 'muzzsnap:' || parsed.hostname !== 'auth') return '';
      return parsed.searchParams.get('token') || '';
    } catch (err) {
      return '';
    }
  }

  function readNonces() {
    try {
      const parsed = JSON.parse(localStorage.getItem(NONCE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function nonceUsed(nonce) {
    return Boolean(readNonces()[String(nonce || '').toLowerCase()]);
  }

  function consumeNonce(nonce, exp) {
    const map = readNonces();
    const now = Date.now();
    Object.keys(map).forEach((key) => {
      if (Number(map[key]) < now) delete map[key];
    });
    const id = String(nonce || '').toLowerCase();
    if (!id || map[id]) return false;
    map[id] = Number(exp) || (now + HANDOFF_MS);
    localStorage.setItem(NONCE_KEY, JSON.stringify(map));
    return true;
  }

  function verifyHandoff(token, now) {
    const data = decodeHandoff(token);
    const clock = Number(now) || Date.now();
    if (clock > data.e) {
      const expired = new Error('EXPIRED');
      expired.code = 'expired';
      throw expired;
    }
    if (nonceUsed(data.n)) {
      const used = new Error('ALREADY_USED');
      used.code = 'used';
      throw used;
    }
    const message = buildLoginMessage(data.a, { nonce: data.n, exp: data.e, returnApk: true });
    let recovered = '';
    try {
      recovered = ethers.utils.verifyMessage(message, data.s);
    } catch (err) {
      const bad = new Error('BAD_SIGNATURE');
      bad.code = 'bad_sig';
      throw bad;
    }
    if (String(recovered).toLowerCase() !== data.a) {
      const bad = new Error('BAD_SIGNATURE');
      bad.code = 'bad_sig';
      throw bad;
    }
    if (!consumeNonce(data.n, data.e)) {
      const used = new Error('ALREADY_USED');
      used.code = 'used';
      throw used;
    }
    return { address: data.a, message, signature: data.s, exp: data.e };
  }

  function explainSignError(err, opts) {
    const inWallet = Boolean(opts && opts.inWallet);
    const msg = (err && (err.message || err.reason)) ? String(err.message || err.reason) : 'Connection rejected.';
    const code = err && err.code;
    if (code === 'expired' || msg === 'EXPIRED') {
      return { title: 'Sign-in expired.', desc: 'That signature is older than 3 minutes. Go back to MuzzSnap and sign in again.' };
    }
    if (code === 'used' || msg === 'ALREADY_USED') {
      return { title: 'Sign-in already used.', desc: 'This return link was already used on this device. Sign in again.' };
    }
    if (code === 'bad_sig' || code === 'bad_token' || /BAD_SIGNATURE|BAD_TOKEN|does not match/i.test(msg)) {
      return { title: 'Could not sign in.', desc: 'The signature does not match this wallet. Sign the message again from MuzzSnap.' };
    }
    if (code === 'NO_PROJECT_ID' || msg === 'NO_PROJECT_ID') {
      return { title: 'WalletConnect is not configured.', desc: 'Set WALLETCONNECT_PROJECT_ID and rebuild the app. Until then, choose a wallet below.' };
    }
    if (code === 'wc_load' || msg === 'wc_load') {
      return { title: 'Could not sign in.', desc: 'The wallet picker could not be opened. Check your connection and try again.' };
    }
    if (msg === 'NO_WALLET' || code === 'NO_WALLET' || /no provider|sdk/i.test(msg)) {
      return {
        title: 'Wallet not installed.',
        desc: inWallet
          ? 'This wallet browser did not expose an Ethereum provider. Switch to Ethereum mode and try again.'
          : 'Install MetaMask, Trust Wallet, Coinbase Wallet, Rainbow, OKX or Phantom, or open this page inside the wallet.'
      };
    }
    if (code === 'chain' || /Wrong network/i.test(msg)) {
      return {
        title: 'Wrong network.',
        desc: /Wrong network/i.test(msg) ? msg : 'Wrong network. Accept the switch to Ethereum mainnet and try again.'
      };
    }
    if (code === 'balance' || /Insufficient MUZZ/i.test(msg)) {
      return { title: 'Insufficient MUZZ balance.', desc: msg };
    }
    if (code === 'rejected' || code === 4001 || /rejected|denied|cancel/i.test(msg)) {
      return { title: 'Signature rejected.', desc: 'The wallet cancelled the connection or the signature.' };
    }
    if (code === 'pending' || msg === 'pending') {
      return { title: 'Could not sign in.', desc: 'A request is already open in the wallet. Finish it there and try again.' };
    }
    return { title: 'Could not sign in.', desc: msg };
  }

  function rememberWallet(address) {
    const wallet = String(address || '').toLowerCase();
    sessionStorage.setItem('muzz_wallet_address', wallet);
    localStorage.setItem('muzz_wallet_address', wallet);
  }

  function savedWallet() {
    return sessionStorage.getItem('muzz_wallet_address') || localStorage.getItem('muzz_wallet_address') || '';
  }

  function clearWallet() {
    sessionStorage.removeItem('muzz_wallet_address');
    localStorage.removeItem('muzz_wallet_address');
    sessionStorage.removeItem('muzz_login_sig');
    sessionStorage.removeItem('muzz_login_msg');
    sessionStorage.removeItem('muzz_user_role');
    sessionStorage.removeItem('muzz_is_admin');
  }

  global.muzzGate = {
    TOKEN,
    MIN_WHOLE,
    DEFAULT_PUBLIC,
    HANDOFF_MS,
    readMuzzBalance,
    visible,
    isMainnet,
    appPublicUrl,
    isEmbeddedOrigin,
    publicLoginUrl,
    loginPageForWallets,
    walletConnectProjectId,
    walletDeepLinks,
    randomNonce,
    buildLoginMessage,
    encodeHandoff,
    decodeHandoff,
    handoffUrl,
    tokenFromUrl,
    nonceUsed,
    consumeNonce,
    verifyHandoff,
    explainSignError,
    rememberWallet,
    savedWallet,
    clearWallet
  };
})(window);
