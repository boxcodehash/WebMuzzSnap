import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  applySignRecovery,
  createResumeBinder,
  loginWithWallet,
  openWalletForSignature,
  resumeRelay,
  shouldShowSignRecovery,
  SIGN_NUDGE_MS,
  SIGN_STUCK_MS
} from '../src/login-client.js';

function fakeClock() {
  const timers = [];
  let seq = 0;
  let now = 0;
  function schedule(fn, ms) {
    const id = ++seq;
    timers.push({ id, fn, at: now + ms });
    return id;
  }
  function clear(id) {
    const item = timers.find((entry) => entry.id === id);
    if (item) item.fn = null;
  }
  function flushUntil(limit) {
    now = limit;
    for (let guard = 0; guard < 20; guard += 1) {
      const due = timers
        .filter((entry) => entry.fn && entry.at <= now)
        .sort((a, b) => a.at - b.at || a.id - b.id);
      if (!due.length) break;
      const next = due[0];
      const fn = next.fn;
      next.fn = null;
      fn();
    }
  }
  return { schedule, clear, flushUntil };
}

function binderWith(phase, resume, clock) {
  return createResumeBinder({
    resume,
    phase: () => phase.value,
    debounceMs: 1000,
    schedule: clock.schedule,
    clear: clock.clear
  });
}

test('resumeRelay runs on every resume path during the wallet phase', () => {
  const clock = fakeClock();
  const phase = { value: 'wallet' };
  const reasons = [];
  const binder = binderWith(phase, (reason) => reasons.push(reason), clock);

  binder.onReturn();
  clock.flushUntil(1000);
  binder.onVisible('visible');
  clock.flushUntil(2000);
  binder.onAppState({ isActive: true });
  clock.flushUntil(3000);
  binder.onResume();
  clock.flushUntil(4000);
  assert.deepEqual(reasons, ['return', 'visible', 'app', 'resume']);

  reasons.length = 0;
  binder.onReturn();
  binder.onVisible('visible');
  binder.onAppState({ isActive: true });
  binder.onResume();
  clock.flushUntil(5000);
  assert.deepEqual(reasons, ['resume']);
  binder.onVisible('hidden');
  binder.onAppState({ isActive: false });
  clock.flushUntil(9000);
  assert.deepEqual(reasons, ['resume']);
});

test('a signature still waiting 8s after return restarts the relay again', () => {
  const clock = fakeClock();
  const phase = { value: 'sign' };
  const reasons = [];
  const binder = binderWith(phase, (reason) => reasons.push(reason), clock);
  binder.onReturn();
  clock.flushUntil(1000);
  assert.deepEqual(reasons, ['return']);
  clock.flushUntil(1000 + SIGN_NUDGE_MS);
  assert.deepEqual(reasons, ['return', 'sign-nudge']);
  assert.equal(SIGN_NUDGE_MS, 8000);
});

test('the sign watchdog replaces the spinner with Open MetaMask and Retry', () => {
  const stuck = { hidden: true };
  const spinner = { hidden: false };
  assert.equal(shouldShowSignRecovery(SIGN_NUDGE_MS, true), false);
  assert.equal(applySignRecovery({ stuck, spinner }, SIGN_NUDGE_MS, true), false);
  assert.equal(stuck.hidden, true);
  assert.equal(spinner.hidden, false);
  assert.equal(SIGN_STUCK_MS, 45000);
  assert.equal(applySignRecovery({ stuck, spinner }, SIGN_STUCK_MS, true), true);
  assert.equal(stuck.hidden, false);
  assert.equal(spinner.hidden, true);
  assert.equal(applySignRecovery({ stuck, spinner }, SIGN_STUCK_MS, false), false);
  assert.equal(stuck.hidden, true);
  assert.equal(spinner.hidden, false);

  const html = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../www/js/login-page.js', import.meta.url), 'utf8');
  assert.match(html, /Open MetaMask/);
  assert.match(html, /id="signRetry"[^>]*>Retry/);
  assert.match(html, /id="openWalletSign"/);
  assert.match(page, /resumeRelay\(/);
  assert.match(page, /createResumeBinder/);
  assert.match(page, /applySignRecovery/);
  assert.match(page, /appStateChange/);
  assert.match(page, /addListener\('resume'/);
  assert.match(page, /phase = 'sign'/);
  assert.match(page, /deepLinks\(\)/);
  assert.doesNotMatch(page, /if \(!running \|\| phase !== 'connect'\) return/);
  const onVisible = page.slice(page.indexOf('const onVisible'), page.indexOf('const onReturn'));
  const onReturn = page.slice(page.indexOf('const onReturn'), page.indexOf('window.addEventListener(\'muzz-wc-return\''));
  assert.match(onVisible, /binder\.onVisible\('visible'\)/);
  assert.doesNotMatch(onVisible, /phase !== 'connect'/);
  assert.match(onReturn, /binder\.onReturn\(\)/);
  assert.doesNotMatch(onReturn, /phase !== 'connect'/);
});

describe('relay transport', { concurrency: false }, () => {
test('a silently dead relay delivers the queued signature and posts the session', async () => {
  const address = '0x' + 'ab'.repeat(20);
  const signature = '0x' + '55'.repeat(65);
  const records = new Map();
  const handlers = {};
  const relayer = {
    on(name, fn) { handlers[name] = fn; },
    async restartTransport() {
      const record = records.get('topic1:7');
      record.response = { result: signature };
    }
  };
  const history = {
    get(topic, id) { return records.get(topic + ':' + id) || null; },
    records,
    on() {}
  };
  let requested = false;
  const provider = {
    accounts: [address],
    session: { topic: 'topic1' },
    signer: { client: { core: { relayer, history } } },
    request({ method }) {
      if (method !== 'personal_sign') return Promise.resolve(null);
      requested = true;
      records.set('topic1:7', {
        id: 7,
        topic: 'topic1',
        request: { method: 'personal_sign', params: ['m', address] }
      });
      return new Promise(() => {});
    }
  };
  const logs = [];
  const saved = {};
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    setItem(key, value) { saved[key] = String(value); },
    getItem(key) { return Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : null; },
    removeItem(key) { delete saved[key]; }
  };
  let posted = null;
  try {
    const login = loginWithWallet({
      ethereum: null,
      walletId: 'metamask',
      storage: { getItem: () => null, setItem() {}, removeItem() {} },
      log: (line) => logs.push(line),
      connectWc: async () => provider,
      readBalance: () => new Promise(() => {}),
      nonce: async () => ({ nonce: 'ab'.repeat(16), exp: Date.now() + 60_000 }),
      exchange: async (message, sig) => {
        posted = { message, sig };
        return { customToken: 'custom' };
      }
    });
    for (let i = 0; i < 20 && !requested; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(requested, true);
    handlers.relayer_connect();
    handlers.relayer_disconnect();
    assert.ok(logs.includes('relayer_connect'));
    assert.ok(logs.includes('relayer_disconnect'));
    const href = openWalletForSignature({
      walletId: 'metamask',
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile' }
    });
    assert.equal(href, 'metamask://wc?requestId=7&sessionTopic=topic1');
    assert.doesNotMatch(href, /uri=/);
    const restartLogs = [];
    const found = await resumeRelay((line) => restartLogs.push(line));
    assert.equal(found, signature);
    assert.deepEqual(restartLogs, ['relay:restart ok']);
    const result = await login;
    assert.equal(result.customToken, 'custom');
    assert.equal(posted.sig, signature);
    assert.match(posted.message, /Chain ID: 1/);
    assert.equal(saved.WALLETCONNECT_DEEPLINK_CHOICE, JSON.stringify({ href: 'metamask://', name: 'MetaMask' }));
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('resumeRelay logs a failure when the transport cannot restart', async () => {
  const address = '0x' + 'cd'.repeat(20);
  const provider = {
    accounts: [address],
    session: { topic: 'topic2' },
    signer: {
      client: {
        core: {
          relayer: {
            on() {},
            async restartTransport() { throw new Error('socket dead'); }
          },
          history: { get() { return null; }, records: new Map(), on() {} }
        }
      }
    },
    request() { return new Promise(() => {}); }
  };
  const login = loginWithWallet({
    ethereum: null,
    walletId: 'trust',
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    connectWc: async () => provider,
    readBalance: async () => ({ ok: true, formatted: '10,000,000' }),
    nonce: async () => ({ nonce: 'cd'.repeat(16), exp: Date.now() + 60_000 }),
    exchange: async () => ({ customToken: 'nope' })
  });
  login.catch(() => {});
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  const logs = [];
  const found = await resumeRelay((line) => logs.push(line));
  assert.equal(found, '');
  assert.deepEqual(logs, ['relay:restart fail']);
  const trustHref = openWalletForSignature({
    walletId: 'trust',
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' }
  });
  assert.equal(trustHref, 'trust://');
});
});
