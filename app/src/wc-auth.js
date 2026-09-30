import { createEncodedRecap, formatMessage } from '@walletconnect/utils';
import { ethers } from 'ethers';

export const AUTH_CHAINS = ['eip155:1'];
export const AUTH_METHODS = ['personal_sign', 'eth_requestAccounts', 'eth_accounts'];
const TOKEN = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';
const AUTH_TTL_MS = 10 * 60 * 1000;

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
  for (const item of list) {
    const cacao = item && item.p ? item : (item && item.cacao);
    const proof = cacaoProof(cacao);
    if (proof) return proof;
  }
  return null;
}

export function createSingleFlight() {
  let current = null;
  function singleFlight(task) {
    if (current) return current;
    let run;
    run = Promise.resolve().then(task).finally(() => {
      if (current === run) current = null;
    });
    current = run;
    return run;
  }
  singleFlight.reset = () => {
    current = null;
  };
  return singleFlight;
}

/** sign-client floors wc_sessionAuthenticate at ONE_HOUR. A shorter expiry cannot reduce it. */
export const AUTHENTICATE_WAIT_FLOOR_MS = 3_600_000;
/** WalletConnect rejects a session proposal expiry under FIVE_MINUTES. */
export const PROPOSE_TTL_FLOOR_S = 300;
export const METAMASK_WC_ID = 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96';
export const DEEPLINK_KEY = 'WALLETCONNECT_DEEPLINK_CHOICE';

let pendingChoice = null;
let lastTimed = '';
let lastSignHrefAt = 0;

export function muzzMark(label) {
  const rows = globalThis.__muzzTimes || (globalThis.__muzzTimes = []);
  if (!globalThis.__muzzTimer) {
    try { console.time('muzz-login'); } catch { /* the page timer is already running */ }
    globalThis.__muzzTimer = true;
  }
  if (lastTimed) {
    try { console.timeEnd(`muzz:${lastTimed}`); } catch { /* step timer already closed */ }
  }
  const step = `${label}#${rows.length}`;
  try { console.time(`muzz:${step}`); } catch { /* duplicate step name */ }
  lastTimed = step;
  try { console.timeLog('muzz-login', label); } catch { /* overall timer missing */ }
  const at = globalThis.performance && typeof performance.now === 'function' ? performance.now() : Date.now();
  const first = rows.length ? rows[0].at : at;
  const wall = new Date().toISOString();
  const row = { label, at, delta: at - first, wall };
  rows.push(row);
  try { console.log('[muzz]', wall, label); } catch { /* console closed */ }
  try {
    if (typeof globalThis.muzzDebugLog === 'function') globalThis.muzzDebugLog(wall, label);
  } catch { /* overlay missing */ }
  return row;
}

export function resetLoginTiming() {
  globalThis.__muzzTimes = [];
  globalThis.__muzzTimer = false;
  lastTimed = '';
}

export function isMetaMaskChoice(choice) {
  if (!choice) return false;
  const id = String(choice.id || choice.wcId || '').toLowerCase();
  if (id === METAMASK_WC_ID || id === 'metamask') return true;
  const name = String(choice.name || '').toLowerCase();
  if (name.includes('metamask')) return true;
  const href = String(choice.href || '').toLowerCase();
  return href.startsWith('metamask:') || href.includes('metamask.app.link');
}

export const ONE_CLICK_TIMEOUT_MS = 20_000;

/**
 * MetaMask Mobile does not advertise wc_sessionAuthenticate and mishandles SIWE
 * inside the connect proposal. One-click is only for a wallet that says so.
 */
export function walletAdvertisesOneClick(choice) {
  if (!choice || isMetaMaskChoice(choice)) return false;
  if (choice.oneClick === true || choice.sessionAuthenticate === true) return true;
  const methods = choice.methods;
  return Array.isArray(methods) && methods.includes('wc_sessionAuthenticate');
}

/** Plain connect unless this wallet explicitly advertises one-click auth. */
export function shouldUsePlainConnect(choice) {
  return !walletAdvertisesOneClick(choice);
}

export function loginConnectParams(params, oneClick, auth) {
  const next = { ...(params || {}) };
  if (!oneClick) {
    delete next.authentication;
    return next;
  }
  if (auth) next.authentication = [auth];
  return next;
}

/**
 * Prefer a normal session proposal. One-click runs only when the wallet
 * advertises it. An error or timeout starts a plain connect. A session that
 * comes back without a valid CACAO is kept, and the page asks for one personal_sign.
 */
export async function connectForLogin({ choice, connect, timeoutMs = ONE_CLICK_TIMEOUT_MS, hasCacao } = {}) {
  if (!walletAdvertisesOneClick(choice)) {
    const session = await connect({ plain: true, fallback: false });
    return { session, plain: true, fallback: false, needsPersonalSign: true };
  }
  let timer;
  let attempt;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('one-click timed out');
      err.code = 'one_click_timeout';
      reject(err);
    }, timeoutMs);
  });
  try {
    attempt = connect({ plain: false, fallback: false });
    const session = await Promise.race([attempt, timeout]);
    clearTimeout(timer);
    const cacao = typeof hasCacao === 'function' ? Boolean(hasCacao(session)) : false;
    if (!cacao) {
      return { session, plain: true, fallback: true, reason: 'no_cacao', needsPersonalSign: true };
    }
    return { session, plain: false, fallback: false, needsPersonalSign: false };
  } catch (err) {
    clearTimeout(timer);
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    const session = await connect({ plain: true, fallback: true });
    return {
      session,
      plain: true,
      fallback: true,
      reason: (err && err.code) || 'one_click_error',
      needsPersonalSign: true
    };
  }
}

export function noteWalletChoice(choice) {
  if (!choice) return null;
  pendingChoice = {
    id: choice.id || choice.wcId || '',
    name: choice.name || '',
    href: choice.href || ''
  };
  if (!pendingChoice.href && isMetaMaskChoice(pendingChoice)) {
    const ua = (globalThis.navigator && navigator.userAgent) || '';
    pendingChoice.href = /iPad|iPhone|iPod/i.test(ua) ? 'https://metamask.app.link/' : 'metamask:///';
  }
  try {
    if (pendingChoice.href || pendingChoice.name) {
      globalThis.localStorage?.setItem(DEEPLINK_KEY, JSON.stringify({
        href: pendingChoice.href,
        name: pendingChoice.name
      }));
    }
    if (pendingChoice.name || pendingChoice.id) {
      globalThis.sessionStorage?.setItem('muzz_wc_wallet', pendingChoice.name || pendingChoice.id);
    }
  } catch {
    /* private mode */
  }
  return pendingChoice;
}

export function readWalletChoice() {
  if (pendingChoice && (pendingChoice.name || pendingChoice.id || pendingChoice.href)) return pendingChoice;
  try {
    const raw = globalThis.localStorage?.getItem(DEEPLINK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.href || parsed.name || parsed.id)) return parsed;
    }
  } catch {
    /* storage unavailable */
  }
  try {
    const name = globalThis.sessionStorage?.getItem('muzz_wc_wallet') || '';
    if (name) return noteWalletChoice({ name });
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function authConnectParams(auth) {
  const params = authRequestParams(auth);
  if (!params.ttl || params.ttl < PROPOSE_TTL_FLOOR_S) params.ttl = PROPOSE_TTL_FLOOR_S;
  return params;
}

/**
 * Plain connect for MetaMask and for an unknown wallet. Never calls authenticate():
 * that promise waits at least AUTHENTICATE_WAIT_FLOOR_MS even after the session is approved.
 * onSession runs in the same turn the session promise resolves.
 */
export async function settleLoginConnection({ choice, connect, onSession, mark = muzzMark, timeoutMs, hasCacao } = {}) {
  const result = await connectForLogin({
    choice,
    timeoutMs,
    hasCacao,
    connect: async (plan) => {
      mark(plan.plain ? 'wc:proposal:plain' : 'wc:proposal:one-click');
      if (plan.plain) mark('wc:authenticate:skipped');
      return connect({
        plain: plan.plain,
        authentication: plan.plain ? undefined : true,
        fallback: Boolean(plan.fallback)
      });
    }
  });
  mark('session');
  if (onSession) await onSession(result.session, result);
  return result;
}

export function buildSignDeepLink({ href, name, id, topic, requestId, userAgent } = {}) {
  const query = `requestId=${encodeURIComponent(requestId || '')}&sessionTopic=${encodeURIComponent(topic || '')}`;
  const choice = { href, name, id };
  const ios = /iPad|iPhone|iPod/i.test(userAgent || '');
  if (isMetaMaskChoice(choice)) {
    if (ios || /metamask\.app\.link/i.test(String(href || ''))) return `https://metamask.app.link/wc?${query}`;
    return `metamask://wc?${query}`;
  }
  let base = String(href || '');
  if (!base) return '';
  if (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}/wc?${query}`;
}

function fallbackOpen(href) {
  const target = /^https?:/i.test(href) ? '_blank' : '_self';
  let opened = null;
  try {
    opened = typeof globalThis.open === 'function' ? globalThis.open(href, target, 'noreferrer noopener') : null;
  } catch {
    opened = null;
  }
  if (!opened && globalThis.location && typeof globalThis.location.assign === 'function') {
    globalThis.location.assign(href);
  }
}

function defaultSignOpen(href) {
  const Cap = globalThis.Capacitor;
  if (Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform() && typeof Cap.registerPlugin === 'function') {
    try {
      const WalletLink = Cap.registerPlugin('WalletLink');
      Promise.resolve(WalletLink.open({ url: href })).catch(() => fallbackOpen(href));
      return;
    } catch {
      /* the WebView can still open the scheme */
    }
  }
  fallbackOpen(href);
}

/** Opens the wallet even when document.hasFocus() is false. WalletConnect skips that case. */
export function openSignDeepLink(provider, opener, requestId) {
  const choice = readWalletChoice() || {};
  const href = buildSignDeepLink({
    href: choice.href,
    name: choice.name,
    id: choice.id || choice.wcId,
    topic: (provider && provider.session && provider.session.topic) || '',
    requestId: requestId == null ? '' : String(requestId),
    userAgent: (globalThis.navigator && navigator.userAgent) || ''
  });
  if (!href) {
    muzzMark('deeplink:skip');
    return '';
  }
  const now = Date.now();
  if (!opener && now - lastSignHrefAt < 800) return href;
  lastSignHrefAt = now;
  muzzMark('deeplink');
  const open = opener || defaultSignOpen;
  try { open(href); } catch { /* the request is already on the relay */ }
  return href;
}

/**
 * Open the wallet in the same turn the signature request is published.
 * A setTimeout here is clamped to ~30s while iOS Safari is in MetaMask.
 */
export function scheduleSignDeepLink(provider, opener) {
  let opened = false;
  const open = (payload) => {
    if (opened) return;
    opened = true;
    const id = payload && payload.id != null ? payload.id : '';
    openSignDeepLink(provider, opener, id);
  };
  const events = provider && provider.client && provider.client.events;
  if (events && typeof events.once === 'function') events.once('session_request_sent', open);
  return open;
}

/** IndexedDB persist must not sit in front of personal_sign. Safari defers it while MetaMask is open. */
export function releaseStorageWait(provider) {
  if (!provider || typeof provider.persist !== 'function' || provider.__muzzPersist) return provider;
  const original = provider.persist.bind(provider);
  provider.persist = (key, value) => {
    try {
      const write = original(key, value);
      if (write && typeof write.catch === 'function') write.catch(() => {});
    } catch {
      /* the signature request cannot wait for storage */
    }
    return Promise.resolve();
  };
  provider.__muzzPersist = true;
  return provider;
}

if (typeof globalThis !== 'undefined') {
  globalThis.muzzMark = muzzMark;
  globalThis.muzzOpenSign = scheduleSignDeepLink;
  globalThis.muzzNoteWallet = noteWalletChoice;
  globalThis.muzzProofFromSession = proofFromSession;
}
