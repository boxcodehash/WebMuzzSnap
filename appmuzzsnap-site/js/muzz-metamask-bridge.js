/**
 * Mobile MetaMask open + Capacitor return bridge.
 * Mobile browsers open MetaMask in the same tap. The native app still
 * returns through muzzsnap://auth after mm-bridge signs.
 */
(function (global) {
  'use strict';

  var RETURN_SCHEME = 'muzzsnap://auth';
  var pendingResolve = null;
  var pendingReject = null;
  var listenerReady = false;

  global.MuzzWalletDebug = global.MuzzWalletDebug || {
    lines: [],
    log: function (step) {
      var stamp = new Date().toISOString().slice(11, 23);
      var line = stamp + '  ' + step;
      this.lines.push(line);
      if (this.lines.length > 60) this.lines.shift();
      try { sessionStorage.setItem('muzz_wallet_log', this.lines.join('\n')); } catch (_) {}
      var pre = document.getElementById('walletLog');
      if (pre) pre.textContent = this.lines.join('\n');
      var box = document.getElementById('walletDebug');
      if (box) box.hidden = false;
    },
    text: function () { return this.lines.join('\n'); }
  };

  function log(step) {
    if (global.MuzzWalletDebug && MuzzWalletDebug.log) MuzzWalletDebug.log(step);
  }

  function timeouts() {
    var t = global.MUZZ_WALLET_TIMEOUTS || {};
    return {
      connect: t.connect || 20000,
      sign: t.sign || 45000,
      deeplink: t.deeplink || 60000
    };
  }

  function isNative() {
    try {
      return !!(global.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  function isMobileWeb() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function inMetaMaskApp() {
    return /MetaMaskMobile/i.test(navigator.userAgent || '');
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

  function hasInjectedProvider() {
    return !!pickProvider();
  }

  /** Phone browser with no injected wallet. Already inside MetaMask: do not deep-link again. */
  function shouldOpenMetaMask() {
    if (isNative() || inMetaMaskApp() || pickProvider()) return false;
    return isMobileWeb();
  }

  function dappPath() {
    var path = location.pathname || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    return location.host + path + '?mmlogin=1';
  }

  function universalLink() {
    return 'https://metamask.app.link/dapp/' + dappPath();
  }

  function schemeLink() {
    return 'metamask://dapp/' + dappPath();
  }

  /**
   * Assign the deep link synchronously. No await before this.
   * Android tries the app scheme first (no Branch hop). iOS uses the universal link.
   */
  function openMetaMaskNow() {
    var android = /Android/i.test(navigator.userAgent || '');
    var target = android ? schemeLink() : universalLink();
    log('deeplink assign ' + target);
    try { sessionStorage.setItem('muzz_deeplink_at', String(Date.now())); } catch (_) {}
    location.assign(target);
    if (android) {
      setTimeout(function () {
        if (document.visibilityState === 'visible') {
          var fallback = universalLink();
          log('scheme still visible, universal fallback ' + fallback);
          location.assign(fallback);
        }
      }, 800);
    }
  }

  function bridgePage() {
    if (/^https?:$/i.test(location.protocol) && location.host) {
      return location.origin + '/mm-bridge.html';
    }
    return 'https://appmuzzsnap.vercel.app/mm-bridge';
  }

  function clearStaleWalletConnect() {
    var removed = 0;
    try {
      var keys = [];
      var i;
      for (i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function (k) {
        if (!k) return;
        if (/^wc@2:|^walletconnect|WALLETCONNECT/i.test(k)) {
          localStorage.removeItem(k);
          removed++;
        }
      });
    } catch (_) {}
    var eth = pickProvider();
    try {
      var wc = eth && (eth.isWalletConnect || (eth.provider && eth.provider.isWalletConnect));
      if (wc && typeof eth.disconnect === 'function') {
        eth.disconnect();
        removed++;
        log('walletconnect disconnect');
      }
    } catch (e) {
      log('walletconnect disconnect failed ' + (e && e.message ? e.message : e));
    }
    if (removed) log('cleared stale walletconnect ' + removed);
    return removed;
  }

  /** Bring a WalletConnect wallet forward without leaving this page. */
  function foregroundForSign(eth) {
    var wc = eth && (eth.isWalletConnect || (eth.provider && eth.provider.isWalletConnect));
    if (!wc) {
      log('sign in place');
      return;
    }
    var href = 'https://metamask.app.link/';
    log('foreground walletconnect ' + href);
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
  }

  function openExternal(url) {
    try {
      if (global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser && Capacitor.Plugins.Browser.open) {
        return Capacitor.Plugins.Browser.open({ url: url });
      }
    } catch (_) {}
    location.assign(url);
    return Promise.resolve();
  }

  function parseAuthUrl(url) {
    try {
      var u = String(url || '');
      var qIndex = u.indexOf('?');
      if (qIndex < 0) return null;
      var qs = new URLSearchParams(u.slice(qIndex + 1));
      var address = qs.get('address');
      var signature = qs.get('signature');
      var message = qs.get('message');
      var nonce = qs.get('nonce');
      var at = qs.get('at');
      var purpose = qs.get('purpose') || 'muzz_balance_gate';
      if (!address || !signature || !message || !nonce || !at) return null;
      return {
        address: address,
        signature: signature,
        message: message,
        nonce: nonce,
        at: Number(at),
        purpose: purpose
      };
    } catch (_) {
      return null;
    }
  }

  function completePending(payload, err) {
    var resolve = pendingResolve;
    var reject = pendingReject;
    pendingResolve = null;
    pendingReject = null;
    if (err) {
      if (reject) reject(err);
      return;
    }
    if (resolve) resolve(payload);
  }

  function ensureListener() {
    if (listenerReady) return;
    listenerReady = true;
    try {
      if (global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App && Capacitor.Plugins.App.addListener) {
        Capacitor.Plugins.App.addListener('appUrlOpen', function (event) {
          var payload = parseAuthUrl(event && event.url);
          if (!payload) return;
          log('native return');
          completePending(payload, null);
        });
      }
    } catch (_) {}
  }

  function requestSignedAuth(purpose, onStatus) {
    ensureListener();
    return new Promise(function (resolve, reject) {
      if (pendingResolve) {
        reject(new Error('Another MetaMask login is already in progress'));
        return;
      }
      pendingResolve = resolve;
      pendingReject = reject;

      var qs =
        '?purpose=' + encodeURIComponent(purpose || 'muzz_balance_gate') +
        '&return=' + encodeURIComponent(RETURN_SCHEME);
      var page = bridgePage() + qs;
      var mmLink = 'https://metamask.app.link/dapp/' + page.replace(/^https?:\/\//, '');
      log('native deeplink ' + mmLink);
      onStatus && onStatus('Opening MetaMask…');
      try {
        openExternal(mmLink);
      } catch (e) {
        completePending(null, e);
        return;
      }

      setTimeout(function () {
        if (pendingResolve) {
          log('native deeplink timeout');
          completePending(null, new Error('Timed out waiting for the MetaMask signature. Tap Retry.'));
        }
      }, timeouts().deeplink);
    });
  }

  function boot() {
    clearStaleWalletConnect();
    var eth = pickProvider();
    log('boot provider=' + (eth ? 'yes' : 'no') + ' mobile=' + isMobileWeb() + ' metamaskApp=' + inMetaMaskApp());
    if (!eth || !eth.request) return;
    eth.request({ method: 'eth_chainId' }).then(function (id) {
      global.__muzzChainId = id;
      log('preload chain ' + id);
    }).catch(function (e) {
      log('preload chain failed ' + (e && e.message ? e.message : e));
    });
    eth.request({ method: 'eth_accounts' }).then(function (acc) {
      log('preload accounts ' + ((acc && acc.length) || 0));
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.MuzzMetaMaskBridge = {
    isNative: isNative,
    isMobileWeb: isMobileWeb,
    inMetaMaskApp: inMetaMaskApp,
    hasInjectedProvider: hasInjectedProvider,
    shouldOpenMetaMask: shouldOpenMetaMask,
    openMetaMaskNow: openMetaMaskNow,
    universalLink: universalLink,
    schemeLink: schemeLink,
    clearStaleWalletConnect: clearStaleWalletConnect,
    foregroundForSign: foregroundForSign,
    requestSignedAuth: requestSignedAuth,
    parseAuthUrl: parseAuthUrl,
    timeouts: timeouts,
    RETURN_SCHEME: RETURN_SCHEME
  };
})(window);
