import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Delete a private message this long after the recipient's read receipt. */
export const READ_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Unread cap for private RTDB messages. This matches the existing 24h
 * undelivered blob limit (BLOB_TTL_MS), not the 72h Firestore unread cap.
 */
export const UNREAD_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * PRIVATE_SERVER_KEY is a Vercel env var: 32 bytes, hex (64 chars) or standard base64.
 * It only wraps ciphertext that is already end-to-end encrypted. It is never a message key.
 * Missing or malformed values return null so callers can fail without writing plaintext.
 */
export function loadServerKey(env) {
  const raw = String((env && env.PRIVATE_SERVER_KEY) || '').trim();
  if (!raw) return null;
  let bytes = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    bytes = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    bytes = Buffer.from(raw, 'base64');
  }
  if (!bytes || bytes.length !== 32) return null;
  return bytes;
}

export function wrapForStorage(serverKey, inner) {
  if (!serverKey || serverKey.length !== 32) {
    const error = new Error('server_key_missing');
    error.code = 'server_key_missing';
    throw error;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', serverKey, iv);
  const plain = Buffer.from(JSON.stringify(inner), 'utf8');
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const packed = Buffer.concat([ct, cipher.getAuthTag()]);
  return {
    outer: packed.toString('base64'),
    outerIv: iv.toString('base64')
  };
}

export function unwrapFromStorage(serverKey, outer, outerIv) {
  if (!serverKey || serverKey.length !== 32) {
    const error = new Error('server_key_missing');
    error.code = 'server_key_missing';
    throw error;
  }
  const iv = Buffer.from(String(outerIv || ''), 'base64');
  const packed = Buffer.from(String(outer || ''), 'base64');
  if (iv.length !== 12 || packed.length < 17) {
    const error = new Error('bad_outer');
    error.code = 'bad_outer';
    throw error;
  }
  const tag = packed.subarray(packed.length - 16);
  const ct = packed.subarray(0, packed.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', serverKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  const inner = JSON.parse(plain.toString('utf8'));
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
    const error = new Error('bad_outer');
    error.code = 'bad_outer';
    throw error;
  }
  return inner;
}

export function messageDue(msg, now) {
  if (!msg || typeof msg !== 'object') return false;
  const clock = Number(now) || 0;
  const expireAt = Number(msg.expireAt) || 0;
  if (expireAt > 0) return expireAt <= clock;
  const readAt = Number(msg.readAt) || 0;
  const sent = Number(msg.timestamp || msg.sentAt) || 0;
  if (readAt > 0) return clock - readAt >= READ_AFTER_MS;
  if (sent > 0) return clock - sent >= UNREAD_MAX_MS;
  return false;
}
