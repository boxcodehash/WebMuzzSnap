import { verifyMessage } from 'ethers';

const MAX_AGE_MS = 10 * 60 * 1000;

export function parseLoginProof(message, now) {
  const text = String(message || '');
  const lines = text.split('\n');
  if (lines[0] !== 'MuzzSnap Login') return null;
  const walletLine = lines.find((line) => line.startsWith('Wallet: '));
  if (!walletLine) return null;
  const walletRaw = walletLine.slice('Wallet: '.length).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletRaw)) return null;
  const wallet = walletRaw.toLowerCase();
  const clock = Number(now) || Date.now();
  const expiresLine = lines.find((line) => line.startsWith('Expires: '));
  if (expiresLine) {
    const chain = lines.find((line) => line.startsWith('Chain ID: '));
    if (!chain || chain.slice('Chain ID: '.length).trim() !== '1') return null;
    const nonceLine = lines.find((line) => line.startsWith('Nonce: '));
    if (!nonceLine) return null;
    const nonce = nonceLine.slice('Nonce: '.length).trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(nonce)) return null;
    const exp = Number(expiresLine.slice('Expires: '.length).trim());
    if (!Number.isFinite(exp) || exp <= clock || exp > clock + MAX_AGE_MS) return null;
    return { wallet, exp, nonce };
  }
  const issuedLine = lines.find((line) => line.startsWith('Issued: '));
  if (!issuedLine) return null;
  const issued = Date.parse(issuedLine.slice('Issued: '.length).trim());
  if (!Number.isFinite(issued)) return null;
  if (issued > clock + 2 * 60 * 1000) return null;
  if (clock - issued > MAX_AGE_MS) return null;
  return { wallet, exp: issued + MAX_AGE_MS, nonce: '' };
}

export function proveLogin(message, signature, now) {
  const parsed = parseLoginProof(message, now);
  if (!parsed) return null;
  const sig = String(signature || '');
  if (!/^0x[a-fA-F0-9]{128,132}$/.test(sig)) return null;
  let recovered = '';
  try {
    recovered = verifyMessage(String(message), sig);
  } catch {
    return null;
  }
  if (String(recovered).toLowerCase() !== parsed.wallet) return null;
  return parsed;
}
