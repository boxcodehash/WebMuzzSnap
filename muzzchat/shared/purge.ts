import { CONSUMED_PREKEY_GRACE_MS, READ_TTL_MS, UNREAD_TTL_MS } from "./constants";

export type TimedMessage = {
  id: string;
  createdAt: number;
  readAt: number | null;
};

export type TimedPrekey = {
  id: string;
  consumed: boolean;
  consumedAt: number | null;
};

/** Read messages expire 24h after readAt. Unread messages expire 7 days after createdAt. */
export function messageDueForDeletion(
  msg: { createdAt: number; readAt: number | null },
  now: number,
): boolean {
  if (msg.readAt != null) return now - msg.readAt >= READ_TTL_MS;
  return now - msg.createdAt >= UNREAD_TTL_MS;
}

/** Consumed prekeys are deleted after a short grace window. Unused prekeys stay. */
export function prekeyDueForDeletion(prekey: TimedPrekey, now: number): boolean {
  if (!prekey.consumed) return false;
  if (prekey.consumedAt == null) return true;
  return now - prekey.consumedAt >= CONSUMED_PREKEY_GRACE_MS;
}

export function selectDeletions(now: number, messages: TimedMessage[], prekeys: TimedPrekey[]) {
  return {
    messageIds: messages.filter((m) => messageDueForDeletion(m, now)).map((m) => m.id),
    prekeyIds: prekeys.filter((p) => prekeyDueForDeletion(p, now)).map((p) => p.id),
  };
}

/** readAt is write-once. A second call keeps the original timestamp. */
export function nextReadAt(current: number | null, now: number): number {
  return current == null ? now : current;
}

/** Local copies follow the same clock as the server, driven by readAt / createdAt. */
export function localCopyDueForDeletion(
  msg: { createdAt: number; readAt: number | null },
  now: number,
): boolean {
  return messageDueForDeletion(msg, now);
}
