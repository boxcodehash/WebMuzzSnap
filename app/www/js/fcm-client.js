/**
 * Closed-app private alerts.
 * The page asks https://muzzsnap-app.vercel.app/api/notify after a private
 * message is saved. The notification text is always "New private message".
 * Message text is never sent to that API.
 * The APK origin is https://localhost, so a service worker cannot register
 * FCM. The native Capacitor plugin (and the activity token) is required.
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
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise(function (resolve) {
      var unsub = auth.onAuthStateChanged(function (user) {
        unsub();
        resolve(user || null);
      });
    });
  }

  function idToken() {
    var user = firebase.auth().currentUser;
    if (!user || !walletOf(user.uid)) return Promise.resolve('');
    return user.getIdToken();
  }

  function signInForChat(wallet) {
    var want = walletOf(wallet);
    var auth = firebase.auth();
    return currentUserReady().then(function (existing) {
      if (existing && want && String(existing.uid).toLowerCase() === want) {
        start(want);
        return existing;
      }
      var message = '';
      var signature = '';
      try {
        message = sessionStorage.getItem('muzz_login_msg') || '';
        signature = sessionStorage.getItem('muzz_login_sig') || '';
      } catch (err) { /* private mode */ }
      if (!want || !message || !signature) return auth.signInAnonymously().then(function (cred) { return cred.user; });
      return fetch(apiBase() + '/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, signature: signature })
      }).then(function (res) {
        if (!res.ok) return null;
        return res.json();
      }).then(function (data) {
        if (data && data.customToken) return auth.signInWithCustomToken(data.customToken);
        return null;
      }).then(function (cred) {
        if (cred && cred.user) {
          start(want);
          return cred.user;
        }
        return auth.signInAnonymously().then(function (anon) { return anon.user; });
      }).catch(function () {
        return auth.signInAnonymously().then(function (anon) { return anon.user; });
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
    bindTest();
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

  function bindTest() {
    var btn = global.document && document.getElementById('muzzPushTest');
    if (!btn || btn.getAttribute('data-react') === '1' || btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');
    btn.addEventListener('click', function () {
      notifySelf().then(function (ok) {
        var note = document.getElementById('muzzPushTestResult');
        if (!note) return;
        note.hidden = false;
        note.textContent = ok ? 'Test notification sent.' : "Couldn't send the test notification.";
      });
    });
  }

  global.addEventListener('muzz-fcm-token', function () {
    applyNativePermission();
    if (global.__muzzNativeFcmToken) rememberToken(global.__muzzNativeFcmToken, 'android');
    else paintStatus();
  });

  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTest);
    else bindTest();
  }

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
