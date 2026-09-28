/**
 * Private photos and text stay on the two phones.
 * The public key is published through /api/wallet-key. The private key stays in
 * localStorage on this device. Vercel only stores ciphertext.
 */
(function (global) {
  var PRIV_KEY = 'muzz_e2ee_priv';
  var PUB_KEY = 'muzz_e2ee_pub';
  var CURVE = 'P-256';
  var INFO = 'muzzsnap-private-v1';
  var PUBLIC_API = 'https://muzzsnap-app.vercel.app';

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

  function loadOrCreate() {
    var privB64 = storageGet(PRIV_KEY);
    var pubB64 = storageGet(PUB_KEY);
    if (privB64 && pubB64) {
      return crypto.subtle.importKey(
        'pkcs8',
        b64ToBytes(privB64),
        { name: 'ECDH', namedCurve: CURVE },
        true,
        ['deriveBits']
      ).then(function (privateKey) {
        return { privateKey: privateKey, pub: pubB64 };
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
        privB64 = bytesToB64(new Uint8Array(exported[0]));
        pubB64 = bytesToB64(new Uint8Array(exported[1]));
        storageSet(PRIV_KEY, privB64);
        storageSet(PUB_KEY, pubB64);
        return { privateKey: pair.privateKey, pub: pubB64 };
      });
    });
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

  function aesKey(privateKey, peerPubB64) {
    return importPub(peerPubB64).then(function (publicKey) {
      return crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
    }).then(function (bits) {
      return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    }).then(function (hkdf) {
      return crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(16),
          info: new TextEncoder().encode(INFO)
        },
        hkdf,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  function encryptBytes(privateKey, peerPubB64, bytes) {
    return aesKey(privateKey, peerPubB64).then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes).then(function (ct) {
        return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
      });
    });
  }

  function decryptBytes(privateKey, peerPubB64, ivB64, ctB64) {
    return aesKey(privateKey, peerPubB64).then(function (key) {
      return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
        key,
        b64ToBytes(ctB64)
      ).then(function (plain) {
        return new Uint8Array(plain);
      });
    });
  }

  function otherPub(seal, me, from) {
    var mine = String(from || '').toLowerCase() === String(me || '').toLowerCase();
    return mine ? seal.toPub : seal.fromPub;
  }

  function publish() {
    return loadOrCreate().then(function (keys) {
      return post('/api/wallet-key', { pub: keys.pub }).then(function () { return keys.pub; });
    });
  }

  function peerKey(wallet) {
    return post('/api/wallet-key-read', { wallet: String(wallet || '').toLowerCase() }).then(function (data) {
      return data && data.pub ? String(data.pub) : '';
    });
  }

  function sealText(me, peer, text) {
    return loadOrCreate().then(function (keys) {
      return peerKey(peer).then(function (toPub) {
        if (!toPub) return null;
        return encryptBytes(keys.privateKey, toPub, new TextEncoder().encode(text)).then(function (box) {
          return {
            v: 1,
            kind: 'text',
            iv: box.iv,
            ct: box.ct,
            fromPub: keys.pub,
            toPub: toPub
          };
        });
      });
    });
  }

  function openText(me, from, seal) {
    return loadOrCreate().then(function (keys) {
      return decryptBytes(keys.privateKey, otherPub(seal, me, from), seal.iv, seal.ct).then(function (plain) {
        return new TextDecoder().decode(plain);
      });
    });
  }

  function preparePhoto(me, peer, bytes) {
    return loadOrCreate().then(function (keys) {
      return peerKey(peer).then(function (toPub) {
        if (!toPub) {
          var missing = new Error('no_peer_key');
          missing.code = 'no_peer_key';
          throw missing;
        }
        return encryptBytes(keys.privateKey, toPub, bytes).then(function (box) {
          return {
            v: 1,
            kind: 'photo',
            iv: box.iv,
            ct: box.ct,
            from: walletOf(me),
            to: walletOf(peer),
            fromPub: keys.pub,
            toPub: toPub
          };
        });
      });
    });
  }

  function rememberBox(box, id) {
    var row = {
      id: id,
      from: box.from,
      to: box.to,
      iv: box.iv,
      ct: box.ct,
      fromPub: box.fromPub,
      toPub: box.toPub
    };
    if (global.MuzzTransfer && typeof global.MuzzTransfer.remember === 'function') {
      return global.MuzzTransfer.remember(row).then(function () { return row; });
    }
    return Promise.resolve(row);
  }

  function uploadMailbox(box) {
    return post('/api/private-blob', {
      to: box.to,
      ct: box.ct,
      iv: box.iv,
      fromPub: box.fromPub,
      toPub: box.toPub
    }).then(function (stored) {
      var seal = {
        v: 1,
        kind: 'photo',
        iv: box.iv,
        id: stored.id,
        fromPub: box.fromPub,
        toPub: box.toPub
      };
      return rememberBox(box, stored.id).then(function () { return seal; });
    });
  }

  function sealPhoto(me, peer, bytes) {
    return preparePhoto(me, peer, bytes).then(function (box) {
      return uploadMailbox(box);
    });
  }

  function linkPhoto(id, thread, msgId) {
    return post('/api/private-blob-link', { id: id, thread: thread, msgId: msgId }).catch(function () { return null; });
  }

  function pendingPhotos() {
    return post('/api/photo-mailbox', {}).then(function (data) {
      return (data && data.items) || [];
    });
  }

  function ackPhoto(id) {
    return post('/api/private-blob-ack', { id: id }).catch(function () { return null; });
  }

  function openPhoto(me, from, seal) {
    var local = (global.MuzzTransfer && typeof global.MuzzTransfer.readLocal === 'function')
      ? global.MuzzTransfer.readLocal(seal && seal.id)
      : Promise.resolve(null);
    return local.then(function (row) {
      return loadOrCreate().then(function (keys) {
        if (row && row.ct) {
          return decryptBytes(keys.privateKey, otherPub(seal, me, from), row.iv || seal.iv, row.ct);
        }
        return post('/api/private-blob-read', { id: seal.id }).then(function (stored) {
          var box = {
            from: walletOf(from),
            to: walletOf(me),
            iv: seal.iv,
            ct: stored.ct,
            fromPub: seal.fromPub,
            toPub: seal.toPub
          };
          return rememberBox(box, seal.id).then(function () {
            return ackPhoto(seal.id);
          }).then(function () {
            return decryptBytes(keys.privateKey, otherPub(seal, me, from), seal.iv, stored.ct);
          });
        });
      });
    }).then(function (plain) {
      return new Blob([plain], { type: 'image/webp' });
    });
  }

  function forgetBlob(id) {
    return ackPhoto(id);
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
    peerKey: peerKey,
    sealText: sealText,
    openText: openText,
    preparePhoto: preparePhoto,
    uploadMailbox: uploadMailbox,
    sealPhoto: sealPhoto,
    linkPhoto: linkPhoto,
    pendingPhotos: pendingPhotos,
    ackPhoto: ackPhoto,
    openPhoto: openPhoto,
    forgetBlob: forgetBlob,
    compressImage: compressImage,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes,
    loadOrCreate: loadOrCreate
  };
})(typeof window !== 'undefined' ? window : globalThis);
