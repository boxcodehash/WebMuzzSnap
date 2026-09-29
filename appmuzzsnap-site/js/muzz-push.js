/**
 * MuzzSnap push notifications (Capacitor + FCM via Vercel)
 * - Registers device token under devices/{walletKey}/tokens/{token}
 * - Calls https://muzzletoken.com/api/push when a private message is sent
 */
(function (global) {
  'use strict';

  var PUSH_API = 'https://muzzletoken.com/api/push';
  // fallback if custom domain frameset interferes
  var PUSH_API_FALLBACK = 'https://muzzletoken.vercel.app/api/push';

  function safeKey(v) {
    return String(v || '').replace(/[.#$/\[\]]/g, '_').toLowerCase();
  }

  function db() {
    if (typeof firebase === 'undefined' || !firebase.apps.length) return null;
    return firebase.database();
  }

  function isNative() {
    try {
      return !!(global.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  async function ensureAuth() {
    if (typeof firebase === 'undefined') return;
    if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
  }

  async function saveToken(wallet, token) {
    var database = db();
    if (!database || !wallet || !token) return;
    await ensureAuth();
    var key = safeKey(wallet);
    await database.ref('devices/' + key + '/tokens/' + token).set({
      token: token,
      platform: 'android',
      at: Date.now(),
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
    await database.ref('devices/' + key + '/meta').update({
      lastTokenAt: firebase.database.ServerValue.TIMESTAMP,
      platform: 'android'
    });
  }

  async function register(wallet) {
    if (!isNative()) return { ok: false, reason: 'not_native' };
    if (!wallet) return { ok: false, reason: 'no_wallet' };
    if (!global.Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.PushNotifications) {
      return { ok: false, reason: 'push_plugin_missing' };
    }
    var Push = Capacitor.Plugins.PushNotifications;

    var perm = await Push.requestPermissions();
    if (perm.receive !== 'granted') {
      return { ok: false, reason: 'permission_denied' };
    }

    // Android 8+ notification channel (must match api/push.js channelId)
    try {
      if (Push.createChannel) {
        await Push.createChannel({
          id: 'muzz_private',
          name: 'Private messages',
          description: 'MuzzSnap private chat alerts',
          importance: 5,
          visibility: 1,
          sound: 'default',
          vibration: true,
          lights: true
        });
      }
    } catch (_) {}

    await Push.register();

    return new Promise(function (resolve) {
      var done = false;
      var finish = function (result) {
        if (done) return;
        done = true;
        resolve(result);
      };

      Push.addListener('registration', async function (token) {
        try {
          await saveToken(wallet, token.value);
          finish({ ok: true, token: token.value });
        } catch (e) {
          finish({ ok: false, reason: e.message || String(e) });
        }
      });

      Push.addListener('registrationError', function (err) {
        finish({ ok: false, reason: (err && err.error) || 'registration_error' });
      });

      Push.addListener('pushNotificationReceived', function (notification) {
        console.log('[MuzzPush] foreground', notification);
      });

      Push.addListener('pushNotificationActionPerformed', function (action) {
        console.log('[MuzzPush] opened', action);
        try {
          // Open private inbox when user taps notification
          if (location.pathname.indexOf('private') < 0) {
            location.href = 'private.html';
          }
        } catch (_) {}
      });

      setTimeout(function () {
        finish({ ok: false, reason: 'registration_timeout' });
      }, 20000);
    });
  }

  async function notifyPrivateMessage(toWallet, fromWallet, preview) {
    if (!toWallet || !fromWallet) return { ok: false };
    if (safeKey(toWallet) === safeKey(fromWallet)) return { ok: false };

    var fromName = String(fromWallet).slice(0, 6) + '…' + String(fromWallet).slice(-4);
    var payload = {
      toWallet: String(toWallet).toLowerCase(),
      title: 'MuzzSnap · Private message',
      body: 'Encrypted message from ' + fromName,
      data: {
        type: 'private_message',
        fromWallet: String(fromWallet).toLowerCase(),
        preview: preview ? String(preview).slice(0, 40) : ''
      }
    };

    async function post(url) {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var json = null;
      try { json = await res.json(); } catch (_) {}
      return { status: res.status, json: json };
    }

    try {
      var r = await post(PUSH_API);
      if (r.status >= 400) r = await post(PUSH_API_FALLBACK);
      return r.json || { ok: false, status: r.status };
    } catch (e) {
      try {
        var r2 = await post(PUSH_API_FALLBACK);
        return r2.json || { ok: false, error: e.message };
      } catch (e2) {
        return { ok: false, error: e2.message || String(e2) };
      }
    }
  }

  /**
   * Registers this device, then asks Vercel to push to the same wallet.
   * Useful once after installing the APK (?pushdebug=1 on private.html).
   */
  async function selfTest(wallet) {
    var reg = await register(wallet);
    if (!reg || !reg.ok) return { ok: false, step: 'register', reg: reg };
    // fromWallet must differ so notifyPrivateMessage does not no-op
    var push = await notifyPrivateMessage(wallet, '0xmuzzpushselftest00000000000000000001', 'self-test');
    return { ok: !!(push && push.ok && push.sent > 0), step: 'push', reg: reg, push: push };
  }

  global.MuzzPush = {
    register: register,
    saveToken: saveToken,
    notifyPrivateMessage: notifyPrivateMessage,
    selfTest: selfTest,
    PUSH_API: PUSH_API
  };
})(window);
