/**
 * Cifrado de un mensaje con tres factores. Ninguno basta por separado.
 *
 * 1. Secreto efímero: ECDH P-256 entre una llave NUEVA del emisor y la prekey del receptor.
 * 2. Secreto del receptor: ECDH P-256 entre la identidad del emisor y ESA prekey de un solo uso.
 * 3. Factor del servidor: 32 bytes aleatorios que entran como salt del HKDF.
 *
 * Quien tenga el factor y el ciphertext (Firebase) no puede calcular los dos ECDH
 * sin las llaves privadas, que no salen del dispositivo.
 */

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const FACTOR_LEN = 32;

export function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function toB64(bytes) {
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function fromB64(value) {
  const bin = atob(String(value || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function generateEcdhKeyPair() {
  return crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
}

export async function generateSigningKeyPair() {
  return crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
}

export async function exportPublicSpki(publicKey) {
  const raw = await crypto.subtle.exportKey('spki', publicKey);
  return toB64(new Uint8Array(raw));
}

export async function importEcdhPublic(spkiB64) {
  return crypto.subtle.importKey('spki', fromB64(spkiB64), ECDH, true, []);
}

export async function importEcdsaPublic(spkiB64) {
  return crypto.subtle.importKey('spki', fromB64(spkiB64), ECDSA, true, ['verify']);
}

async function ecdhRaw(privateKey, publicKey) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  return new Uint8Array(bits);
}

export function messageAad({ conversationId, messageId, sender, recipient, serverFactorId }) {
  if (!conversationId || !messageId || !sender || !recipient || !serverFactorId) {
    throw new Error('aad_incompleto');
  }
  return new TextEncoder().encode(
    ['muzzsnap-e2ee-v1', conversationId, messageId, sender, recipient, serverFactorId].join('\n')
  );
}

async function deriveMessageKey({ ephSecret, recvSecret, serverFactor, aad }) {
  if (!(serverFactor instanceof Uint8Array) || serverFactor.length !== FACTOR_LEN) {
    throw new Error('factor_servidor');
  }
  if (ephSecret.length < 32 || recvSecret.length < 32) throw new Error('ecdh');
  const ikm = concat([Uint8Array.of(0x01), ephSecret, Uint8Array.of(0x02), recvSecret]);
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(serverFactor),
      info: new Uint8Array(aad)
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Cifra para un receptor concreto.
 * recipientPrekeyPublic: CryptoKey pública de un solo uso del receptor.
 * serverFactor: Uint8Array de 32 bytes emitido por la Cloud Function.
 */
export async function seal({
  senderIdentityPrivate,
  recipientPrekeyPublic,
  serverFactor,
  plaintext,
  aad
}) {
  const eph = await generateEcdhKeyPair();
  const ephSecret = await ecdhRaw(eph.privateKey, recipientPrekeyPublic);
  const recvSecret = await ecdhRaw(senderIdentityPrivate, recipientPrekeyPublic);
  const iv = randomBytes(12);
  const aes = await deriveMessageKey({ ephSecret, recvSecret, serverFactor, aad });
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array(aad) },
    aes,
    plaintext
  );
  return {
    ciphertext: toB64(new Uint8Array(cipher)),
    iv: toB64(iv),
    senderEphPub: await exportPublicSpki(eph.publicKey)
  };
}

export async function open({
  senderEphPub,
  senderIdentityPublic,
  recipientPrekeyPrivate,
  serverFactor,
  ciphertext,
  iv,
  aad
}) {
  const ephPub = typeof senderEphPub === 'string' ? await importEcdhPublic(senderEphPub) : senderEphPub;
  const idPub = typeof senderIdentityPublic === 'string' ? await importEcdhPublic(senderIdentityPublic) : senderIdentityPublic;
  const ephSecret = await ecdhRaw(recipientPrekeyPrivate, ephPub);
  const recvSecret = await ecdhRaw(recipientPrekeyPrivate, idPub);
  const aes = await deriveMessageKey({ ephSecret, recvSecret, serverFactor, aad });
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv), additionalData: new Uint8Array(aad) },
    aes,
    fromB64(ciphertext)
  );
  return new Uint8Array(plain);
}

function prekeyBytes(id, pubB64) {
  return new TextEncoder().encode(`muzzsnap-prekey-v1\n${id}\n${pubB64}`);
}

export async function signPrekey(signingPrivate, id, pubB64) {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingPrivate, prekeyBytes(id, pubB64));
  return toB64(new Uint8Array(sig));
}

export async function verifyPrekey(signingPublic, id, pubB64, sigB64) {
  const key = typeof signingPublic === 'string' ? await importEcdsaPublic(signingPublic) : signingPublic;
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64(sigB64), prekeyBytes(id, pubB64));
}

/** El adjunto va cifrado aparte. La llave del archivo viaja DENTRO del sobre E2EE. */
export async function encryptFile(bytes) {
  const rawKey = randomBytes(32);
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return {
    ciphertext: new Uint8Array(cipher),
    keyB64: toB64(rawKey),
    ivB64: toB64(iv)
  };
}

export async function decryptFile(ciphertext, keyB64, ivB64) {
  const key = await crypto.subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, ciphertext);
  return new Uint8Array(plain);
}
