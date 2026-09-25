import { ethers } from 'ethers';

/** Compara enteros. No usa parseFloat: un saldo justo en el mínimo entra; uno por debajo, no. */
export function hasEnoughBalance(balanceWei, decimals, minTokens) {
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) throw new Error('decimals');
  const min = ethers.parseUnits(String(minTokens), dec);
  const bal = typeof balanceWei === 'bigint' ? balanceWei : BigInt(balanceWei);
  return bal >= min;
}

export function assertSignedPolicy(parsed, policy) {
  if (parsed.chainId !== 1) throw new Error('chain');
  if (parsed.version !== '1') throw new Error('format');
  if (parsed.token !== String(policy.tokenAddress).toLowerCase()) throw new Error('token');
  if (parsed.minMuzz !== String(policy.minMuzz)) throw new Error('minimum');
  if (parsed.address !== String(policy.recovered).toLowerCase()) throw new Error('address');
}
