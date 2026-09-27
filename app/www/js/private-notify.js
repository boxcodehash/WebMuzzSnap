/**
 * In-app toast, sound, unread badge, and a device notification for new
 * private messages. Plaintext is shown only when the message is not sealed.
 */
(function (global) {
  var started = false;
  var watched = {};
  var unread = {};
  var startedAt = 0;

  function previewOf(msg) {
    if (!msg || msg.ciphertext || msg.sealed || msg.e2ee || msg.encrypted) return 'New private message';
    var raw = msg.text != null ? msg.text : msg.content;
    if (raw && typeof raw === 'object') return 'New private message';
    var text = String(raw || '').trim();
    if (!text) return 'New private message';
    if (/^[A-Za-z0-9+/=_-]{48,}$/.test(text)) return 'New private message';
    return text.length > 80 ? text.slice(0, 77) + '…' : text;
  }

  function ensureUi() {
    if (document.getElementById('muzzPmToast')) return;
    var style = document.createElement('style');
    style.textContent = ''
      + '.muzz-pm-toast{position:fixed;z-index:80;left:12px;right:12px;top:calc(12px + env(safe-area-inset-top,0px));'
      + 'display:flex;gap:8px;align-items:stretch;max-width:420px;margin:0 auto;'
      + 'background:#14181e;color:#f4f7fb;border:1px solid rgba(255,42,42,.45);border-radius:16px;'
      + 'box-shadow:0 12px 32px rgba(0,0,0,.35);padding:10px 10px 10px 14px}'
      + '.muzz-pm-toast button.open{flex:1;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;padding:0}'
      + '.muzz-pm-toast strong{display:block;font-size:13px;letter-spacing:.04em}'
      + '.muzz-pm-toast span{display:block;font-size:12px;color:#c5ced8;margin-top:2px}'
      + '.muzz-pm-toast button.x{border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer;padding:0 6px}';
    document.head.appendChild(style);
    var box = document.createElement('div');
    box.id = 'muzzPmToast';
    box.className = 'muzz-pm-toast';
    box.hidden = true;
    box.innerHTML = '<button type="button" class="open"><strong id="muzzPmName"></strong><span id="muzzPmText"></span></button><button type="button" class="x" aria-label="Dismiss">×</button>';
    document.body.appendChild(box);
    var dismissStamp = 0;
    function dismissToast(event) {
      var now = Date.now();
      if (now - dismissStamp < 450) {
        if (event) event.preventDefault();
        return;
      }
      dismissStamp = now;
      if (event) event.preventDefault();
      box.hidden = true;
    }
    var closeBtn = box.querySelector('.x');
    closeBtn.addEventListener('click', dismissToast);
    closeBtn.addEventListener('touchend', dismissToast, { passive: false });
  }

  function showToast(name, text, peer, open) {
    ensureUi();
    var box = document.getElementById('muzzPmToast');
    document.getElementById('muzzPmName').textContent = name;
    document.getElementById('muzzPmText').textContent = text;
    box.hidden = false;
    box.querySelector('.open').onclick = function () {
      box.hidden = true;
      if (typeof open === 'function') open(peer);
    };
    clearTimeout(box._hide);
    box._hide = setTimeout(function () { box.hidden = true; }, 7000);
  }

  function beep() {
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.14);
      setTimeout(function () { ctx.close(); }, 400);
    } catch (err) { /* autoplay can block audio until a tap */ }
  }

  function totalUnread() {
    return Object.keys(unread).reduce(function (sum, key) { return sum + unread[key]; }, 0);
  }

  function emitUnread() {
    global.dispatchEvent(new CustomEvent('muzz-unread', { detail: { unread: unread, total: totalUnread() } }));
  }

  var channelReady = false;

  async function ensureChannel(LocalNotifications) {
    if (channelReady || !LocalNotifications.createChannel) return;
    await LocalNotifications.createChannel({
      id: 'private',
      name: 'Private messages',
      description: 'New private messages',
      importance: 5,
      visibility: 1
    });
    channelReady = true;
  }

  function nativeNotifications() {
    var Cap = global.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return null;
    if (typeof Cap.registerPlugin !== 'function') return null;
    try { return Cap.registerPlugin('LocalNotifications'); } catch (err) { return null; }
  }

  async function deviceNotify(title, body, peer) {
    if (global.__muzzFcmReady) return;
    var LocalNotifications = nativeNotifications();
    if (LocalNotifications) {
      try {
        var perm = await LocalNotifications.checkPermissions();
        if (!perm || perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
        if (perm && perm.display === 'granted') {
          await ensureChannel(LocalNotifications);
          await LocalNotifications.schedule({
            notifications: [{
              id: Math.floor(Date.now() % 2147483647),
              title: title,
              body: body,
              channelId: 'private',
              extra: { peer: peer }
            }]
          });
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      var reg = global.navigator.serviceWorker && await global.navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, { body: body, tag: 'pm-' + peer, data: { peer: peer } });
        return;
      }
      new Notification(title, { body: body, tag: 'pm-' + peer });
    } catch (err) { /* permission or a closed document */ }
  }

  function requestPermission() {
    if (global.MuzzPush && MuzzPush.enable) MuzzPush.enable();
    var LocalNotifications = nativeNotifications();
    if (LocalNotifications) {
      LocalNotifications.requestPermissions().then(function (perm) {
        if (perm && perm.display === 'granted') return ensureChannel(LocalNotifications);
        return null;
      }).catch(function () {});
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function start(opts) {
    if (started) return;
    var me = String((opts && opts.me) || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(me) || !opts || !opts.db) return;
    started = true;
    startedAt = Date.now();
    ensureUi();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
      navigator.serviceWorker.addEventListener('message', function (event) {
        var data = event.data || {};
        if (data.type === 'muzz-open-peer' && data.peer && typeof opts.open === 'function') opts.open(data.peer);
      });
    }
    var LocalNotifications = nativeNotifications();
    if (LocalNotifications && LocalNotifications.addListener) {
      LocalNotifications.addListener('localNotificationActionPerformed', function (event) {
        var extra = event && event.notification && event.notification.extra;
        var peer = extra && extra.peer;
        if (peer && typeof opts.open === 'function') opts.open(peer);
      });
    }
    requestPermission();

    function nameOf(peer) {
      if (opts.nameOf) return opts.nameOf(peer);
      if (global.MuzzNames) return global.MuzzNames.displayName(peer);
      return 'Node_' + String(peer).slice(-4);
    }

    function arm(peer) {
      var other = String(peer || '').toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(other) || other === me || watched[other]) return;
      watched[other] = true;
      var thread = [me, other].sort().join('_');
      opts.db.ref('privateInbox/' + thread + '/messages').limitToLast(1).on('child_added', function (snap) {
        var msg = snap.val() || {};
        var ts = Number(msg.timestamp || 0);
        if (!ts || ts < startedAt - 1500) return;
        var from = String(msg.from || '').toLowerCase();
        if (!from || from === me) return;
        var viewing = String((opts.viewing && opts.viewing()) || '').toLowerCase();
        if (viewing === from) return;
        unread[from] = (unread[from] || 0) + 1;
        emitUnread();
        var body = previewOf(msg);
        var name = nameOf(from);
        showToast(name, body, from, opts.open);
        beep();
        deviceNotify(name, body, from);
      });
    }

    opts.db.ref('privateIndex/' + me).on('value', function (snap) {
      var val = snap.val() || {};
      Object.keys(val).forEach(arm);
    });
  }

  function clear(peer) {
    var key = String(peer || '').toLowerCase();
    if (key && unread[key]) delete unread[key];
    emitUnread();
  }

  function demo(sample) {
    ensureUi();
    showToast(sample.name || 'RYASHU', sample.text || 'New private message', sample.peer || '', sample.open);
  }

  global.MuzzNotify = {
    start: start,
    clear: clear,
    previewOf: previewOf,
    requestPermission: requestPermission,
    demo: demo,
    unreadTotal: totalUnread
  };
})(typeof window !== 'undefined' ? window : globalThis);
