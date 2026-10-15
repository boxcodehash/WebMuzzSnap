import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Server-side AES-256-GCM wrapper. This layer never sees the chat plaintext. */
export function wrapEnvelope(plaintext: Buffer, key: Buffer): { iv: string; data: string } {
  if (key.length !== 32) throw new Error("WRAP_KEY_LENGTH");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    data: Buffer.concat([enc, tag]).toString("base64"),
  };
}

export function unwrapEnvelope(ivB64: string, dataB64: string, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error("WRAP_KEY_LENGTH");
  const iv = Buffer.from(ivB64, "base64");
  const blob = Buffer.from(dataB64, "base64");
  if (iv.length !== 12 || blob.length < 17) throw new Error("WRAP_MALFORMED");
  const tag = blob.subarray(blob.length - 16);
  const enc = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
