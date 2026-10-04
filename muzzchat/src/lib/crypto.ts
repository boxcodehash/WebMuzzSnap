import sodium from "libsodium-wrappers";
import {
  aadPayload,
  b64ToBytes,
  bytesToB64,
  type InnerEnvelope,
  prekeyPayload,
  signedPayload,
} from "../../shared/envelope";

export type Identity = {
  edPk: Uint8Array;
  edSk: Uint8Array;
  xPk: Uint8Array;
  xSk: Uint8Array;
};

export type OneTimePrekey = {
  id: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  signature: Uint8Array;
};

export interface PrekeySecrets {
  isConsumed(id: string): Promise<boolean>;
  peek(id: string): Promise<Uint8Array | null>;
  destroy(id: string): Promise<void>;
}

let ready: Promise<typeof sodium> | null = null;

export function getSodium(): Promise<typeof sodium> {
  if (!ready) ready = sodium.ready.then(() => sodium);
  return ready;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

async function hkdfContentKey(
  ikm: Uint8Array,
  messageId: string,
  senderWallet: string,
  receiverWallet: string,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", copyBytes(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: copyBytes(utf8(messageId)),
      info: copyBytes(
        utf8(`muzzchat-v1|${senderWallet.toLowerCase()}|${receiverWallet.toLowerCase()}|${messageId}`),
      ),
    },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

export async function generateIdentity(): Promise<Identity> {
  const s = await getSodium();
  const kp = s.crypto_sign_keypair();
  return {
    edPk: kp.publicKey,
    edSk: kp.privateKey,
    xPk: s.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey),
    xSk: s.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}

export async function signPrekey(identity: Identity, id: string, publicKey: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium();
  return s.crypto_sign_detached(utf8(prekeyPayload(id, bytesToB64(publicKey))), identity.edSk);
}

export async function verifyPrekey(
  identityPk: Uint8Array,
  id: string,
  publicKey: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const s = await getSodium();
  try {
    return s.crypto_sign_verify_detached(signature, utf8(prekeyPayload(id, bytesToB64(publicKey))), identityPk);
  } catch {
    return false;
  }
}

export async function generatePrekey(identity: Identity): Promise<OneTimePrekey> {
  const s = await getSodium();
  const box = s.crypto_box_keypair();
  const idBytes = s.randombytes_buf(16);
  const id = [...idBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const signature = await signPrekey(identity, id, box.publicKey);
  return { id, publicKey: box.publicKey, privateKey: box.privateKey, signature };
}

export function identityToStored(identity: Identity) {
  return {
    edPk: bytesToB64(identity.edPk),
    edSk: bytesToB64(identity.edSk),
    xPk: bytesToB64(identity.xPk),
    xSk: bytesToB64(identity.xSk),
  };
}

export function identityFromStored(stored: {
  edPk: string;
  edSk: string;
  xPk: string;
  xSk: string;
}): Identity {
  return {
    edPk: b64ToBytes(stored.edPk),
    edSk: b64ToBytes(stored.edSk),
    xPk: b64ToBytes(stored.xPk),
    xSk: b64ToBytes(stored.xSk),
  };
}

export async function encryptMessage(input: {
  messageId: string;
  threadId: string;
  senderWallet: string;
  receiverWallet: string;
  sender: Identity;
  receiverIdentityPk: Uint8Array;
  otk: { id: string; publicKey: Uint8Array; signature: Uint8Array };
  plaintext: string;
}): Promise<InnerEnvelope> {
  const s = await getSodium();
  const otkOk = await verifyPrekey(input.receiverIdentityPk, input.otk.id, input.otk.publicKey, input.otk.signature);
  if (!otkOk) throw new Error("PREKEY_SIGNATURE");

  const eph = s.crypto_box_keypair();
  let dhEph: Uint8Array | null = null;
  let dhId: Uint8Array | null = null;
  let contentKey: Uint8Array | null = null;
  try {
    dhEph = s.crypto_scalarmult(eph.privateKey, input.otk.publicKey);
    dhId = s.crypto_scalarmult(input.sender.xSk, input.otk.publicKey);
    contentKey = await hkdfContentKey(
      concatBytes(dhEph, dhId),
      input.messageId,
      input.senderWallet,
      input.receiverWallet,
    );
    const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const draft: InnerEnvelope = {
      v: 1,
      messageId: input.messageId,
      threadId: input.threadId,
      senderWallet: input.senderWallet.toLowerCase(),
      receiverWallet: input.receiverWallet.toLowerCase(),
      senderIdentityPk: bytesToB64(input.sender.edPk),
      senderIdentityX25519Pk: bytesToB64(input.sender.xPk),
      ephPk: bytesToB64(eph.publicKey),
      otkId: input.otk.id,
      otkPk: bytesToB64(input.otk.publicKey),
      nonce: bytesToB64(nonce),
      ciphertext: "",
      signature: "",
    };
    const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
      utf8(input.plaintext),
      utf8(aadPayload(draft)),
      null,
      nonce,
      contentKey,
    );
    draft.ciphertext = bytesToB64(ciphertext);
    draft.signature = bytesToB64(s.crypto_sign_detached(utf8(signedPayload(draft)), input.sender.edSk));
    return draft;
  } finally {
    eph.privateKey.fill(0);
    dhEph?.fill(0);
    dhId?.fill(0);
    contentKey?.fill(0);
  }
}

export async function decryptMessage(envelope: InnerEnvelope, otkPrivate: Uint8Array): Promise<string> {
  const s = await getSodium();
  const senderPk = b64ToBytes(envelope.senderIdentityPk);
  let signatureOk = false;
  try {
    signatureOk = s.crypto_sign_verify_detached(
      b64ToBytes(envelope.signature),
      utf8(signedPayload(envelope)),
      senderPk,
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw new Error("BAD_SIGNATURE");

  const derivedX = s.crypto_sign_ed25519_pk_to_curve25519(senderPk);
  if (bytesToB64(derivedX) !== envelope.senderIdentityX25519Pk) throw new Error("IDENTITY_MISMATCH");

  let dhEph: Uint8Array | null = null;
  let dhId: Uint8Array | null = null;
  let contentKey: Uint8Array | null = null;
  try {
    dhEph = s.crypto_scalarmult(otkPrivate, b64ToBytes(envelope.ephPk));
    dhId = s.crypto_scalarmult(otkPrivate, derivedX);
    contentKey = await hkdfContentKey(
      concatBytes(dhEph, dhId),
      envelope.messageId,
      envelope.senderWallet,
      envelope.receiverWallet,
    );
    const plain = s.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      b64ToBytes(envelope.ciphertext),
      utf8(aadPayload(envelope)),
      b64ToBytes(envelope.nonce),
      contentKey,
    );
    return new TextDecoder().decode(plain);
  } catch (error) {
    if (error instanceof Error && (error.message === "BAD_SIGNATURE" || error.message === "IDENTITY_MISMATCH")) {
      throw error;
    }
    throw new Error("DECRYPT_FAILED");
  } finally {
    dhEph?.fill(0);
    dhId?.fill(0);
    contentKey?.fill(0);
  }
}

/**
 * Decrypts with a one-time prekey and deletes the private key only after success.
 * A second attempt throws PREKEY_REUSE.
 */
export async function openMessage(secrets: PrekeySecrets, envelope: InnerEnvelope): Promise<string> {
  if (await secrets.isConsumed(envelope.otkId)) throw new Error("PREKEY_REUSE");
  const sk = await secrets.peek(envelope.otkId);
  if (!sk) throw new Error("PREKEY_REUSE");
  try {
    const plain = await decryptMessage(envelope, sk);
    await secrets.destroy(envelope.otkId);
    return plain;
  } finally {
    sk.fill(0);
  }
}

export class MemoryPrekeys implements PrekeySecrets {
  private keys = new Map<string, Uint8Array>();
  private gone = new Set<string>();

  add(id: string, secret: Uint8Array) {
    this.keys.set(id, new Uint8Array(secret));
  }

  has(id: string) {
    return this.keys.has(id);
  }

  async isConsumed(id: string) {
    return this.gone.has(id);
  }

  async peek(id: string) {
    const sk = this.keys.get(id);
    return sk ? new Uint8Array(sk) : null;
  }

  async destroy(id: string) {
    const sk = this.keys.get(id);
    if (sk) sk.fill(0);
    this.keys.delete(id);
    this.gone.add(id);
  }
}
