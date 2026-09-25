import { DEFAULT_MIN_MUZZ_WHOLE, MUZZ_DECIMALS } from "./constants";

/** Minimum balance in wei: `minWhole * 10n ** 18n`. */
export function minBalanceWei(minWhole: bigint = DEFAULT_MIN_MUZZ_WHOLE): bigint {
  return minWhole * 10n ** BigInt(MUZZ_DECIMALS);
}

/**
 * Access is granted at the threshold and above.
 * `balanceWei >= 10_000_000n * 10n ** 18n` with the default minimum.
 */
export function hasMuzzAccess(
  balanceWei: bigint,
  minWhole: bigint = DEFAULT_MIN_MUZZ_WHOLE,
): boolean {
  if (minWhole < 0n) throw new Error("MIN_MUZZ_WHOLE must be >= 0");
  if (balanceWei < 0n) return false;
  return balanceWei >= minBalanceWei(minWhole);
}

export function parseMinWhole(raw: string | undefined | null): bigint {
  if (raw == null || raw.trim() === "") return DEFAULT_MIN_MUZZ_WHOLE;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("MIN_MUZZ_WHOLE must be a non-negative integer");
  }
  return BigInt(text);
}
