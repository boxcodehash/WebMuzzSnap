/**
 * MuzzSnap notifications
 * Path: social/notifications/{toUserKey}/{id}
 * types: follow | like | reply | repost
 */
(function (global) {
  'use strict';

  function safeKey(v) {
    return String(v || '').replace(/[.#$/\[\]]/g, '_').toLowerCase();
  }

  function db() {
    if (typeof firebase === 'undefined' || !firebase.apps.length) return null;
    return firebase.database();
  }

  async function ensureAuth() {
    if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
  }

  /**
   * @param {object} n
   * @param {string} n.toWallet
   * @param {string} n.fromWallet
   * @param {string} n.fromName
   * @param {string} n.type  follow|like|reply|repost
   * @param {string} [n.postId]
   * @param {string} [n.preview]
   */
  async function push(n) {
    var database = db();
    if (!database || !n || !n.toWallet || !n.fromWallet) return null;
    var to = safeKey(n.toWallet);
    var from = safeKey(n.fromWallet);
    if (!to || !from || to === from) return null; // no self-notify
    await ensureAuth();
    var ref = database.ref('social/notifications/' + to).push();
    var payload = {
      id: ref.key,
      type: n.type || 'info',
      fromWallet: String(n.fromWallet).toLowerCase(),
      fromName: n.fromName || String(n.fromWallet).slice(-6),
      toWallet: String(n.toWallet).toLowerCase(),
      postId: n.postId || null,
      preview: n.preview ? String(n.preview).slice(0, 120) : null,
      read: false,
      at: firebase.database.ServerValue.TIMESTAMP,
      atClient: Date.now()
    };
    await ref.set(payload);
    return payload;
  }

  function watch(myWallet, cb) {
    var database = db();
    if (!database || !myWallet) {
      cb([]);
      return function () {};
    }
    var ref = database.ref('social/notifications/' + safeKey(myWallet)).limitToLast(50);
    var handler = function (snap) {
      var val = snap.val() || {};
      var list = Object.keys(val).map(function (k) {
        return Object.assign({ id: k }, val[k]);
      });
      list.sort(function (a, b) {
        return (b.atClient || b.at || 0) - (a.atClient || a.at || 0);
      });
      cb(list);
    };
    ref.on('value', handler);
    return function () { ref.off('value', handler); };
  }

  async function markRead(myWallet, notifId) {
    var database = db();
    if (!database || !myWallet || !notifId) return;
    await database.ref('social/notifications/' + safeKey(myWallet) + '/' + notifId + '/read').set(true);
  }

  async function markAllRead(myWallet) {
    var database = db();
    if (!database || !myWallet) return;
    var snap = await database.ref('social/notifications/' + safeKey(myWallet)).once('value');
    var val = snap.val() || {};
    var updates = {};
    Object.keys(val).forEach(function (k) {
      if (!val[k].read) updates[k + '/read'] = true;
    });
    if (Object.keys(updates).length) {
      await database.ref('social/notifications/' + safeKey(myWallet)).update(updates);
    }
  }

  function label(n) {
    var who = n.fromName || 'Someone';
    if (n.type === 'follow') return who + ' started following you';
    if (n.type === 'like') return who + ' liked your post';
    if (n.type === 'reply') return who + ' replied to your post';
    if (n.type === 'repost') return who + ' reposted your post';
    return who + ' interacted';
  }

  global.MuzzNotify = {
    push: push,
    watch: watch,
    markRead: markRead,
    markAllRead: markAllRead,
    label: label,
    safeKey: safeKey
  };
})(window);
