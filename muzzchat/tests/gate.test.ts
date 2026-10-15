import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_MUZZ_WHOLE } from "../shared/constants";
import { hasMuzzAccess, minBalanceWei, parseMinWhole } from "../shared/gate";

describe("muzz gate", () => {
  const threshold = 10_000_000n * 10n ** 18n;

  it("uses the documented default of 10 million whole tokens", () => {
    expect(DEFAULT_MIN_MUZZ_WHOLE).toBe(10_000_000n);
    expect(minBalanceWei()).toBe(threshold);
  });

  it("allows the exact boundary and rejects one wei below", () => {
    expect(hasMuzzAccess(threshold)).toBe(true);
    expect(hasMuzzAccess(threshold - 1n)).toBe(false);
    expect(hasMuzzAccess(0n)).toBe(false);
    expect(hasMuzzAccess(threshold + 1n)).toBe(true);
    expect(hasMuzzAccess(-1n)).toBe(false);
  });

  it("honors a configured whole-token minimum", () => {
    const min = 1n;
    const line = minBalanceWei(min);
    expect(line).toBe(10n ** 18n);
    expect(hasMuzzAccess(line, min)).toBe(true);
    expect(hasMuzzAccess(line - 1n, min)).toBe(false);
    expect(parseMinWhole("10000000")).toBe(10_000_000n);
    expect(parseMinWhole(undefined)).toBe(10_000_000n);
    expect(parseMinWhole(" 42 ")).toBe(42n);
    expect(() => parseMinWhole("10.5")).toThrow(/MIN_MUZZ_WHOLE/);
    expect(() => parseMinWhole("-1")).toThrow(/MIN_MUZZ_WHOLE/);
  });
});
