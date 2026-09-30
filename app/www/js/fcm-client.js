/**
 * Closed-app private alerts.
 * The page asks https://muzzsnap-app.vercel.app/api/notify after a private
 * message is saved. The notification text is always "New private message".
 * Message text is never sent to that API.
 * The APK origin is https://muzzsnap-app.vercel.app. Web push still uses the
 * native Capacitor plugin, because a page service worker cannot receive FCM.
 */
(function (global) {
  var PUBLIC_API = 'https://muzzsnap-app.vercel.app';
  var PUBLIC_VAPID = 'BD4Waq9Zdd8iVPmAvv3K4brWllOezeIREB_X_m6ijlit0ffs9Ff9GQJc8pjzCefT03A3lshYXCNDmUOPk6sIkew';
  var me = '';
  var arming = null;
  var listening = false;
  var lastToken = '';
  var lastPlatform = '';
  var permission = 'prompt';
  var registered = false;
  var retryTimer = 0;

  function apiBase() {
    try {
      if (location.hostname === 'muzzsnap-app.vercel.app') return '';
    } catch (err) { /* file or capacitor origin */ }
    return PUBLIC_API;
  }

  function walletOf(value) {
    var wallet = String(value || '').toLowerCase();
    return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : '';
  }

  function statusLine() {
    var perm = permission === 'granted'
      ? 'Notifications on'
      : (permission === 'denied' ? 'Notifications off' : 'Notifications not granted');
    var token = registered ? 'token registered' : (lastToken ? 'token not registered' : 'no token');
    return perm + ' · ' + token;
  }

  function paintStatus() {
    var line = statusLine();
    try {
      global.dispatchEvent(new CustomEvent('muzz-push-status', {
        detail: { line: line, permission: permission, registered: registered }
      }));
    } catch (err) { /* no document yet */ }
    var node = global.document && document.getElementById('muzzPushStatus');
    if (node && node.getAttribute('data-react') !== '1') node.textContent = line;
  }

  function currentUserReady() {
    var auth = firebase.auth();
    var initial = (typeof auth.authStateReady === 'function')
      ? auth.authStateReady().catch(function () { return null; })
      : Promise.resolve();
    return initial.then(function () {
      if (auth.currentUser) return auth.currentUser;
      return new Promise(function (resolve) {
        var unsub = auth.onAuthStateChanged(function (user) {
          unsub();
          resolve(user || null);
        });
      });
    });
  }

  function walletUser(auth, want) {
    var user = auth.currentUser;
    if (!user || !want) return null;
    return String(user.uid).toLowerCase() === want ? user : null;
  }

  function exchangeSession(message, signature) {
    function once() {
      return fetch(apiBase() + '/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, signature: signature })
      }).then(function (res) {
        if (res.status >= 500) return null;
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) return { denied: true, status: res.status, error: body && body.error };
          return body || {};
        });
      });
    }
    return once().then(function (data) {
      if (data) return data;
      return new Promise(function (resolve) { setTimeout(resolve, 800); }).then(once);
    });
  }

  function idToken() {
    var user = firebase.auth().currentUser;
    if (!user || !walletOf(user.uid)) return Promise.resolve('');
    return user.getIdToken();
  }

  function sessionReason(error) {
    if (error === 'expired' || error === 'nonce_used' || error === 'bad_signature' || error === 'bad_format') return error;
    if (error === 'session_used') return 'nonce_used';
    return 'bad_format';
  }

  function holdForSign(reason) {
    try { sessionStorage.setItem('muzz_login_hold', sessionReason(reason)); } catch (err) { /* private mode */ }
  }

  function proofStillFresh(message, signature) {
    var gate = global.muzzGate;
    if (gate && typeof gate.proofReusable === 'function') return gate.proofReusable(message, signature);
    return false;
  }

  function dropStaleProof(message, reason) {
    var gate = global.muzzGate;
    if (gate && typeof gate.markNonceExchanged === 'function' && typeof gate.proofNonce === 'function') {
      gate.markNonceExchanged(gate.proofNonce(message), gate.proofExpiry ? gate.proofExpiry(message) : 0);
    }
    if (gate && typeof gate.clearLoginProof === 'function') gate.clearLoginProof();
    else {
      try {
        sessionStorage.removeItem('muzz_login_msg');
        sessionStorage.removeItem('muzz_login_sig');
        sessionStorage.removeItem('muzz_wc_proof');
        localStorage.removeItem('muzz_session');
      } catch (err) { /* private mode */ }
    }
    holdForSign(reason);
    var code = sessionReason(reason);
    console.warn('session rejected: ' + code);
    try {
      var rows = JSON.parse(sessionStorage.getItem('muzz_debug_log') || '[]');
      if (!Array.isArray(rows)) rows = [];
      rows.push(new Date().toISOString() + '  session:' + code);
      if (rows.length > 80) rows.shift();
      sessionStorage.setItem('muzz_debug_log', JSON.stringify(rows));
    } catch (err) { /* private mode */ }
  }

  function storedProof() {
    var message = '';
    var signature = '';
    try {
      message = sessionStorage.getItem('muzz_login_msg') || '';
      signature = sessionStorage.getItem('muzz_login_sig') || '';
    } catch (err) { /* private mode */ }
    if (proofStillFresh(message, signature)) return { message: message, signature: signature };
    try {
      var data = JSON.parse(localStorage.getItem('muzz_session') || 'null');
      if (!data || Number(data.until) <= Date.now()) return null;
      if (!proofStillFresh(data.message, data.signature)) return null;
      return { message: data.message, signature: data.signature };
    } catch (err) {
      return null;
    }
  }

  function needsFreshSign(reason) {
    dropStaleProof('', reason || 'expired');
    return { needsSign: true, reason: sessionReason(reason || 'expired') };
  }

  function signInForChat(wallet) {
    var want = walletOf(wallet);
    var auth = firebase.auth();
    var persist = (auth.setPersistence && firebase.auth.Auth && firebase.auth.Auth.Persistence)
      ? auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () { return null; })
      : Promise.resolve();
    return persist.then(function () { return currentUserReady(); }).then(function (existing) {
      var kept = walletUser(auth, want) || (existing && want && String(existing.uid).toLowerCase() === want ? existing : null);
      if (kept) {
        start(want);
        return kept;
      }
      var proof = storedProof();
      var message = proof ? proof.message : '';
      var signature = proof ? proof.signature : '';
      if (!want || !message || !signature) return needsFreshSign('expired');
      return exchangeSession(message, signature).then(function (data) {
        if (data && data.customToken) {
          if (global.muzzGate && typeof global.muzzGate.consumeLoginProof === 'function') {
            global.muzzGate.consumeLoginProof(message);
          }
          try { sessionStorage.removeItem('muzz_login_hold'); } catch (err) { /* private mode */ }
          return auth.signInWithCustomToken(data.customToken);
        }
        if (data && data.denied) {
          dropStaleProof(message, data.error || 'expired');
          return { needsSign: true, reason: sessionReason(data.error || 'expired') };
        }
        return null;
      }).then(function (cred) {
        if (cred && cred.needsSign) return cred;
        if (cred && cred.user) {
          start(want);
          return cred.user;
        }
        return needsFreshSign('expired');
      }).catch(function () {
        return needsFreshSign('expired');
      });
    });
  }

  function saveToken(token, platform) {
    return idToken().then(function (bearer) {
      if (!bearer || !token) return false;
      return fetch(apiBase() + '/api/register-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + bearer
        },
        body: JSON.stringify({ token: token, platform: platform })
      }).then(function (res) {
        if (res.ok) {
          registered = true;
          global.__muzzFcmReady = true;
        }
        paintStatus();
        return res.ok;
      });
    }).catch(function () { return false; });
  }

  function rememberToken(token, platform) {
    if (!token) return;
    lastToken = String(token);
    lastPlatform = platform === 'web' ? 'web' : 'android';
    paintStatus();
    flushToken();
    scheduleFlush();
  }

  function flushToken() {
    if (!lastToken || !walletOf(me)) return Promise.resolve(false);
    return saveToken(lastToken, lastPlatform || 'android').then(function (ok) {
      registered = !!ok;
      if (!ok) global.__muzzFcmReady = false;
      paintStatus();
      return ok;
    });
  }

  function scheduleFlush() {
    if (retryTimer || registered) return;
    var tries = 0;
    retryTimer = setInterval(function () {
      tries += 1;
      if (registered || tries > 12) {
        clearInterval(retryTimer);
        retryTimer = 0;
        return;
      }
      flushToken();
    }, 15000);
  }

  function pushPlugin() {
    var Cap = global.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return null;
    if (typeof Cap.registerPlugin !== 'function') return null;
    try { return Cap.registerPlugin('PushNotifications'); } catch (err) { return null; }
  }

  function applyNativePermission() {
    var value = global.__muzzNativePushPermission;
    if (value === 'granted' || value === 'denied') permission = value;
  }

  function listenAndroid(Push) {
    if (listening || !Push.addListener) return;
    listening = true;
    Push.addListener('registration', function (event) {
      var value = event && event.value;
      if (value) rememberToken(value, 'android');
    });
    Push.addListener('registrationError', function () {
      registered = false;
      global.__muzzFcmReady = false;
      paintStatus();
    });
    Push.addListener('pushNotificationActionPerformed', function (event) {
      var note = event && event.notification;
      var data = note && note.data;
      var peer = data && data.peer;
      var target = 'private.html';
      if (peer && /^0x[a-fA-F0-9]{40}$/i.test(peer)) {
        target += '?peer=' + encodeURIComponent(String(peer).toLowerCase());
      }
      global.location.href = target;
    });
  }

  function armAndroid() {
    var Push = pushPlugin();
    if (!Push) return Promise.resolve(false);
    listenAndroid(Push);
    applyNativePermission();
    var checked = Push.checkPermissions ? Push.checkPermissions() : Promise.resolve(null);
    return Promise.resolve(checked).then(function (perm) {
      var receive = perm && perm.receive;
      if (receive === 'granted' || receive === 'denied') return perm;
      if (!Push.requestPermissions) return perm;
      return Push.requestPermissions();
    }).then(function (perm) {
      var receive = perm && perm.receive;
      if (receive === 'granted' || receive === 'denied') permission = receive;
      else applyNativePermission();
      paintStatus();
      if (permission === 'granted' && Push.createChannel) {
        return Push.createChannel({
          id: 'private',
          name: 'Private messages',
          description: 'New private messages',
          importance: 4,
          visibility: 1
        }).catch(function () { return null; });
      }
      return null;
    }).then(function () {
      if (global.__muzzNativeFcmToken) rememberToken(global.__muzzNativeFcmToken, 'android');
      return Push.register();
    }).then(function () {
      return flushToken();
    }).catch(function () {
      paintStatus();
      return false;
    });
  }

  function loadMessaging() {
    if (firebase.messaging) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js';
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('messaging')); };
      document.head.appendChild(script);
    });
  }

  function armWeb() {
    if (pushPlugin()) return armAndroid();
    if (!('Notification' in global) || !navigator.serviceWorker) {
      permission = 'denied';
      paintStatus();
      return Promise.resolve(false);
    }
    if (Notification.permission === 'denied') {
      permission = 'denied';
      paintStatus();
      return Promise.resolve(false);
    }
    var permit = Notification.permission === 'granted'
      ? Promise.resolve('granted')
      : Notification.requestPermission();
    return Promise.resolve(permit).then(function (result) {
      permission = result === 'granted' ? 'granted' : (result === 'denied' ? 'denied' : 'prompt');
      paintStatus();
      if (permission !== 'granted') return null;
      return fetch(apiBase() + '/api/push-config').then(function (res) {
        return res.ok ? res.json() : {};
      }).catch(function () { return {}; });
    }).then(function (cfg) {
      if (cfg === null) return false;
      var vapidKey = (cfg && cfg.vapidKey) || PUBLIC_VAPID;
      return loadMessaging().then(function () {
        return navigator.serviceWorker.register('sw.js');
      }).then(function (reg) {
        return firebase.messaging().getToken({
          vapidKey: vapidKey,
          serviceWorkerRegistration: reg
        });
      });
    }).then(function (token) {
      if (!token || token === false) return false;
      rememberToken(token, 'web');
      return flushToken();
    }).catch(function () {
      return false;
    });
  }

  function enable() {
    if (!walletOf(me)) {
      paintStatus();
      return Promise.resolve(false);
    }
    if (arming) return arming;
    applyNativePermission();
    if (global.__muzzNativeFcmToken) rememberToken(global.__muzzNativeFcmToken, 'android');
    var task = pushPlugin() ? armAndroid() : armWeb();
    arming = task.then(function (ok) {
      arming = null;
      scheduleFlush();
      paintStatus();
      return ok;
    }, function () {
      arming = null;
      paintStatus();
      return false;
    });
    return arming;
  }

  function watchAuth() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length || watchAuth.done) return;
      watchAuth.done = true;
      firebase.auth().onAuthStateChanged(function () { flushToken(); });
    } catch (err) { /* auth is not ready on this page yet */ }
  }

  function start(wallet) {
    var next = walletOf(wallet);
    if (next) me = next;
    watchAuth();
    return enable();
  }

  function notify(to) {
    var peer = walletOf(to);
    if (!peer) return Promise.resolve(false);
    return idToken().then(function (bearer) {
      if (!bearer) return false;
      return fetch(apiBase() + '/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + bearer
        },
        body: JSON.stringify({ to: peer })
      }).then(function (res) { return res.ok; });
    }).catch(function () { return false; });
  }

  function notifySelf() {
    return idToken().then(function (bearer) {
      if (!bearer) return false;
      return fetch(apiBase() + '/api/notify-self', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + bearer
        },
        body: '{}'
      }).then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (data) {
          return !!(data && data.sent > 0);
        }).catch(function () { return false; });
      });
    }).catch(function () { return false; });
  }

  global.addEventListener('muzz-fcm-token', function () {
    applyNativePermission();
    if (global.__muzzNativeFcmToken) rememberToken(global.__muzzNativeFcmToken, 'android');
    else paintStatus();
  });

  global.MuzzPush = {
    signInForChat: signInForChat,
    start: start,
    enable: enable,
    notify: notify,
    notifySelf: notifySelf,
    statusLine: statusLine
  };
  paintStatus();
})(typeof window !== 'undefined' ? window : globalThis);
