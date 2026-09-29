/**
 * MuzzSnap follow graph
 * Paths:
 *   social/graph/{me}/following/{them}
 *   social/graph/{them}/followers/{me}
 */
(function (global) {
  'use strict';

  function safeKey(v) {
    return String(v || '').replace(/[.#$/\[\]]/g, '_').toLowerCase();
  }

  function dbRef() {
    if (typeof firebase === 'undefined' || !firebase.apps.length) return null;
    return firebase.database();
  }

  async function ensureAuth() {
    if (!firebase.auth().currentUser) {
      await firebase.auth().signInAnonymously();
    }
  }

  async function isFollowing(myWallet, targetWallet) {
    var db = dbRef();
    if (!db || !myWallet || !targetWallet) return false;
    if (safeKey(myWallet) === safeKey(targetWallet)) return false;
    try {
      var snap = await db.ref('social/graph/' + safeKey(myWallet) + '/following/' + safeKey(targetWallet)).once('value');
      return snap.exists();
    } catch (e) {
      console.warn('isFollowing', e);
      return false;
    }
  }

  async function getCounts(wallet) {
    var db = dbRef();
    var empty = { following: 0, followers: 0 };
    if (!db || !wallet) return empty;
    var uk = safeKey(wallet);
    try {
      var [a, b] = await Promise.all([
        db.ref('social/graph/' + uk + '/following').once('value'),
        db.ref('social/graph/' + uk + '/followers').once('value')
      ]);
      return {
        following: a.exists() ? Object.keys(a.val() || {}).length : 0,
        followers: b.exists() ? Object.keys(b.val() || {}).length : 0
      };
    } catch (e) {
      console.warn('getCounts', e);
      return empty;
    }
  }

  async function listFollowing(myWallet) {
    var db = dbRef();
    if (!db || !myWallet) return [];
    try {
      var snap = await db.ref('social/graph/' + safeKey(myWallet) + '/following').once('value');
      var val = snap.val() || {};
      return Object.keys(val).map(function (k) {
        return Object.assign({ key: k }, val[k] || {});
      });
    } catch (e) {
      return [];
    }
  }

  async function follow(myWallet, targetWallet, meta) {
    var db = dbRef();
    if (!db) throw new Error('Firebase no listo');
    await ensureAuth();
    var me = safeKey(myWallet);
    var them = safeKey(targetWallet);
    if (!me || !them || me === them) throw new Error('Invalid follow');
    meta = meta || {};
    var payload = {
      wallet: String(targetWallet).toLowerCase(),
      displayName: meta.displayName || '',
      at: firebase.database.ServerValue.TIMESTAMP
    };
    var back = {
      wallet: String(myWallet).toLowerCase(),
      displayName: meta.myDisplayName || '',
      at: firebase.database.ServerValue.TIMESTAMP
    };
    await Promise.all([
      db.ref('social/graph/' + me + '/following/' + them).set(payload),
      db.ref('social/graph/' + them + '/followers/' + me).set(back)
    ]);
  }

  async function unfollow(myWallet, targetWallet) {
    var db = dbRef();
    if (!db) throw new Error('Firebase no listo');
    await ensureAuth();
    var me = safeKey(myWallet);
    var them = safeKey(targetWallet);
    await Promise.all([
      db.ref('social/graph/' + me + '/following/' + them).remove(),
      db.ref('social/graph/' + them + '/followers/' + me).remove()
    ]);
  }

  /** Escucha following set del usuario (para filtrar feed) */
  function watchFollowing(myWallet, cb) {
    var db = dbRef();
    if (!db || !myWallet) {
      cb([]);
      return function () {};
    }
    var ref = db.ref('social/graph/' + safeKey(myWallet) + '/following');
    var handler = function (snap) {
      var val = snap.val() || {};
      var wallets = Object.keys(val).map(function (k) {
        return (val[k] && val[k].wallet) || k;
      }).map(function (w) { return String(w).toLowerCase(); });
      cb(wallets);
    };
    ref.on('value', handler);
    return function () { ref.off('value', handler); };
  }

  global.MuzzFollow = {
    safeKey: safeKey,
    isFollowing: isFollowing,
    getCounts: getCounts,
    listFollowing: listFollowing,
    follow: follow,
    unfollow: unfollow,
    watchFollowing: watchFollowing
  };
})(window);
