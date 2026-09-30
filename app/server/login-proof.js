import { getAddress, verifyMessage } from 'ethers';

export const MAX_AGE_MS = 10 * 60 * 1000;
/** A phone clock up to 7 minutes fast must not fail the Issued At check. */
export const CLOCK_SKEW_MS = 7 * 60 * 1000;
export const SIWE_DOMAIN = 'muzzsnap-app.vercel.app';
export const SIWE_URI = 'https://muzzsnap-app.vercel.app/login.html';
export const SIWE_STATEMENT = 'Sign in to MuzzSnap. This request does not spend gas or approve a token.';

function field(line, name) {
  const prefix = name + ': ';
  if (!line.startsWith(prefix)) return '';
  return line.slice(prefix.length).trim();
}

/**
 * Accept only the EIP-4361 message the app asks the wallet to sign.
 * The three-line form and any "MuzzSnap Login" form are rejected.
 */
export function inspectLoginProof(message, now) {
  const lines = String(message || '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length !== 11) return { reason: 'bad_format' };
  if (lines[0] !== SIWE_DOMAIN + ' wants you to sign in with your Ethereum account:') return { reason: 'bad_format' };
  const address = lines[1].trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { reason: 'bad_format' };
  let checksum = '';
  try {
    checksum = getAddress(address.toLowerCase());
  } catch {
    return { reason: 'bad_format' };
  }
  if (checksum !== address) return { reason: 'bad_format' };
  if (lines[2] !== '' || lines[4] !== '') return { reason: 'bad_format' };
  if (lines[3] !== SIWE_STATEMENT) return { reason: 'bad_format' };
  if (field(lines[5], 'URI') !== SIWE_URI) return { reason: 'bad_format' };
  if (field(lines[6], 'Version') !== '1') return { reason: 'bad_format' };
  if (field(lines[7], 'Chain ID') !== '1') return { reason: 'bad_format' };
  const nonce = field(lines[8], 'Nonce').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(nonce) || lines[8] !== 'Nonce: ' + nonce) return { reason: 'bad_format' };
  const issuedAt = field(lines[9], 'Issued At');
  const expiration = field(lines[10], 'Expiration Time');
  const issued = Date.parse(issuedAt);
  const exp = Date.parse(expiration);
  const clock = Number(now) || Date.now();
  if (!Number.isFinite(issued) || !Number.isFinite(exp)) return { reason: 'bad_format' };
  if (lines[9] !== 'Issued At: ' + new Date(issued).toISOString()) return { reason: 'bad_format' };
  if (lines[10] !== 'Expiration Time: ' + new Date(exp).toISOString()) return { reason: 'bad_format' };
  if (issued > exp) return { reason: 'bad_format' };
  if (issued > clock + CLOCK_SKEW_MS) return { reason: 'bad_format' };
  if (exp <= clock) return { reason: 'expired' };
  if (exp > clock + MAX_AGE_MS + CLOCK_SKEW_MS) return { reason: 'bad_format' };
  if (exp - issued > MAX_AGE_MS + CLOCK_SKEW_MS) return { reason: 'bad_format' };
  return { wallet: address.toLowerCase(), exp, nonce, issued };
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
    recovered = verifyMessage(String(message).replace(/\r\n/g, '\n'), sig);
  } catch {
    return { reason: 'bad_signature' };
  }
  if (String(recovered).toLowerCase() !== parsed.wallet) return { reason: 'bad_signature' };
  return {
    proof: {
      wallet: parsed.wallet,
      exp: parsed.exp,
      nonce: parsed.nonce
    }
  };
}

export function proveLogin(message, signature, now) {
  const judged = classifyLogin(message, signature, now);
  return judged.proof || null;
}
