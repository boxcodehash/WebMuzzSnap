import { READ_TTL_MS, SENDER_COPY_TTL_MS, UNREAD_TTL_MS } from '../shared/policy.js';

export { READ_TTL_MS, SENDER_COPY_TTL_MS, UNREAD_TTL_MS };

/**
 * kind:
 * - 'inbox': privado o bandeja grupal del receptor. 72 h hasta que se lee.
 * - 'sender-copy': copia del emisor en el grupo. 24 h desde el envío.
 */
export function expireAtOnSend(sentAt, kind) {
  const base = Number(sentAt);
  if (!Number.isFinite(base)) throw new Error('sentAt');
  if (kind === 'sender-copy') return base + SENDER_COPY_TTL_MS;
  return base + UNREAD_TTL_MS;
}

export function expireAtOnRead(readAt) {
  const base = Number(readAt);
  if (!Number.isFinite(base)) throw new Error('readAt');
  return base + READ_TTL_MS;
}

export function shouldPurge(expireAt, now) {
  return typeof expireAt === 'number' && Number.isFinite(expireAt) && expireAt <= now;
}
