/**
 * Private photos move phone to phone.
 * When both wallets are online, the ciphertext goes over a WebRTC data channel.
 * Otherwise it waits in the encrypted mailbox until the other phone connects,
 * then that phone saves it and the server deletes it.
 */
(function (global) {
  var DB_NAME = 'muzzsnap-photos';
  var STORE = 'inbox';
  var STUN = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
  var DIRECT_MS = 4500;
  var CHUNK = 12000;
  var draining = null;
  var started = false;
  var memory = new Map();

  function walletOf(value) {
    var wallet = String(value || '').toLowerCase();
    return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : '';
  }

  function openDb() {
    if (!global.indexedDB) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
  }

  function remember(row) {
    if (!row || !row.id || !row.ct) return Promise.resolve(null);
    if (!row.savedAt) row.savedAt = Date.now();
    memory.set(row.id, row);
    return openDb().then(function (db) {
      if (!db) return row;
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(row);
        tx.oncomplete = function () { resolve(row); };
        tx.onerror = function () { resolve(row); };
      });
    });
  }

  function readLocal(id) {
    if (!id) return Promise.resolve(null);
    if (memory.has(id)) return Promise.resolve(memory.get(id));
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(id);
        req.onsuccess = function () {
          if (req.result) memory.set(id, req.result);
          resolve(req.result || null);
        };
        req.onerror = function () { resolve(null); };
      });
    });
  }

  function listLocal() {
    return openDb().then(function (db) {
      if (!db) return Array.from(memory.values());
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          var rows = req.result || [];
          var byId = new Map();
          rows.forEach(function (row) {
            if (!row || !row.id) return;
            byId.set(row.id, row);
            memory.set(row.id, row);
          });
          memory.forEach(function (row, id) {
            if (!byId.has(id)) byId.set(id, row);
          });
          resolve(Array.from(byId.values()));
        };
        req.onerror = function () { resolve(Array.from(memory.values())); };
      });
    });
  }

  function bytesFromB64(text) {
    var bin = atob(String(text || ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function b64FromBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function sendChunks(dc, bytes) {
    var offset = 0;
    return new Promise(function (resolve) {
      function pump() {
        while (offset < bytes.length) {
          if (dc.bufferedAmount > 65536) {
            dc.bufferedAmountLowThreshold = 16384;
            dc.onbufferedamountlow = function () {
              dc.onbufferedamountlow = null;
              pump();
            };
            return;
          }
          var end = Math.min(bytes.length, offset + CHUNK);
          dc.send(bytes.subarray(offset, end));
          offset = end;
        }
        resolve();
      }
      pump();
    });
  }

  function directSend(db, me, peer, box, timeoutMs) {
    var mine = walletOf(me);
    var other = walletOf(peer);
    if (!db || !mine || !other || typeof RTCPeerConnection !== 'function') {
      return Promise.reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
    }
    return new Promise(function (resolve, reject) {
      var pc = new RTCPeerConnection(STUN);
      var dc = pc.createDataChannel('muzz-photo');
      dc.binaryType = 'arraybuffer';
      var pendingIce = [];
      function addIce(candidate) {
        if (!candidate) return;
        if (!pc.remoteDescription) {
          pendingIce.push(candidate);
          return;
        }
        pc.addIceCandidate(candidate).catch(function () {});
      }
      function flushIce() {
        var queued = pendingIce;
        pendingIce = [];
        queued.forEach(addIce);
      }
      var ref = db.ref('privateSignal/' + other + '/' + mine);
      var done = false;
      var timer = setTimeout(function () { finish(Object.assign(new Error('timeout'), { code: 'timeout' })); }, timeoutMs || DIRECT_MS);
      function finish(err, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ref.remove(); } catch (ignore) { /* already gone */ }
        try { pc.close(); } catch (ignore) { /* already closed */ }
        if (err) reject(err);
        else resolve(value);
      }
      dc.onopen = function () {
        var bytes = bytesFromB64(box.ct);
        dc.send(JSON.stringify({
          v: 1,
          kind: 'photo',
          id: box.id,
          iv: box.iv,
          from: mine,
          to: other,
          fromPub: box.fromPub,
          toPub: box.toPub,
          len: bytes.length
        }));
        sendChunks(dc, bytes).then(function () {
          dc.send(JSON.stringify({ done: 1 }));
        }).catch(function (err) { finish(err); });
      };
      dc.onmessage = function (event) {
        var msg = {};
        try { msg = JSON.parse(event.data); } catch (err) { msg = {}; }
        if (msg && msg.ok) finish(null, { via: 'direct', id: box.id });
      };
      pc.onicecandidate = function (event) {
        if (!event.candidate) return;
        ref.child('ice').push({ from: mine, candidate: event.candidate.toJSON(), at: Date.now() });
      };
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        return ref.child('offer').set({
          from: mine,
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp,
          at: Date.now()
        });
      }).catch(function (err) { finish(err); });
      ref.child('answer').on('value', function (snap) {
        var ans = snap.val();
        if (!ans || !ans.sdp || pc.currentRemoteDescription) return;
        pc.setRemoteDescription({ type: ans.type || 'answer', sdp: ans.sdp }).then(flushIce).catch(function () {});
      });
      ref.child('ice').on('child_added', function (snap) {
        var row = snap.val();
        if (!row || row.from === mine || !row.candidate) return;
        addIce(row.candidate);
      });
    });
  }

  function acceptOffer(node, me, from) {
    var pc = new RTCPeerConnection(STUN);
    var pieces = [];
    var header = null;
    var remoteSet = false;
    var pendingIce = [];
    function addIce(candidate) {
      if (!candidate) return;
      if (!pc.remoteDescription) {
        pendingIce.push(candidate);
        return;
      }
      pc.addIceCandidate(candidate).catch(function () {});
    }
    function flushIce() {
      var queued = pendingIce;
      pendingIce = [];
      queued.forEach(addIce);
    }
    pc.ondatachannel = function (event) {
      var dc = event.channel;
      dc.binaryType = 'arraybuffer';
      dc.onmessage = function (message) {
        if (typeof message.data === 'string') {
          var parsed = {};
          try { parsed = JSON.parse(message.data); } catch (err) { parsed = {}; }
          if (parsed.kind === 'text' && parsed.inner && parsed.inner.id) {
            try {
              global.dispatchEvent(new CustomEvent('muzz-direct-text', { detail: parsed.inner }));
            } catch (err) { /* no window */ }
            try { dc.send(JSON.stringify({ ok: 1, id: parsed.inner.id })); } catch (err) { /* channel closed */ }
            try { node.remove(); } catch (err) { /* the sender also removes it */ }
            try { pc.close(); } catch (err) { /* already closed */ }
            return;
          }
          if (parsed.kind === 'photo') header = parsed;
          if (parsed.done && header) {
            var total = 0;
            pieces.forEach(function (part) { total += part.length; });
            var joined = new Uint8Array(total);
            var offset = 0;
            pieces.forEach(function (part) {
              joined.set(part, offset);
              offset += part.length;
            });
            if (joined.length !== header.len) return;
            remember({
              id: header.id,
              from: header.from,
              to: me,
              iv: header.iv,
              ct: b64FromBytes(joined),
              fromPub: header.fromPub,
              toPub: header.toPub
            }).then(function () {
              dc.send(JSON.stringify({ ok: 1 }));
              try { node.remove(); } catch (err) { /* the sender also removes it */ }
              try { pc.close(); } catch (err) { /* already closed */ }
              try { global.dispatchEvent(new CustomEvent('muzz-photo-sync')); } catch (err) { /* no window */ }
            });
          }
          return;
        }
        pieces.push(new Uint8Array(message.data));
      };
    };
    pc.onicecandidate = function (event) {
      if (!event.candidate) return;
      node.child('ice').push({ from: me, candidate: event.candidate.toJSON(), at: Date.now() });
    };
    node.child('offer').on('value', function (snap) {
      var offer = snap.val();
      if (!offer || !offer.sdp || remoteSet) return;
      remoteSet = true;
      pc.setRemoteDescription({ type: offer.type || 'offer', sdp: offer.sdp }).then(function () {
        flushIce();
        return pc.createAnswer();
      }).then(function (answer) {
        return pc.setLocalDescription(answer);
      }).then(function () {
        return node.child('answer').set({
          from: me,
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp,
          at: Date.now()
        });
      }).catch(function (err) { console.error(err); });
    });
    node.child('ice').on('child_added', function (snap) {
      var row = snap.val();
      if (!row || row.from === me || !row.candidate) return;
      addIce(row.candidate);
    });
    if (from) node.child('offer').once('value', function () {});
  }

  function watchSignal(db, me) {
    var seen = {};
    db.ref('privateSignal/' + me).on('child_added', function (snap) {
      if (!snap.key || seen[snap.key]) return;
      seen[snap.key] = true;
      acceptOffer(snap.ref, me, snap.key);
    });
  }

  function drain() {
    if (!global.MuzzE2EE || typeof global.MuzzE2EE.pendingPhotos !== 'function') return Promise.resolve([]);
    if (draining) return draining;
    draining = global.MuzzE2EE.pendingPhotos().then(function (items) {
      var saved = [];
      var chain = Promise.resolve();
      (items || []).forEach(function (item) {
        chain = chain.then(function () {
          return readLocal(item.id).then(function (existing) {
            if (existing && existing.ct) {
              return global.MuzzE2EE.ackPhoto(item.id).then(function () { saved.push(item.id); });
            }
            return global.MuzzE2EE.openPhoto('', item.from, {
              id: item.id,
              iv: item.iv,
              fromPub: item.fromPub,
              toPub: item.toPub,
              kind: 'photo'
            }).then(function () { saved.push(item.id); }).catch(function (err) { console.error(err); });
          });
        });
      });
      return chain.then(function () { return saved; });
    }).catch(function (err) {
      console.error(err);
      return [];
    }).finally(function () { draining = null; });
    return draining;
  }

  function directSendJson(db, me, peer, inner, timeoutMs) {
    var mine = walletOf(me);
    var other = walletOf(peer);
    if (!db || !mine || !other || !inner || typeof RTCPeerConnection !== 'function') {
      return Promise.reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
    }
    return new Promise(function (resolve, reject) {
      var pc = new RTCPeerConnection(STUN);
      var dc = pc.createDataChannel('muzz-text');
      var pendingIce = [];
      function addIce(candidate) {
        if (!candidate) return;
        if (!pc.remoteDescription) {
          pendingIce.push(candidate);
          return;
        }
        pc.addIceCandidate(candidate).catch(function () {});
      }
      function flushIce() {
        var queued = pendingIce;
        pendingIce = [];
        queued.forEach(addIce);
      }
      var ref = db.ref('privateSignal/' + other + '/' + mine);
      var done = false;
      var timer = setTimeout(function () {
        finish(Object.assign(new Error('timeout'), { code: 'timeout' }));
      }, timeoutMs || DIRECT_MS);
      function finish(err, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ref.remove(); } catch (ignore) { /* already gone */ }
        try { pc.close(); } catch (ignore) { /* already closed */ }
        if (err) reject(err);
        else resolve(value);
      }
      dc.onopen = function () {
        try {
          dc.send(JSON.stringify({ v: 2, kind: 'text', inner: inner }));
        } catch (err) {
          finish(err);
        }
      };
      dc.onmessage = function (event) {
        var msg = {};
        try { msg = JSON.parse(event.data); } catch (err) { msg = {}; }
        if (msg && msg.ok) finish(null, { via: 'direct', id: inner.id });
      };
      pc.onicecandidate = function (event) {
        if (!event.candidate) return;
        ref.child('ice').push({ from: mine, candidate: event.candidate.toJSON(), at: Date.now() });
      };
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        return ref.child('offer').set({
          from: mine,
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp,
          at: Date.now()
        });
      }).catch(function (err) { finish(err); });
      ref.child('answer').on('value', function (snap) {
        var ans = snap.val();
        if (!ans || !ans.sdp || pc.currentRemoteDescription) return;
        pc.setRemoteDescription({ type: ans.type || 'answer', sdp: ans.sdp }).then(flushIce).catch(function () {});
      });
      ref.child('ice').on('child_added', function (snap) {
        var row = snap.val();
        if (!row || row.from === mine || !row.candidate) return;
        addIce(row.candidate);
      });
    });
  }

  function send(opts) {
    var options = opts || {};
    var e2ee = global.MuzzE2EE;
    if (!e2ee || typeof e2ee.sealMessage !== 'function' || typeof e2ee.claimPrekey !== 'function') {
      return Promise.reject(new Error('missing'));
    }
    var sentAt = Date.now();
    return e2ee.claimPrekey(options.peer).then(function (prekey) {
      var seq = typeof e2ee.nextSeq === 'function' ? e2ee.nextSeq(options.me, options.peer) : 1;
      return e2ee.sealMessage(options.me, options.peer, options.bytes, {
        prekey: prekey,
        seq: seq,
        sentAt: sentAt,
        kind: 'photo'
      });
    }).then(function (inner) {
      function relay() {
        return e2ee.relay(inner).then(function () {
          return { v: 2, kind: 'photo', id: inner.id, via: 'relay', inner: inner };
        });
      }
      if (!options.online || typeof global.MuzzTransfer.directSendJson !== 'function') return relay();
      return remember({
        id: inner.id,
        from: inner.from,
        to: inner.to,
        ct: inner.ct,
        iv: inner.iv,
        fromPub: inner.fromPub,
        toPub: inner.ephPub
      }).then(function () {
        return global.MuzzTransfer.directSendJson(options.db, options.me, options.peer, inner, options.timeoutMs || 2500);
      }).then(function () {
        return { v: 2, kind: 'photo', id: inner.id, via: 'direct', inner: inner };
      }).catch(function () { return relay(); });
    });
  }

  function start(opts) {
    var options = opts || {};
    function kick() { drain(); }
    kick();
    if (started) return;
    started = true;
    if (global.document) {
      document.addEventListener('visibilitychange', kick);
    }
    global.addEventListener('pageshow', kick);
    global.addEventListener('focus', kick);
    global.addEventListener('muzz-photo-sync', kick);
    if (global.navigator && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'muzz-photo-sync') kick();
      });
    }
    try {
      var Cap = global.Capacitor;
      if (Cap && typeof Cap.registerPlugin === 'function') {
        Cap.registerPlugin('App').addListener('resume', function () {
          global.dispatchEvent(new CustomEvent('muzz-photo-sync'));
        });
      }
    } catch (err) { /* browser */ }
    var me = walletOf(options.me);
    if (options.db && me) {
      options.db.ref('photoMailbox/' + me).on('child_added', kick);
      watchSignal(options.db, me);
    }
  }

  global.MuzzTransfer = {
    remember: remember,
    readLocal: readLocal,
    listLocal: listLocal,
    directSend: directSend,
    directSendJson: directSendJson,
    drain: drain,
    send: send,
    start: start,
    watchSignal: watchSignal
  };
})(typeof window !== 'undefined' ? window : globalThis);
