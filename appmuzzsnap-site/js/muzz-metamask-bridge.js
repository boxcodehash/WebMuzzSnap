/**
 * Capacitor / Android MetaMask bridge
 * Opens MetaMask app via deeplink Ã¢â€ â€™ sign on mm-bridge.html Ã¢â€ â€™ returns muzzsnap://auth?...
 */
(function (global) {
  'use strict';

  // Hosted on Vercel project appmuzzsnap (full MuzzSnap web app)
  // Use clean URL Ã¢â‚¬â€ Vercel cleanUrls 308s *.html and MetaMask shows "page does not exist"
  var BRIDGE_HTTPS = 'https://appmuzzsnap.vercel.app/mm-bridge';
  var BRIDGE_HTTPS_FALLBACK = 'https://appmuzzsnap.vercel.app/mm-bridge';
  var RETURN_SCHEME = 'muzzsnap://auth';
  var pendingResolve = null;
  var pendingReject = null;
  var listenerReady = false;

  function isNative() {
    try {
      return !!(global.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  function hasInjectedProvider() {
    return !!(global.ethereum);
  }

  function openExternal(url) {
    try {
      if (global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser && Capacitor.Plugins.Browser.open) {
        return Capacitor.Plugins.Browser.open({ url: url });
      }
    } catch (_) {}
    try {
      if (global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App && Capacitor.Plugins.App.openUrl) {
        return Capacitor.Plugins.App.openUrl({ url: url });
      }
    } catch (_) {}
    global.open(url, '_system');
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
          completePending(payload, null);
        });
      }
    } catch (_) {}

    // Also handle cold-start / hash fallback
    try {
      if (location.hash && location.hash.indexOf('muzzauth=') >= 0) {
        var raw = decodeURIComponent(location.hash.replace(/^#muzzauth=/, ''));
        var payload2 = parseAuthUrl('muzzsnap://auth?' + raw);
        if (payload2) completePending(payload2, null);
      }
    } catch (_) {}
  }

  /**
   * Opens MetaMask in-app browser on the HTTPS bridge page.
   * Bridge signs and returns via muzzsnap://auth?...
   */
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
      var url = BRIDGE_HTTPS + qs;
      var urlFallback = BRIDGE_HTTPS_FALLBACK + qs;

      // MetaMask deep link Ã¢â€ â€™ opens bridge inside MetaMask in-app browser
      // Format: https://link.metamask.io/dapp/<host>/<path>?<query>
      var mmLink = 'https://link.metamask.io/dapp/' + url.replace(/^https?:\/\//, '');

      onStatus && onStatus('Opening MetaMaskÃ¢â‚¬Â¦');
      openExternal(mmLink).catch(function () {
        return openExternal(url).catch(function () {
          return openExternal(urlFallback);
        });
      });

      // Timeout if user never returns
      setTimeout(function () {
        if (pendingResolve) {
          completePending(null, new Error('MetaMask login timed out. Return to MuzzSnap after signing.'));
        }
      }, 180000);
    });
  }

  global.MuzzMetaMaskBridge = {
    isNative: isNative,
    hasInjectedProvider: hasInjectedProvider,
    requestSignedAuth: requestSignedAuth,
    parseAuthUrl: parseAuthUrl,
    BRIDGE_HTTPS: BRIDGE_HTTPS,
    RETURN_SCHEME: RETURN_SCHEME,
  };
})(window);
