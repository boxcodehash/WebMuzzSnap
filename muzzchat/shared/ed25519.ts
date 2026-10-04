import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

if (!ed.etc.sha512Sync) {
  ed.etc.sha512Sync = (...messages: Uint8Array[]) => sha512(ed.etc.concatBytes(...messages));
}

/** Verifies a libsodium `crypto_sign_detached` signature (standard Ed25519). */
export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
