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
  const RPCS = ['https://ethereum.publicnode.com', 'https://cloudflare-eth.com'];
  const ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)'
  ];
  const READ_MS = 24 * 60 * 60 * 1000;
  const SEEN_KEY = 'muzz_seen_v1';

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

  function walletDeepLinks(pageUrl) {
    const page = String(pageUrl || '');
    const bare = page.replace(/^https?:\/\//, '');
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
    readMuzzBalance,
    visible,
    walletDeepLinks,
    rememberWallet,
    savedWallet,
    clearWallet
  };
})(window);
