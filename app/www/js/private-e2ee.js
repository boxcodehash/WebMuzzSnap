/**
 * Private text and photos use three keys. None of them is enough on its own.
 *
 * 1. Sender: a fresh P-256 ephemeral key and a random AES-256-GCM content key per message.
 * 2. Receiver: a one-time prekey. The wrap key is HKDF(sender ephemeral × receiver prekey,
 *    plus sender identity × that same prekey). The prekey private key is deleted after open.
 * 3. Server: PRIVATE_SERVER_KEY on Vercel wraps the already encrypted envelope for storage.
 *    That key never leaves the server and cannot open the message.
 *
 * Each wallet has its own identity key on this device. The HKDF transcript includes both
 * wallet addresses. The Ethereum private key stays in the wallet.
 */
(function (global) {
  var CURVE = 'P-256';
  var PUBLIC_API = 'https://muzzsnap-app.vercel.app';
  var READ_TTL_MS = 24 * 60 * 60 * 1000;
  var UNREAD_TTL_MS = 24 * 60 * 60 * 1000;
  var CACHE_KEY = 'muzz_e2ee_cache_v2';
  var MSG_DB = 'muzzsnap-private';
  var MSG_STORE = 'messages';

  function bytesToB64(bytes) {
    var bin = '';
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < u8.length; i += 1) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  function b64ToBytes(text) {
    var bin = atob(String(text || ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function apiBase() {
    try {
      if (location.hostname === 'muzzsnap-app.vercel.app') return '';
    } catch (err) { /* capacitor origin */ }
    return PUBLIC_API;
  }

  function walletOf(value) {
    var wallet = String(value || '').toLowerCase();
    return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : '';
  }

  function bearer() {
    try {
      var auth = global.firebase && firebase.auth && firebase.auth();
      var user = auth && auth.currentUser;
      if (!user || !walletOf(user.uid)) return Promise.resolve('');
      return user.getIdToken();
    } catch (err) {
      return Promise.resolve('');
    }
  }

  function post(path, body) {
    return bearer().then(function (token) {
      if (!token) {
        var err = new Error('unauthorized');
        err.code = 'unauthorized';
        throw err;
      }
      return fetch(apiBase() + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify(body || {})
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var error = new Error((data && data.error) || 'request_failed');
            error.code = (data && data.error) || 'request_failed';
            throw error;
          }
          return data || {};
        });
      });
    });
  }

  function storageGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (err) { return ''; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
  }

  function importPub(b64) {
    return crypto.subtle.importKey(
      'spki',
      b64ToBytes(b64),
      { name: 'ECDH', namedCurve: CURVE },
      true,
      []
    );
  }

  function concatBytes(parts) {
    var len = 0;
    parts.forEach(function (part) { len += part.length; });
    var out = new Uint8Array(len);
    var offset = 0;
    parts.forEach(function (part) {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function randomId() {
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    var hex = '';
    for (var i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  function stateKey(wallet) {
    return 'muzz_e2ee_v2:' + walletOf(wallet);
  }

  function readState(wallet) {
    try {
      var raw = storageGet(stateKey(wallet));
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.prekeys || typeof parsed.prekeys !== 'object') parsed.prekeys = {};
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeState(wallet, state) {
    storageSet(stateKey(wallet), JSON.stringify(state));
  }

  function hkdfAes(ikm, salt, info) {
    return crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: salt, info: new TextEncoder().encode(info) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  function wrapSalt(prekeyId, from, to) {
    return concatBytes([
      new TextEncoder().encode(String(prekeyId || '')),
      Uint8Array.of(0),
      new TextEncoder().encode(String(from || '')),
      Uint8Array.of(0),
      new TextEncoder().encode(String(to || ''))
    ]);
  }

  function loadIdentity(wallet) {
    var me = walletOf(wallet);
    if (!me) return Promise.reject(Object.assign(new Error('bad_wallet'), { code: 'bad_wallet' }));
    var state = readState(me) || { identityPriv: '', identityPub: '', prekeys: {} };
    if (state.identityPriv && state.identityPub) {
      return crypto.subtle.importKey(
        'pkcs8',
        b64ToBytes(state.identityPriv),
        { name: 'ECDH', namedCurve: CURVE },
        true,
        ['deriveBits']
      ).then(function (privateKey) {
        return { privateKey: privateKey, pub: state.identityPub, wallet: me };
      });
    }
    return crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: CURVE },
      true,
      ['deriveBits']
    ).then(function (pair) {
      return Promise.all([
        crypto.subtle.exportKey('pkcs8', pair.privateKey),
        crypto.subtle.exportKey('spki', pair.publicKey)
      ]).then(function (exported) {
        state.identityPriv = bytesToB64(new Uint8Array(exported[0]));
        state.identityPub = bytesToB64(new Uint8Array(exported[1]));
        state.prekeys = state.prekeys || {};
        writeState(me, state);
        return { privateKey: pair.privateKey, pub: state.identityPub, wallet: me };
      });
    });
  }

  function ensureBundle(wallet) {
    return loadIdentity(wallet).then(function (ident) {
      var state = readState(ident.wallet) || { identityPriv: '', identityPub: ident.pub, prekeys: {} };
      state.prekeys = state.prekeys || {};
      var fresh = [];
      function fill() {
        if (Object.keys(state.prekeys).length >= 10) return Promise.resolve();
        return crypto.subtle.generateKey(
          { name: 'ECDH', namedCurve: CURVE },
          true,
          ['deriveBits']
        ).then(function (pair) {
          var id = randomId();
          return Promise.all([
            crypto.subtle.exportKey('pkcs8', pair.privateKey),
            crypto.subtle.exportKey('spki', pair.publicKey)
          ]).then(function (exported) {
            var pub = bytesToB64(new Uint8Array(exported[1]));
            state.prekeys[id] = { priv: bytesToB64(new Uint8Array(exported[0])), pub: pub };
            fresh.push({ id: id, pub: pub });
            return fill();
          });
        });
      }
      return fill().then(function () {
        writeState(ident.wallet, state);
        return { pub: ident.pub, prekeys: fresh, wallet: ident.wallet };
      });
    });
  }

  function sealMessage(me, peer, plaintext, opts) {
    var options = opts || {};
    var from = walletOf(me);
    var to = walletOf(peer);
    var prekey = options.prekey || {};
    var prekeyId = String(prekey.id || '').toLowerCase();
    if (!from || !to || !/^[a-f0-9]{32}$/.test(prekeyId) || !prekey.pub) {
      return Promise.reject(Object.assign(new Error('no_peer_key'), { code: 'no_peer_key' }));
    }
    var id = /^[a-f0-9]{32}$/.test(String(options.id || '')) ? String(options.id) : randomId();
    var sentAt = Number(options.sentAt) || Date.now();
    var seq = Number.isInteger(options.seq) ? options.seq : Number(options.seq) || 0;
    var kind = options.kind === 'photo' ? 'photo' : 'text';
    return loadIdentity(from).then(function (ident) {
      return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: CURVE },
        true,
        ['deriveBits']
      ).then(function (eph) {
        return importPub(prekey.pub).then(function (prekeyPub) {
          return Promise.all([
            crypto.subtle.deriveBits({ name: 'ECDH', public: prekeyPub }, eph.privateKey, 256),
            crypto.subtle.deriveBits({ name: 'ECDH', public: prekeyPub }, ident.privateKey, 256),
            crypto.subtle.exportKey('spki', eph.publicKey)
          ]).then(function (derived) {
            var ikm = concatBytes([new Uint8Array(derived[0]), new Uint8Array(derived[1])]);
            var info = 'muzzsnap-wrap-v2\n' + from + '\n' + to + '\n' + id;
            return hkdfAes(ikm, wrapSalt(prekeyId, from, to), info).then(function (wrapKey) {
              var contentKey = crypto.getRandomValues(new Uint8Array(32));
              var keyIv = crypto.getRandomValues(new Uint8Array(12));
              var iv = crypto.getRandomValues(new Uint8Array(12));
              return crypto.subtle.encrypt({ name: 'AES-GCM', iv: keyIv }, wrapKey, contentKey).then(function (wrapped) {
                return crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt']).then(function (aes) {
                  var aad = new TextEncoder().encode('muzzsnap-msg-v2\n' + from + '\n' + to + '\n' + id + '\n' + kind);
                  var plainBytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
                  return crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: iv, additionalData: aad },
                    aes,
                    plainBytes
                  ).then(function (ct) {
                    return {
                      v: 2,
                      kind: kind,
                      id: id,
                      from: from,
                      to: to,
                      seq: seq,
                      sentAt: sentAt,
                      ephPub: bytesToB64(new Uint8Array(derived[2])),
                      fromPub: ident.pub,
                      prekeyId: prekeyId,
                      keyIv: bytesToB64(keyIv),
                      wrappedKey: bytesToB64(new Uint8Array(wrapped)),
                      iv: bytesToB64(iv),
                      ct: bytesToB64(new Uint8Array(ct))
                    };
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  function openMessage(me, inner) {
    if (!inner || inner.v !== 2 || !inner.prekeyId || !inner.to) {
      return Promise.reject(Object.assign(new Error('bad_message'), { code: 'bad_message' }));
    }
    var state = readState(inner.to);
    var slot = state && state.prekeys && state.prekeys[inner.prekeyId];
    if (!slot || !slot.priv) {
      return Promise.reject(Object.assign(new Error('no_prekey'), { code: 'no_prekey' }));
    }
    return crypto.subtle.importKey(
      'pkcs8',
      b64ToBytes(slot.priv),
      { name: 'ECDH', namedCurve: CURVE },
      true,
      ['deriveBits']
    ).then(function (prekeyPriv) {
      return Promise.all([importPub(inner.ephPub), importPub(inner.fromPub)]).then(function (pubs) {
        return Promise.all([
          crypto.subtle.deriveBits({ name: 'ECDH', public: pubs[0] }, prekeyPriv, 256),
          crypto.subtle.deriveBits({ name: 'ECDH', public: pubs[1] }, prekeyPriv, 256)
        ]);
      }).then(function (secrets) {
        var ikm = concatBytes([new Uint8Array(secrets[0]), new Uint8Array(secrets[1])]);
        var info = 'muzzsnap-wrap-v2\n' + inner.from + '\n' + inner.to + '\n' + inner.id;
        return hkdfAes(ikm, wrapSalt(inner.prekeyId, inner.from, inner.to), info);
      }).then(function (wrapKey) {
        return crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64ToBytes(inner.keyIv) },
          wrapKey,
          b64ToBytes(inner.wrappedKey)
        );
      }).then(function (contentRaw) {
        return crypto.subtle.importKey('raw', new Uint8Array(contentRaw), { name: 'AES-GCM' }, false, ['decrypt']);
      }).then(function (aes) {
        var kind = inner.kind || 'text';
        var aad = new TextEncoder().encode('muzzsnap-msg-v2\n' + inner.from + '\n' + inner.to + '\n' + inner.id + '\n' + kind);
        return crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64ToBytes(inner.iv), additionalData: aad },
          aes,
          b64ToBytes(inner.ct)
        ).then(function (plain) {
          delete state.prekeys[inner.prekeyId];
          writeState(inner.to, state);
          var bytes = new Uint8Array(plain);
          if (kind === 'photo') return bytes;
          return new TextDecoder().decode(bytes);
        });
      });
    });
  }

  function isDue(row, now) {
    var clock = Number(now) || Date.now();
    var expireAt = Number(row && row.expireAt) || 0;
    if (expireAt > 0) return expireAt <= clock;
    var readAt = Number(row && row.readAt) || 0;
    var sent = Number(row && (row.timestamp || row.sentAt)) || 0;
    if (readAt > 0) return clock - readAt >= READ_TTL_MS;
    if (sent > 0) return clock - sent >= UNREAD_TTL_MS;
    return false;
  }

  function readCache() {
    try {
      var parsed = JSON.parse(storageGet(CACHE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeCache(rows) {
    storageSet(CACHE_KEY, JSON.stringify(rows));
  }

  function openMsgDb() {
    if (!global.indexedDB) return Promise.resolve(null);
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(MSG_DB, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(MSG_STORE)) db.createObjectStore(MSG_STORE, { keyPath: 'id' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (err) {
        resolve(null);
      }
    });
  }

  function rememberPlain(row) {
    if (!row || !row.id) return Promise.resolve(null);
    var rows = readCache().filter(function (item) { return item && item.id !== row.id; });
    rows.push(row);
    writeCache(rows);
    return openMsgDb().then(function (db) {
      if (!db) return row;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(MSG_STORE, 'readwrite');
          tx.objectStore(MSG_STORE).put(row);
          tx.oncomplete = function () { resolve(row); };
          tx.onerror = function () { resolve(row); };
        } catch (err) {
          resolve(row);
        }
      });
    });
  }

  function forgetPlain(id) {
    writeCache(readCache().filter(function (item) { return item && item.id !== id; }));
    return openMsgDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(MSG_STORE, 'readwrite');
          tx.objectStore(MSG_STORE).delete(id);
          tx.oncomplete = function () { resolve(null); };
          tx.onerror = function () { resolve(null); };
        } catch (err) {
          resolve(null);
        }
      });
    });
  }

  function listPlain() {
    var local = readCache();
    return openMsgDb().then(function (db) {
      if (!db) return local;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(MSG_STORE, 'readonly');
          var req = tx.objectStore(MSG_STORE).getAll();
          req.onsuccess = function () {
            var byId = new Map();
            local.forEach(function (row) { if (row && row.id) byId.set(row.id, row); });
            (req.result || []).forEach(function (row) { if (row && row.id) byId.set(row.id, row); });
            resolve(Array.from(byId.values()));
          };
          req.onerror = function () { resolve(local); };
        } catch (err) {
          resolve(local);
        }
      });
    });
  }

  function cached(id) {
    return listPlain().then(function (rows) {
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i] && rows[i].id === id) return rows[i];
      }
      return null;
    });
  }

  function sweepLocal(now) {
    var clock = Number(now) || Date.now();
    return listPlain().then(function (rows) {
      var keep = [];
      var gone = [];
      rows.forEach(function (row) {
        if (!row || !row.id) return;
        if (isDue(row, clock)) gone.push(row);
        else keep.push(row);
      });
      writeCache(keep);
      return openMsgDb().then(function (db) {
        if (!db) return gone;
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(MSG_STORE, 'readwrite');
            var store = tx.objectStore(MSG_STORE);
            store.clear();
            keep.forEach(function (row) { store.put(row); });
            tx.oncomplete = function () { resolve(gone); };
            tx.onerror = function () { resolve(gone); };
          } catch (err) {
            resolve(gone);
          }
        });
      });
    });
  }

  function sortMessages(list) {
    return (list || []).slice().sort(function (a, b) {
      var ta = Number(a && (a.timestamp || a.sentAt)) || 0;
      var tb = Number(b && (b.timestamp || b.sentAt)) || 0;
      if (ta !== tb) return ta - tb;
      var sa = Number(a && a.seq) || 0;
      var sb = Number(b && b.seq) || 0;
      if (sa !== sb) return sa - sb;
      var ia = String(a && a.id || '');
      var ib = String(b && b.id || '');
      if (ia < ib) return -1;
      if (ia > ib) return 1;
      return 0;
    });
  }

  function resolveDelivery(directOk, relayOk) {
    if (directOk && relayOk) return 'direct+relay';
    if (relayOk) return 'relay';
    if (directOk) return 'direct';
    return 'failed';
  }

  function nextSeq(me, peer) {
    var key = 'muzz_e2ee_seq:' + [walletOf(me), walletOf(peer)].sort().join('_');
    var n = Number(storageGet(key) || '0') + 1;
    if (!Number.isFinite(n) || n < 1) n = 1;
    storageSet(key, String(n));
    return n;
  }

  function ethersUtils() {
    var lib = global.ethers;
    if (!lib) return null;
    if (lib.utils && typeof lib.utils.getAddress === 'function') return lib.utils;
    if (typeof lib.getAddress === 'function') return lib;
    return null;
  }

  function parseWalletSearch(raw) {
    var text = String(raw || '').trim();
    if (!text) return { empty: true };
    var hex = /^0x[0-9a-fA-F]{40}$/.test(text);
    var utils = ethersUtils();
    if (!utils || typeof utils.isAddress !== 'function' || typeof utils.getAddress !== 'function') {
      return { error: hex ? 'That address failed the checksum. Check it and try again.' : 'Enter a valid 0x wallet address.' };
    }
    var valid = false;
    try { valid = !!utils.isAddress(text); } catch (err) { valid = false; }
    if (!valid) {
      return { error: hex ? 'That address failed the checksum. Check it and try again.' : 'Enter a valid 0x wallet address.' };
    }
    try {
      var checksum = utils.getAddress(text);
      var wallet = walletOf(String(checksum || '').toLowerCase());
      if (!wallet) return { error: 'Enter a valid 0x wallet address.' };
      return { wallet: wallet, checksum: String(checksum) };
    } catch (err) {
      return { error: hex ? 'That address failed the checksum. Check it and try again.' : 'Enter a valid 0x wallet address.' };
    }
  }

  function claimPrekey(wallet) {
    return post('/api/private?op=prekey', { wallet: walletOf(wallet) }).then(function (data) {
      if (!data || !data.id || !data.pub) {
        var missing = new Error('no_prekey');
        missing.code = 'no_prekey';
        throw missing;
      }
      return { id: String(data.id), pub: String(data.pub), identity: String(data.identity || '') };
    });
  }

  function relay(inner) {
    return post('/api/private?op=relay', { inner: inner });
  }

  function unwrap(id, peer) {
    return post('/api/private?op=unwrap', { id: id, peer: walletOf(peer) }).then(function (data) {
      return data && data.inner ? data.inner : null;
    });
  }

  function markRead(id, peer) {
    return post('/api/private?op=receipt', { id: id, peer: walletOf(peer) });
  }

  function encodeBytes(bytes) {
    return bytesToB64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
  }

  function photoBlob(b64) {
    return new Blob([b64ToBytes(b64)], { type: 'image/webp' });
  }

  function publish(wallet) {
    var me = walletOf(wallet);
    if (!me) {
      return Promise.reject(Object.assign(new Error('bad_wallet'), { code: 'bad_wallet' }));
    }
    return ensureBundle(me).then(function (bundle) {
      return post('/api/wallet-key', { pub: bundle.pub, prekeys: bundle.prekeys }).then(function () {
        return bundle.pub;
      });
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (!canvas || typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      canvas.toBlob(function (blob) { resolve(blob || null); }, type, quality);
    });
  }

  function compressImage(file) {
    if (typeof createImageBitmap !== 'function') {
      var unsupported = new Error('unsupported');
      unsupported.code = 'unsupported';
      return Promise.reject(unsupported);
    }
    return createImageBitmap(file).then(function (bitmap) {
      var maxEdge = 1600;
      var edge = Math.max(bitmap.width, bitmap.height) || 1;
      var scale = Math.min(1, maxEdge / edge);
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));
      var canvas = document.createElement('canvas');
      var quality = 0.82;
      var type = 'image/webp';
      function frame() {
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        return canvasToBlob(canvas, type, quality).then(function (blob) {
          if (!blob && type === 'image/webp') {
            type = 'image/jpeg';
            return canvasToBlob(canvas, type, quality);
          }
          return blob;
        });
      }
      function shrink(attempt, blob) {
        if (blob && blob.size <= 300 * 1024) return blob;
        if (attempt >= 8) return blob;
        if (quality > 0.5) quality -= 0.08;
        else {
          w = Math.max(1, Math.round(w * 0.8));
          h = Math.max(1, Math.round(h * 0.8));
        }
        return frame().then(function (next) { return shrink(attempt + 1, next || blob); });
      }
      return frame().then(function (blob) { return shrink(0, blob); }).finally(function () {
        if (bitmap.close) bitmap.close();
      });
    });
  }

  global.MuzzE2EE = {
    publish: publish,
    compressImage: compressImage,
    encodeBytes: encodeBytes,
    photoBlob: photoBlob,
    ensureBundle: ensureBundle,
    sealMessage: sealMessage,
    openMessage: openMessage,
    rememberPlain: rememberPlain,
    forgetPlain: forgetPlain,
    listPlain: listPlain,
    cached: cached,
    sweepLocal: sweepLocal,
    sortMessages: sortMessages,
    resolveDelivery: resolveDelivery,
    nextSeq: nextSeq,
    parseWalletSearch: parseWalletSearch,
    claimPrekey: claimPrekey,
    relay: relay,
    unwrap: unwrap,
    markRead: markRead,
    isDue: isDue,
    READ_TTL_MS: READ_TTL_MS,
    UNREAD_TTL_MS: UNREAD_TTL_MS
  };
})(typeof window !== 'undefined' ? window : globalThis);
