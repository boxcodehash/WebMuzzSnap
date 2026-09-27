/**
 * Closed-app private alerts.
 * The page asks https://muzzsnap-app.vercel.app/api/notify after a private
 * message is saved. The notification text is always "New private message".
 * Message text is never sent to that API.
 */
(function (global) {
  var PUBLIC_API = 'https://muzzsnap-app.vercel.app';
  var me = '';
  var arming = false;
  var armed = false;
  var listening = false;

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
        if (res.ok) global.__muzzFcmReady = true;
        return res.ok;
      });
    }).catch(function () { return false; });
  }

  function pushPlugin() {
    var Cap = global.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return null;
    if (typeof Cap.registerPlugin !== 'function') return null;
    try { return Cap.registerPlugin('PushNotifications'); } catch (err) { return null; }
  }

  function listenAndroid(Push) {
    if (listening || !Push.addListener) return;
    listening = true;
    Push.addListener('registration', function (event) {
      var value = event && event.value;
      if (value) saveToken(value, 'android');
    });
    Push.addListener('registrationError', function () {
      global.__muzzFcmReady = false;
      armed = false;
    });
    Push.addListener('pushNotificationActionPerformed', function (event) {
      var note = event && event.notification;
      var data = note && note.data;
      var peer = data && data.peer;
      if (peer) global.location.href = 'private.html?peer=' + encodeURIComponent(peer);
    });
  }

  function armAndroid() {
    var Push = pushPlugin();
    if (!Push) return Promise.resolve(false);
    listenAndroid(Push);
    return Push.requestPermissions().then(function (perm) {
      if (!perm || perm.receive !== 'granted') return false;
      if (Push.createChannel) {
        return Push.createChannel({
          id: 'private',
          name: 'Private messages',
          description: 'New private messages',
          importance: 5,
          visibility: 1
        }).catch(function () { return null; });
      }
      return null;
    }).then(function (ready) {
      if (ready === false) return false;
      return Push.register();
    }).then(function (registered) {
      if (registered === false) return false;
      armed = true;
      return true;
    }).catch(function () {
      armed = false;
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
    if (!('Notification' in global) || !navigator.serviceWorker) return Promise.resolve(false);
    if (Notification.permission === 'denied') return Promise.resolve(false);
    var permit = Notification.permission === 'granted'
      ? Promise.resolve('granted')
      : Notification.requestPermission();
    return Promise.resolve(permit).then(function (permission) {
      if (permission !== 'granted') return null;
      return fetch(apiBase() + '/api/push-config').then(function (res) { return res.json(); });
    }).then(function (cfg) {
      if (!cfg || !cfg.vapidKey) return false;
      return loadMessaging().then(function () {
        return navigator.serviceWorker.register('sw.js');
      }).then(function (reg) {
        return firebase.messaging().getToken({
          vapidKey: cfg.vapidKey,
          serviceWorkerRegistration: reg
        });
      });
    }).then(function (token) {
      if (!token || token === false) return false;
      return saveToken(token, 'web').then(function (ok) {
        if (ok) armed = true;
        return ok;
      });
    }).catch(function () {
      return false;
    });
  }

  function enable() {
    if (arming || armed) return Promise.resolve(false);
    if (!walletOf(me)) return Promise.resolve(false);
    arming = true;
    var task = pushPlugin() ? armAndroid() : armWeb();
    return task.then(function (ok) {
      arming = false;
      return ok;
    }, function () {
      arming = false;
      return false;
    });
  }

  function start(wallet) {
    var next = walletOf(wallet);
    if (next) me = next;
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

  global.MuzzPush = {
    signInForChat: signInForChat,
    start: start,
    enable: enable,
    notify: notify
  };
})(typeof window !== 'undefined' ? window : globalThis);
