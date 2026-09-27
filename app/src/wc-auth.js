import { createEncodedRecap, formatMessage } from '@walletconnect/utils';
import { ethers } from 'ethers';

export const AUTH_CHAINS = ['eip155:1', 'eip155:56'];
export const AUTH_METHODS = ['personal_sign', 'eth_sign', 'eth_requestAccounts', 'eth_accounts'];
const TOKEN = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';
const AUTH_TTL_MS = 3 * 60 * 1000;

export function randomAuthNonce() {
  const bytes = new Uint8Array(16);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && cryptoRef.getRandomValues) cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Statement carried inside the one-click SIWE message. Chain ID 1 is the login proof, not a wallet switch. */
export function buildAuthStatement({ nonce, exp }) {
  return [
    'MuzzSnap Login',
    '',
    'Sign this message to prove you control this wallet. It does not spend gas.',
    '',
    'Chain ID: 1',
    'Nonce: ' + nonce,
    'Expires: ' + exp,
    'Token: ' + TOKEN,
    'Minimum: 10000000 MUZZ'
  ].join('\n');
}

export function buildOneClickAuth({ domain, uri, now = Date.now(), nonce, exp } = {}) {
  const id = nonce || randomAuthNonce();
  const expiry = Number.isFinite(Number(exp)) ? Number(exp) : now + AUTH_TTL_MS;
  const statement = buildAuthStatement({ nonce: id, exp: expiry });
  return {
    domain: String(domain || ''),
    uri: String(uri || ''),
    nonce: id,
    chains: AUTH_CHAINS.slice(),
    methods: AUTH_METHODS.slice(),
    ttl: Math.ceil(AUTH_TTL_MS / 1000),
    type: 'caip122',
    exp: new Date(expiry).toISOString(),
    statement,
    resources: [createEncodedRecap('eip155', 'request', AUTH_METHODS.slice())]
  };
}

export function authRequestParams(auth) {
  return {
    domain: auth.domain,
    uri: auth.uri,
    nonce: auth.nonce,
    chains: auth.chains.slice(),
    ttl: auth.ttl,
    type: auth.type,
    exp: auth.exp,
    statement: auth.statement,
    resources: auth.resources
  };
}

export function hasLiveSession(provider) {
  const session = provider && provider.session;
  if (!session || !session.topic) return false;
  const namespaces = session.namespaces;
  if (!namespaces || typeof namespaces !== 'object') return false;
  return Object.values(namespaces).some((ns) => Array.isArray(ns?.accounts) && ns.accounts.length > 0);
}

function withHexPrefix(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.startsWith('0x') ? text : `0x${text}`;
}

/** Rebuild the exact SIWE string WalletConnect signed and keep it only if it recovers the issuer. */
export function cacaoProof(cacao) {
  const payload = cacao && cacao.p;
  const sig = cacao && cacao.s && cacao.s.s;
  if (!payload || !payload.iss || !sig) return null;
  let message = '';
  try {
    message = formatMessage(payload, payload.iss);
  } catch {
    return null;
  }
  const signature = withHexPrefix(sig);
  let recovered = '';
  try {
    recovered = ethers.verifyMessage(message, signature).toLowerCase();
  } catch {
    return null;
  }
  const issuer = String(payload.iss).match(/0x[a-fA-F0-9]{40}/);
  const address = issuer ? issuer[0].toLowerCase() : '';
  if (!address || recovered !== address) return null;
  return { address, message, signature };
}

export function proofFromSession(session) {
  const list = session && session.authentication;
  if (!Array.isArray(list)) return null;
  for (const cacao of list) {
    const proof = cacaoProof(cacao);
    if (proof) return proof;
  }
  return null;
}

export function createSingleFlight() {
  let current = null;
  return function singleFlight(task) {
    if (current) return current;
    let run;
    run = Promise.resolve().then(task).finally(() => {
      if (current === run) current = null;
    });
    current = run;
    return run;
  };
}
