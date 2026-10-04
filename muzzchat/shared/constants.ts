/** ERC-20 MUZZ on Ethereum mainnet. 18 decimals. */
export const MUZZ_TOKEN_ADDRESS = "0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0";

export const MUZZ_DECIMALS = 18;

/** Whole tokens required to hold a session. Configurable via MIN_MUZZ_WHOLE. */
export const DEFAULT_MIN_MUZZ_WHOLE = 10_000_000n;

export const READ_TTL_MS = 24 * 60 * 60 * 1000;
export const UNREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Consumed one-time prekeys are removed by the 15-minute job once this grace
 * passes, so a claim that is already in flight can still be used to send.
 */
export const CONSUMED_PREKEY_GRACE_MS = 60 * 60 * 1000;

export const PREKEY_TARGET = 20;
export const PREKEY_LOW_WATER = 8;
export const PREKEY_MAX_STORED = 80;

export const MESSAGE_ID_RE = /^[0-9a-f]{32}$/;
export const WALLET_RE = /^0x[0-9a-f]{40}$/;

export function isRandomId(id: string): boolean {
  return MESSAGE_ID_RE.test(id);
}

export function isWallet(addr: string): boolean {
  return WALLET_RE.test(addr);
}

export function normalizeWallet(addr: string): string {
  return addr.trim().toLowerCase();
}
