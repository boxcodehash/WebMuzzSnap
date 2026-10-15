import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unwrapEnvelope, wrapEnvelope } from "../shared/wrap";

describe("server wrap", () => {
  const key = createHash("sha256").update("test-wrap").digest();

  it("roundtrips the inner envelope and rejects tampering", () => {
    const inner = Buffer.from(JSON.stringify({ ciphertext: "aabb", v: 1 }), "utf8");
    const wrapped = wrapEnvelope(inner, key);
    expect(unwrapEnvelope(wrapped.iv, wrapped.data, key).equals(inner)).toBe(true);

    const blob = Buffer.from(wrapped.data, "base64");
    blob[0] = blob[0]! ^ 0x01;
    expect(() => unwrapEnvelope(wrapped.iv, blob.toString("base64"), key)).toThrow();
  });
});
