import { describe, expect, it } from "vitest";
import { CONSUMED_PREKEY_GRACE_MS, READ_TTL_MS, UNREAD_TTL_MS } from "../shared/constants";
import {
  localCopyDueForDeletion,
  messageDueForDeletion,
  nextReadAt,
  prekeyDueForDeletion,
  selectDeletions,
} from "../shared/purge";

const now = Date.UTC(2026, 0, 20, 15, 0, 0);

describe("deletion with fake time", () => {
  it("deletes read messages 24h after readAt and unread messages after 7 days", () => {
    const readFresh = { createdAt: now - 8 * 86_400_000, readAt: now - READ_TTL_MS + 1 };
    const readDue = { createdAt: now - 60_000, readAt: now - READ_TTL_MS };
    const unreadFresh = { createdAt: now - UNREAD_TTL_MS + 1, readAt: null };
    const unreadDue = { createdAt: now - UNREAD_TTL_MS, readAt: null };

    expect(messageDueForDeletion(readFresh, now)).toBe(false);
    expect(messageDueForDeletion(readDue, now)).toBe(true);
    expect(messageDueForDeletion(unreadFresh, now)).toBe(false);
    expect(messageDueForDeletion(unreadDue, now)).toBe(true);
    expect(localCopyDueForDeletion(readDue, now)).toBe(true);
    expect(localCopyDueForDeletion(readFresh, now)).toBe(false);
  });

  it("keeps a recently read message even if it was created more than 7 days ago", () => {
    const msg = { createdAt: now - UNREAD_TTL_MS - 1, readAt: now - 60_000 };
    expect(messageDueForDeletion(msg, now)).toBe(false);
  });

  it("selects expired messages and consumed prekeys at a chosen instant", () => {
    const result = selectDeletions(
      now,
      [
        { id: "keep-read", createdAt: now - 10_000, readAt: now - 1_000 },
        { id: "drop-read", createdAt: now - 10_000, readAt: now - READ_TTL_MS },
        { id: "keep-unread", createdAt: now - 1_000, readAt: null },
        { id: "drop-unread", createdAt: now - UNREAD_TTL_MS, readAt: null },
      ],
      [
        { id: "fresh", consumed: false, consumedAt: null },
        { id: "just-used", consumed: true, consumedAt: now - CONSUMED_PREKEY_GRACE_MS + 1 },
        { id: "stale-used", consumed: true, consumedAt: now - CONSUMED_PREKEY_GRACE_MS },
        { id: "used-no-time", consumed: true, consumedAt: null },
      ],
    );

    expect(result.messageIds).toEqual(["drop-read", "drop-unread"]);
    expect(result.prekeyIds).toEqual(["stale-used", "used-no-time"]);
    expect(prekeyDueForDeletion({ id: "fresh", consumed: false, consumedAt: null }, now)).toBe(false);
  });

  it("does not move readAt once it is set", () => {
    expect(nextReadAt(null, now)).toBe(now);
    expect(nextReadAt(now - 50, now + 5_000)).toBe(now - 50);
  });
});
