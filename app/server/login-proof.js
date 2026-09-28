import { verifyMessage } from 'ethers';

export const MAX_AGE_MS = 10 * 60 * 1000;
/** A phone clock up to 7 minutes fast must not fail the future-dated Expires check. */
export const CLOCK_SKEW_MS = 7 * 60 * 1000;
const CHAINS = new Set(['1', '56']);

function chainValues(lines) {
  return lines
    .filter((line) => line.startsWith('Chain ID: '))
    .map((line) => line.slice('Chain ID: '.length).trim());
}

function inspectExpiring(lines, wallet, clock) {
  const expiresLine = lines.find((line) => line.startsWith('Expires: '));
  if (!expiresLine) return { reason: 'bad_format' };
  const chains = chainValues(lines);
  if (!chains.length || chains.some((value) => !CHAINS.has(value))) return { reason: 'bad_format' };
  const nonceLine = lines.find((line) => line.startsWith('Nonce: '));
  if (!nonceLine) return { reason: 'bad_format' };
  const nonce = nonceLine.slice('Nonce: '.length).trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(nonce)) return { reason: 'bad_format' };
  const exp = Number(expiresLine.slice('Expires: '.length).trim());
  if (!Number.isFinite(exp)) return { reason: 'bad_format' };
  if (exp <= clock) return { reason: 'expired' };
  if (exp > clock + MAX_AGE_MS + CLOCK_SKEW_MS) return { reason: 'bad_format' };
  return { wallet, exp, nonce };
}

function inspectLoginProof(message, now) {
  const lines = String(message || '').split('\n');
  const clock = Number(now) || Date.now();
  if (/wants you to sign in with your Ethereum account:$/.test(String(lines[0] || ''))) {
    if (!lines.some((line) => line === 'MuzzSnap Login')) return { reason: 'bad_format' };
    if (!lines.some((line) => line.startsWith('Token: '))) return { reason: 'bad_format' };
    if (!lines.some((line) => line.startsWith('Minimum: '))) return { reason: 'bad_format' };
    const address = String(lines[1] || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { reason: 'bad_format' };
    return inspectExpiring(lines, address.toLowerCase(), clock);
  }
  if (lines[0] !== 'MuzzSnap Login') return { reason: 'bad_format' };
  const walletLine = lines.find((line) => line.startsWith('Wallet: '));
  if (!walletLine) return { reason: 'bad_format' };
  const walletRaw = walletLine.slice('Wallet: '.length).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletRaw)) return { reason: 'bad_format' };
  const wallet = walletRaw.toLowerCase();
  const expiresLine = lines.find((line) => line.startsWith('Expires: '));
  if (expiresLine) return inspectExpiring(lines, wallet, clock);
  const issuedLine = lines.find((line) => line.startsWith('Issued: '));
  if (!issuedLine) return { reason: 'bad_format' };
  const issued = Date.parse(issuedLine.slice('Issued: '.length).trim());
  if (!Number.isFinite(issued)) return { reason: 'bad_format' };
  if (issued > clock + CLOCK_SKEW_MS) return { reason: 'bad_format' };
  if (clock - issued > MAX_AGE_MS) return { reason: 'expired' };
  return { wallet, exp: issued + MAX_AGE_MS, nonce: '' };
}

export function parseLoginProof(message, now) {
  const parsed = inspectLoginProof(message, now);
  if (parsed.reason) return null;
  return { wallet: parsed.wallet, exp: parsed.exp, nonce: parsed.nonce };
}

export function classifyLogin(message, signature, now) {
  const parsed = inspectLoginProof(message, now);
  if (parsed.reason) return { reason: parsed.reason };
  const sig = String(signature || '');
  if (!/^0x[a-fA-F0-9]{128,132}$/.test(sig)) return { reason: 'bad_signature' };
  let recovered = '';
  try {
    recovered = verifyMessage(String(message), sig);
  } catch {
    return { reason: 'bad_signature' };
  }
  if (String(recovered).toLowerCase() !== parsed.wallet) return { reason: 'bad_signature' };
  return { proof: { wallet: parsed.wallet, exp: parsed.exp, nonce: parsed.nonce } };
}

export function proveLogin(message, signature, now) {
  const judged = classifyLogin(message, signature, now);
  return judged.proof || null;
}
