/**
 * MuzzSnap web root: one session contract for chat.html, private.html, Chatpublic.html and social.html.
 *
 * Contract (Login & Security, login.html 99bb553): login.html signs in to Firebase with the server's
 * custom token (uid = lowercase wallet, muzzUntil claim). Pages trust ONLY firebase.auth().currentUser.uid.
 * muzz_wallet_address / muzz_login_method are display hints written by login.html: never read here to
 * decide identity or rights. Rights are enforced by the RTDB rules (auth.uid), never by this file.
 */
(function (global) {
  'use strict';

  var WALLET_UID = /^0x[a-f0-9]{40}$/;
  var APP_API = 'https://muzzsnap-app.vercel.app/api/';

  var FIREBASE_CONFIG = {
    apiKey: atob('QUl6YVN5QWUxLUpmTmRlME5LSU1kRTdwaGZFWGxtOUphcVVIMGpZ'),
    authDomain: atob('cHVsc2FyaS5maXJlYmFzZWFwcC5jb20='),
    databaseURL: atob('aHR0cHM6Ly9wdWxzYXJpLWRlZmF1bHQtcnRkYi5maXJlYmFzZWlvLmNvbQ=='),
    projectId: atob('cHVsc2FyaQ=='),
    storageBucket: atob('cHVsc2FyaS5maXJlYmFzZXN0b3JhZ2UuYXBw'),
    messagingSenderId: atob('ODI0MzA2MzIxMjMz'),
    appId: atob('MTo4MjQzMDYzMjEyMzM6d2ViOjJjOWJmYTAyMTcwYTE3ZDU2MGI1NzA=')
  };

  /* The four admin wallets, same list as MuzzSnap app/www/js/muzz-names.js (MuzzNames.ADMINS) and the
     RTDB rules. DISPLAY ONLY: decides which buttons are shown. */
  var ADMINS = Object.freeze([
    Object.freeze({ wallet: '0x208157b5ec396759e8754058108ecf53e32392ff', name: 'RYASHU', role: 'ryachu' }),
    Object.freeze({ wallet: '0x3e1c5e792fc73e8a2b72df4b0a8a8a462b2ce501', name: 'ITZUKI', role: 'itsuki' }),
    Object.freeze({ wallet: '0x875c5a7794b601f273da58e3c1d10671d16130ec', name: 'Esteban', role: 'esteban' }),
    Object.freeze({ wallet: '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a', name: 'Node_6bcb8a', role: 'admin' })
  ]);
  var ADMIN_ROLES = ADMINS.map(function (a) { return a.role; });

  var NOTICE = {
    banned: 'This wallet is banned from MuzzSnap.',
    balance: 'Your wallet no longer holds the 10,000,000 MUZZ minimum. Sign in again when it does.',
    session: 'Your session ended. Sign in again.'
  };

  var REFRESH_MS = 10 * 60 * 1000;
  var RETRY_MS = [5000, 15000, 45000, 120000, 300000];

  function adminOf(wallet) {
    var w = String(wallet || '').trim().toLowerCase();
    for (var i = 0; i < ADMINS.length; i += 1) if (ADMINS[i].wallet === w) return ADMINS[i];
    return null;
  }

  /** Exact username/role pair the RTDB rules expect for this wallet uid. */
  function identityFor(uid) {
    var admin = adminOf(uid);
    if (admin) return { username: admin.name, role: admin.role };
    return { username: 'Node_' + String(uid).slice(-4), role: 'user' };
  }

  function isAdminRole(role) { return ADMIN_ROLES.indexOf(role) >= 0; }

  function init() {
    if (!global.firebase.apps.length) global.firebase.initializeApp(FIREBASE_CONFIG);
    return global.firebase;
  }

  function clearHints() {
    ['muzz_wallet_address', 'muzz_login_method'].forEach(function (key) {
      try { global.sessionStorage.removeItem(key); } catch (e) { /* storage off */ }
      try { global.localStorage.removeItem(key); } catch (e) { /* storage off */ }
    });
  }

  function toLogin(reason) {
    global.location.replace('login.html' + (reason ? '?reason=' + encodeURIComponent(reason) : ''));
  }

  var ending = false;
  /** Sign out, drop the display hints and go to login with a clear notice. reason: banned|balance|session. */
  function endSession(reason) {
    if (ending) return Promise.resolve();
    ending = true;
    var why = NOTICE[reason] ? reason : 'session';
    clearHints();
    return Promise.resolve()
      .then(function () { return global.firebase.auth().signOut(); })
      .catch(function () { /* already signed out */ })
      .then(function () {
        try { global.alert(NOTICE[why]); } catch (e) { /* no dialogs */ }
        toLogin(why);
      });
  }

  /** User-initiated disconnect: same as endSession, without a notice. */
  function disconnect() {
    clearHints();
    return Promise.resolve()
      .then(function () { return global.firebase.auth().signOut(); })
      .catch(function () { /* already signed out */ })
      .then(function () { global.location.href = 'login.html'; });
  }

  /**
   * Waits for the Firebase session created by login.html. No user, or a uid that is not a wallet:
   * back to login. onReady(user) runs once per page; a refreshed token with the same uid does not
   * restart the page, a different uid reloads it.
   */
  function gate(onReady) {
    init();
    var started = null;
    return global.firebase.auth().onAuthStateChanged(function (user) {
      var uid = user ? String(user.uid || '') : '';
      if (!user || !WALLET_UID.test(uid)) { if (!ending) toLogin(''); return; }
      if (started === uid) return;
      if (started && started !== uid) { global.location.reload(); return; }
      started = uid;
      onReady(user);
    }, function () { toLogin(''); });
  }

  /**
   * GET /api/session?op=me with the Firebase ID token (same-origin proxy to muzzsnap-app).
   * 200 + customToken -> signInWithCustomToken. 401 / 403 -> endSession (banned / balance / session).
   * Network errors and 5xx keep the session and are retried with backoff.
   * Resolves 'ok' | 'ended' | 'retry'.
   */
  function checkSession() {
    var user = global.firebase.auth().currentUser;
    if (!user) return Promise.resolve('ok');
    return user.getIdToken().then(function (idToken) {
      return global.fetch('/api/session?op=me', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + idToken },
        credentials: 'same-origin',
        cache: 'no-store'
      });
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (res.status === 401 || res.status === 403) {
          var code = body && body.error;
          return endSession(code === 'banned' || code === 'balance' ? code : 'session').then(function () { return 'ended'; });
        }
        if (!res.ok) return 'retry';
        if (body && typeof body.customToken === 'string' && body.customToken) {
          return global.firebase.auth().signInWithCustomToken(body.customToken).then(function () { return 'ok'; }, function () { return 'retry'; });
        }
        return 'ok';
      });
    }, function () { return 'retry'; });
  }

  var timer = null;
  var running = false;
  var attempt = 0;
  /** Checks now, then every 10 min; failures retry at 5 s, 15 s, 45 s, 2 min, 5 min, then the normal pace. */
  function startRefresh() {
    function run() {
      timer = null;
      checkSession().then(function (result) {
        if (result === 'ended') { running = false; return; }
        var wait = REFRESH_MS;
        if (result === 'retry') { wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]; attempt += 1; }
        else attempt = 0;
        if (running) timer = global.setTimeout(run, wait);
      });
    }
    if (!running) { running = true; run(); }
    return function stop() { running = false; if (timer) global.clearTimeout(timer); timer = null; };
  }

  /**
   * The MuzzSnap app's private client (js/private-e2ee.js, kept byte-identical) calls
   * https://muzzsnap-app.vercel.app/api/private directly. On this site those calls go through the
   * same-origin rewrite /api/private (vercel.json), like /api/session. js/translate.js (also byte-identical)
   * calls .../api/translate the same way and goes through the /api/translate rewrite.
   */
  function proxyAppApi() {
    if (global.__muzzApiProxy) return;
    global.__muzzApiProxy = true;
    var original = global.fetch.bind(global);
    global.fetch = function (input, init) {
      if (typeof input === 'string' && (input.indexOf(APP_API + 'private') === 0 || input.indexOf(APP_API + 'translate') === 0)) input = '/api/' + input.slice(APP_API.length);
      return original(input, init);
    };
  }

  global.MuzzSession = Object.freeze({
    WALLET_UID: WALLET_UID,
    ADMINS: ADMINS,
    ADMIN_ROLES: ADMIN_ROLES,
    NOTICE: NOTICE,
    RETRY_MS: RETRY_MS,
    REFRESH_MS: REFRESH_MS,
    adminOf: adminOf,
    identityFor: identityFor,
    isAdminRole: isAdminRole,
    init: init,
    gate: gate,
    checkSession: checkSession,
    startRefresh: startRefresh,
    endSession: endSession,
    disconnect: disconnect,
    proxyAppApi: proxyAppApi
  });
})(window);
