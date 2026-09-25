/**
 * Mensaje de acceso (estilo SIWE, formato propio y cerrado).
 * El servidor solo acepta este texto. El mínimo firmado tiene que coincidir
 * con MIN_MUZZ; si no, la firma se rechaza.
 */

const SKEW_MS = 10 * 60 * 1000;

export function buildLoginMessage({ address, nonce, issuedAt, uri, chainId, tokenAddress, minMuzz }) {
  const addr = String(address || '').toLowerCase();
  const token = String(tokenAddress || '').toLowerCase();
  return [
    'MuzzSnap Login',
    '',
    `${addr} wants to sign in to MuzzSnap.`,
    'Sign this message to prove you control this wallet. It does not spend gas.',
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Token: ${token}`,
    `Minimum: ${minMuzz} MUZZ`
  ].join('\n');
}

export function parseLoginMessage(message, now = Date.now()) {
  const lines = String(message || '').split('\n');
  if (lines.length !== 12) throw new Error('format');
  if (lines[0] !== 'MuzzSnap Login') throw new Error('format');
  if (lines[1] !== '' || lines[4] !== '') throw new Error('format');
  if (lines[3] !== 'Sign this message to prove you control this wallet. It does not spend gas.') {
    throw new Error('format');
  }

  const who = lines[2].match(/^(0x[0-9a-fA-F]{40}) wants to sign in to MuzzSnap\.$/);
  if (!who) throw new Error('format');

  const fields = {};
  for (const line of lines.slice(5)) {
    const cut = line.indexOf(': ');
    if (cut <= 0) throw new Error('format');
    fields[line.slice(0, cut)] = line.slice(cut + 2);
  }

  const required = ['URI', 'Version', 'Chain ID', 'Nonce', 'Issued At', 'Token', 'Minimum'];
  for (const key of required) {
    if (!fields[key]) throw new Error('format');
  }
  if (fields.Version !== '1') throw new Error('format');
  if (!/^https?:\/\/.+/i.test(fields.URI) && !/^capacitor:\/\/.+/i.test(fields.URI)) {
    throw new Error('format');
  }
  if (!/^\d+$/.test(fields['Chain ID'])) throw new Error('format');
  if (!/^[a-f0-9]{32}$/.test(fields.Nonce)) throw new Error('format');
  if (!/^0x[0-9a-fA-F]{40}$/.test(fields.Token)) throw new Error('format');
  const min = fields.Minimum.match(/^(\d+) MUZZ$/);
  if (!min) throw new Error('format');

  const issued = Date.parse(fields['Issued At']);
  if (!Number.isFinite(issued)) throw new Error('format');
  if (Math.abs(now - issued) > SKEW_MS) throw new Error('issued_skew');

  return {
    address: who[1].toLowerCase(),
    uri: fields.URI,
    version: fields.Version,
    chainId: Number(fields['Chain ID']),
    nonce: fields.Nonce,
    issuedAt: fields['Issued At'],
    token: fields.Token.toLowerCase(),
    minMuzz: min[1]
  };
}

export function originOf(uri) {
  try {
    const url = new URL(uri);
    // capacitor:// no tiene origin estándar (URL.origin devuelve "null").
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `${url.protocol}//${url.host}`;
    }
    return url.origin;
  } catch {
    return '';
  }
}
