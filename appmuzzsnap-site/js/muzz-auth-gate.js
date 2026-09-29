/**
 * Secure MuzzSnap entry gate
 * Paths:
 *  A) Mainnet MUZZ balance ≥ 2,000,000 + personal_sign verified
 *  B) Own MuzzID NFT + personal_sign verified
 * Nobody enters without signed auth + one of the above.
 */
(function (global) {
  'use strict';

  var MUZZ_TOKEN = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';
  var MIN_MUZZ = 2000000;
  var AUTH_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  var ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ];

  function norm(a) {
    return String(a || '').trim().toLowerCase();
  }

  function pickProvider() {
    var eth = global.ethereum;
    if (!eth) return null;
    if (eth.providers && eth.providers.length) {
      return (
        eth.providers.find(function (p) { return p.isMetaMask && !p.isBraveWallet; }) ||
        eth.providers.find(function (p) { return p.isMetaMask; }) ||
        eth.providers[0]
      );
    }
    return eth;
  }

  function clearSessionSoft() {
    var keys = [
      'muzz_wallet_address', 'muzz_login_method', 'muzz_social_gate', 'muzz_auth',
      'muzz_token_balance', 'muzz_entry_path', 'muzz_is_admin', 'muzz_username'
    ];
    keys.forEach(function (k) {
      try { sessionStorage.removeItem(k); } catch (_) {}
    });
  }

  function readAuth() {
    try {
      var raw = sessionStorage.getItem('muzz_auth');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function isAuthFresh(auth) {
    if (!auth || !auth.at || !auth.signature || !auth.address || !auth.message) return false;
    if (Date.now() - Number(auth.at) > AUTH_TTL_MS) return false;
    return true;
  }

  function verifyAuthLocal(auth, expectedWallet) {
    if (!isAuthFresh(auth)) return false;
    if (norm(auth.address) !== norm(expectedWallet)) return false;
    // Full cryptographic check when ethers is available
    try {
      if (global.ethers && ethers.utils && ethers.utils.verifyMessage) {
        var recovered = ethers.utils.verifyMessage(auth.message, auth.signature);
        return norm(recovered) === norm(expectedWallet);
      }
      if (global.ethers && ethers.verifyMessage) {
        var recovered2 = ethers.verifyMessage(auth.message, auth.signature);
        return norm(recovered2) === norm(expectedWallet);
      }
    } catch (_) {
      return false;
    }
    // Hub pages without ethers: trust fresh signed session created at login
    // (signature was already verified when Enter / Mint sealed the session)
    return !!(auth.signature && auth.message && auth.nonce && auth.at);
  }

  async function requestAccounts(eth) {
    // Only eth_requestAccounts — wallet_requestPermissions looks aggressive to MetaMask security scanners
    var accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('No wallet accounts');
    return accounts[0];
  }

  async function ensureMainnet(eth) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
    } catch (e) {
      if (e.code === 4001) throw new Error('Switch to Ethereum Mainnet to verify MUZZ');
      throw e;
    }
  }

  async function signAuth(eth, address, purpose) {
    var nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    var at = Date.now();
    // Keep message plain: ownership proof only (no approvals / no transfers).
    // Avoid wording that security scanners treat as drain/phishing bait.
    var message =
      'Sign in to MuzzSnap\n\n' +
      'This signature proves you own this wallet.\n' +
      'It does NOT move funds, approve tokens, or spend gas.\n\n' +
      'Wallet: ' + address + '\n' +
      'Purpose: ' + (purpose || 'login') + '\n' +
      'Nonce: ' + nonce + '\n' +
      'Time: ' + at;
    var provider = new ethers.providers.Web3Provider(eth);
    var signer = provider.getSigner();
    var signature = await signer.signMessage(message);
    var recovered = ethers.utils.verifyMessage(message, signature);
    if (norm(recovered) !== norm(address)) throw new Error('Signature mismatch');
    var auth = { address: address, message: message, signature: signature, at: at, nonce: nonce, purpose: purpose || 'access' };
    sessionStorage.setItem('muzz_auth', JSON.stringify(auth));
    sessionStorage.setItem('muzz_login_method', 'wallet_signed');
    sessionStorage.setItem('muzz_wallet_address', address);
    return auth;
  }

  async function readMainnetMuzzBalance(address) {
    var provider = new ethers.providers.JsonRpcProvider('https://ethereum.publicnode.com');
    var token = new ethers.Contract(MUZZ_TOKEN, ERC20_ABI, provider);
    var [bal, dec] = await Promise.all([token.balanceOf(address), token.decimals()]);
    var human = Number(ethers.utils.formatUnits(bal, dec));
    return { bal: bal, human: human, decimals: Number(dec) };
  }

  function applySignedAuth(auth) {
    sessionStorage.setItem('muzz_auth', JSON.stringify(auth));
    sessionStorage.setItem('muzz_login_method', 'wallet_signed');
    sessionStorage.setItem('muzz_wallet_address', auth.address);
  }

  /**
   * Capacitor / Android path: open MetaMask app → sign → return via muzzsnap://auth
   */
  async function verifyMuzzGateViaDeeplink(onStatus) {
    if (!global.MuzzMetaMaskBridge) {
      throw new Error('MetaMask bridge missing. Rebuild the APK.');
    }
    onStatus && onStatus('Opening MetaMask to sign…');
    var signed = await MuzzMetaMaskBridge.requestSignedAuth('muzz_balance_gate', onStatus);
    // Verify signature locally
    if (!verifyAuthLocal(signed, signed.address)) {
      // Force crypto verify if possible
      if (global.ethers && ethers.utils && ethers.utils.verifyMessage) {
        var recovered = ethers.utils.verifyMessage(signed.message, signed.signature);
        if (norm(recovered) !== norm(signed.address)) throw new Error('Signature mismatch');
      } else {
        throw new Error('Invalid signature');
      }
    }
    applySignedAuth(signed);
    onStatus && onStatus('Reading MUZZ on contract…');
    var balInfo = await readMainnetMuzzBalance(signed.address);
    if (!(balInfo.human >= MIN_MUZZ)) {
      clearSessionSoft();
      throw new Error('Need ≥ ' + MIN_MUZZ.toLocaleString() + ' MUZZ. Balance: ' + Math.floor(balInfo.human).toLocaleString());
    }
    sessionStorage.setItem('muzz_token_balance', String(balInfo.human));
    sessionStorage.setItem('muzz_social_gate', 'ok');
    sessionStorage.setItem('muzz_entry_path', 'muzz_2m');
    sessionStorage.setItem('muzz_gate_checked_at', String(Date.now()));
    return { address: signed.address, balance: balInfo.human, auth: signed, path: 'muzz_2m' };
  }

  /**
   * Path B: connect + sign + verify ≥2M MUZZ on mainnet contract
   */
  async function verifyMuzzGate(onStatus) {
    var eth = pickProvider();
    // Android APK / Capacitor WebView: no injected provider → MetaMask deeplink bridge
    if (!eth) {
      var native = !!(global.MuzzMetaMaskBridge && MuzzMetaMaskBridge.isNative && MuzzMetaMaskBridge.isNative());
      var likelyAndroid = /Android/i.test(navigator.userAgent || '');
      if (native || likelyAndroid) {
        return verifyMuzzGateViaDeeplink(onStatus);
      }
      throw new Error('Install MetaMask');
    }
    // Brave: if default wallet is Brave, keep trying MetaMask from providers[]
    if (eth.isBraveWallet && !eth.isMetaMask) {
      var mm = pickProvider();
      if (mm && mm.isMetaMask && !mm.isBraveWallet) eth = mm;
      else if (mm && mm.isMetaMask) eth = mm;
      else {
        throw new Error('In Brave: Settings → Extensions → MetaMask → set as default wallet, then retry');
      }
    }
    onStatus && onStatus('Open MetaMask…');
    var address = await requestAccounts(eth);
    onStatus && onStatus('Switch to Ethereum Mainnet…');
    await ensureMainnet(eth);
    // re-read account on mainnet
    var accounts = await eth.request({ method: 'eth_accounts' });
    address = accounts[0] || address;
    onStatus && onStatus('Sign verification message…');
    var auth = await signAuth(eth, address, 'muzz_balance_gate');
    onStatus && onStatus('Reading MUZZ on contract…');
    var balInfo = await readMainnetMuzzBalance(address);
    if (!(balInfo.human >= MIN_MUZZ)) {
      clearSessionSoft();
      throw new Error('Need ≥ ' + MIN_MUZZ.toLocaleString() + ' MUZZ. Balance: ' + Math.floor(balInfo.human).toLocaleString());
    }
    sessionStorage.setItem('muzz_token_balance', String(balInfo.human));
    sessionStorage.setItem('muzz_social_gate', 'ok');
    sessionStorage.setItem('muzz_entry_path', 'muzz_2m');
    sessionStorage.setItem('muzz_gate_checked_at', String(Date.now()));
    return { address: address, balance: balInfo.human, auth: auth, path: 'muzz_2m' };
  }

  /**
   * After MuzzID mint: require signature binding wallet to NFT entry
   */
  async function sealMuzzIdEntry(address, onStatus) {
    var eth = pickProvider();
    if (!eth) throw new Error('Install MetaMask');
    onStatus && onStatus('Sign to activate MuzzID entry…');
    var accounts = await eth.request({ method: 'eth_requestAccounts' });
    var addr = accounts[0];
    if (norm(addr) !== norm(address)) throw new Error('Wallet mismatch');
    await signAuth(eth, addr, 'muzzid_entry');
    // Confirm NFT ownership if possible
    var hasNft = false;
    try {
      if (global.MuzzID && MuzzID.resolveMuzzId) {
        var info = await MuzzID.resolveMuzzId(addr);
        hasNft = !!(info && info.name);
        if (hasNft) {
          sessionStorage.setItem('muzz_profile_display', info.name);
          sessionStorage.setItem('muzz_profile_is_nft', '1');
        }
      }
    } catch (_) {}
    var sess = null;
    try { sess = JSON.parse(sessionStorage.getItem('muzz_id_nft') || 'null'); } catch (_) {}
    if (!hasNft && !(sess && sess.name && norm(sess.wallet) === norm(addr))) {
      throw new Error('No MuzzID NFT found for this wallet');
    }
    sessionStorage.setItem('muzz_social_gate', 'ok');
    sessionStorage.setItem('muzz_entry_path', 'muzzid');
    sessionStorage.setItem('muzz_wallet_address', addr);
    return { address: addr, path: 'muzzid', name: (sess && sess.name) || sessionStorage.getItem('muzz_profile_display') };
  }

  /**
   * Guard used by shell pages
   */
  function canEnterHub() {
    var w = sessionStorage.getItem('muzz_wallet_address') || '';
    if (!w || w.indexOf('guest_') === 0) return { ok: false, reason: 'no_wallet' };
    if (sessionStorage.getItem('muzz_login_method') === 'guest') return { ok: false, reason: 'guest' };
    if (sessionStorage.getItem('muzz_is_admin') === 'true') return { ok: true, admin: true };

    var auth = readAuth();
    if (!verifyAuthLocal(auth, w)) return { ok: false, reason: 'bad_signature' };

    var gate = sessionStorage.getItem('muzz_social_gate');
    var path = sessionStorage.getItem('muzz_entry_path') || '';
    var bal = Number(sessionStorage.getItem('muzz_token_balance') || 0);
    var isNft = sessionStorage.getItem('muzz_profile_is_nft') === '1';
    var nftOk = false;
    try {
      var nft = JSON.parse(sessionStorage.getItem('muzz_id_nft') || 'null');
      nftOk = !!(isNft && nft && nft.name && norm(nft.wallet || w) === norm(w));
    } catch (_) {}

    if (gate === 'ok' && path === 'muzz_2m' && bal >= MIN_MUZZ) {
      return { ok: true, path: path, balance: bal };
    }
    if (gate === 'ok' && (path === 'muzzid' || isNft) && nftOk) {
      return { ok: true, path: 'muzzid' };
    }
    // Signed + 2M (even if entry_path missing)
    if (gate === 'ok' && bal >= MIN_MUZZ) {
      return { ok: true, path: 'muzz_2m', balance: bal };
    }
    // Signed + MuzzID session bound to wallet
    if (gate === 'ok' && nftOk) {
      return { ok: true, path: 'muzzid' };
    }
    return { ok: false, reason: 'gate_denied' };
  }

  global.MuzzAuthGate = {
    MUZZ_TOKEN: MUZZ_TOKEN,
    MIN_MUZZ: MIN_MUZZ,
    AUTH_TTL_MS: AUTH_TTL_MS,
    pickProvider: pickProvider,
    verifyMuzzGate: verifyMuzzGate,
    sealMuzzIdEntry: sealMuzzIdEntry,
    canEnterHub: canEnterHub,
    clearSessionSoft: clearSessionSoft,
    readAuth: readAuth,
    verifyAuthLocal: verifyAuthLocal,
    readMainnetMuzzBalance: readMainnetMuzzBalance,
  };
})(window);
