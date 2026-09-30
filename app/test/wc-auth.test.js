import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Wallet } from 'ethers';
import { ONE_HOUR, toMiliseconds } from '@walletconnect/time';
import { formatMessage } from '@walletconnect/utils';
import { proveLogin } from '../server/login-proof.js';
import {
  AUTH_CHAINS,
  AUTH_METHODS,
  AUTHENTICATE_WAIT_FLOOR_MS,
  METAMASK_WC_ID,
  buildAuthStatement,
  buildOneClickAuth,
  buildSignDeepLink,
  cacaoProof,
  createSingleFlight,
  hasLiveSession,
  noteWalletChoice,
  resetLoginTiming,
  releaseStorageWait,
  scheduleSignDeepLink,
  settleLoginConnection,
  ONE_CLICK_TIMEOUT_MS,
  connectForLogin,
  loginConnectParams,
  shouldUsePlainConnect,
  walletAdvertisesOneClick
} from '../src/wc-auth.js';

test('one-click auth puts SIWE and ReCap in one proposal and never asks to switch chain', () => {
  const auth = buildOneClickAuth({
    domain: 'muzzsnap-app.vercel.app',
    uri: 'https://muzzsnap-app.vercel.app/login.html',
    nonce: 'ab'.repeat(16),
    exp: Date.now() + 60_000
  });
  assert.deepEqual(auth.chains, AUTH_CHAINS);
  assert.deepEqual(auth.methods, AUTH_METHODS);
  assert.equal(auth.methods.includes('wallet_switchEthereumChain'), false);
  assert.equal(auth.methods.includes('wallet_addEthereumChain'), false);
  assert.equal(auth.domain, 'muzzsnap-app.vercel.app');
  assert.equal(auth.uri, 'https://muzzsnap-app.vercel.app/login.html');
  assert.match(auth.statement, /^MuzzSnap Login/);
  assert.match(auth.statement, /Chain ID: 1/);
  assert.match(auth.statement, /Nonce: abababababababababababababababab/);
  assert.match(auth.resources[0], /^urn:recap:/);
  const source = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');
  assert.match(source, /if \(hasLiveSession\(universalProvider\)\) return Promise\.resolve\(universalProvider\.session\)/);
  assert.match(source, /if \(connectPromise && latestUri\) return connectPromise/);
});

test('a one-click SIWE signature is a valid login proof on chain 1 or 56', async () => {
  const wallet = Wallet.createRandom();
  const nonce = 'cd'.repeat(16);
  const exp = Date.now() + 60_000;
  const auth = buildOneClickAuth({
    domain: 'muzzsnap-app.vercel.app',
    uri: 'https://muzzsnap-app.vercel.app/login.html',
    nonce,
    exp
  });
  for (const chain of ['eip155:1', 'eip155:56']) {
    const iss = `did:pkh:${chain}:${wallet.address}`;
    const payload = {
      domain: auth.domain,
      aud: auth.uri,
      nonce: auth.nonce,
      version: '1',
      iat: new Date().toISOString(),
      exp: auth.exp,
      statement: auth.statement,
      resources: auth.resources
    };
    const message = formatMessage(payload, iss);
    const signature = await wallet.signMessage(message);
    const cacao = { p: { ...payload, iss }, s: { t: 'eip191', s: signature } };
    const proof = cacaoProof(cacao);
    assert.equal(proof.address, wallet.address.toLowerCase());
    assert.equal(proveLogin(proof.message, proof.signature, Date.now()).wallet, wallet.address.toLowerCase());
    if (chain === 'eip155:56') assert.match(proof.message, /Chain ID: 56/);
  }
  const statement = buildAuthStatement({ nonce, exp });
  assert.match(statement, /Minimum: 10000000 MUZZ/);
  const foreign = formatMessage({
    domain: 'evil.example',
    aud: 'https://evil.example',
    nonce,
    version: '1',
    iat: new Date().toISOString(),
    statement: 'Sign in',
    resources: auth.resources
  }, `did:pkh:eip155:1:${wallet.address}`);
  assert.equal(proveLogin(foreign, await wallet.signMessage(foreign), Date.now()), null);
});

test('hasLiveSession and the login lock ignore a second call', async () => {
  assert.equal(hasLiveSession(null), false);
  assert.equal(hasLiveSession({ session: { topic: 't' } }), false);
  assert.equal(hasLiveSession({
    session: { topic: 't', namespaces: { eip155: { accounts: ['eip155:56:0x' + 'ab'.repeat(20)] } } }
  }), true);
  const flight = createSingleFlight();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = flight(async () => {
    calls += 1;
    await gate;
    return 'ok';
  });
  const second = flight(async () => {
    calls += 1;
    return 'no';
  });
  assert.equal(second, first);
  release();
  assert.equal(await first, 'ok');
  assert.equal(calls, 1);
  const third = flight(async () => {
    calls += 1;
    return 'next';
  });
  assert.equal(await third, 'next');
  assert.equal(calls, 2);
});

test('MetaMask skips the one-hour authenticate wait and signs as soon as the session exists', async () => {
  const beforeMs = toMiliseconds(ONE_HOUR);
  assert.equal(ONE_HOUR, 3600);
  assert.equal(beforeMs, 3_600_000);
  assert.equal(AUTHENTICATE_WAIT_FLOOR_MS, beforeMs);
  const signSrc = readFileSync(new URL('../node_modules/@walletconnect/sign-client/dist/index.js', import.meta.url), 'utf8');
  assert.match(signSrc, /g>N\.wc_sessionAuthenticate\.req\.ttl\?g:N\.wc_sessionAuthenticate\.req\.ttl/);
  let oldSigned = false;
  const hung = new Promise(() => {});
  const raced = await Promise.race([
    hung.then(() => {
      oldSigned = true;
      return 'signed';
    }),
    new Promise((resolve) => setTimeout(() => resolve('blocked'), 40))
  ]);
  assert.equal(raced, 'blocked');
  assert.equal(oldSigned, false);

  resetLoginTiming();
  const started = performance.now();
  const calls = [];
  await settleLoginConnection({
    choice: { id: METAMASK_WC_ID, name: 'MetaMask', href: 'metamask:///' },
    connect: async (plan) => {
      calls.push(plan.plain ? 'plain' : 'one-click');
      assert.equal(plan.authentication, undefined);
      return { topic: 'topic-1' };
    },
    onSession: async () => {
      calls.push('personal_sign');
    }
  });
  const afterMs = performance.now() - started;
  assert.deepEqual(calls, ['plain', 'personal_sign']);
  assert.ok(afterMs < 100, `after ${afterMs}ms before-floor ${beforeMs}ms`);
  console.log(`muzz-login measured before=${beforeMs}ms after=${afterMs.toFixed(3)}ms`);

  let trustPlan = null;
  await settleLoginConnection({
    choice: { name: 'Trust Wallet', id: 'trust' },
    connect: async (plan) => {
      trustPlan = plan;
      return { topic: 'trust' };
    }
  });
  assert.equal(trustPlan.plain, true);
  assert.equal(trustPlan.authentication, undefined);
  assert.equal(shouldUsePlainConnect(null), true);
  assert.equal(shouldUsePlainConnect({ name: 'Trust Wallet' }), true);
  assert.equal(shouldUsePlainConnect({ name: 'MetaMask' }), true);
  assert.equal(
    buildSignDeepLink({ name: 'MetaMask', href: 'metamask:///', topic: 'abc', requestId: '9', userAgent: 'Mozilla Android' }),
    'metamask://wc?requestId=9&sessionTopic=abc'
  );
  assert.equal(
    buildSignDeepLink({ name: 'MetaMask', href: 'metamask:///', topic: 'abc', requestId: '', userAgent: 'Mozilla iPhone' }),
    'https://metamask.app.link/wc?requestId=&sessionTopic=abc'
  );
  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/login-client.js', import.meta.url), 'utf8');
  const balanceStart = client.indexOf("log('balance:start ");
  const signCall = client.indexOf("method: 'personal_sign'");
  assert.ok(balanceStart > 0 && signCall > balanceStart);
  assert.match(client, /\/api\/session\?op=nonce/);
  assert.doesNotMatch(login, /preloadWalletConnect|prefetchLoginNonce|signInWithProvider|accessWithWallet/);
  assert.doesNotMatch(client, /authenticate\(/);
  const walletSrc = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');
  assert.match(walletSrc, /plainConnect/);
  assert.match(walletSrc, /return createAppKit\(/);
  assert.doesNotMatch(walletSrc, /modal\.ready\s*\(/);
  assert.match(walletSrc, /releaseConnectLock/);
  assert.doesNotMatch(walletSrc, /authenticate\(/);
  assert.doesNotMatch(walletSrc, /await connectPromise/);
  assert.match(walletSrc, /modal\.open\(\)/);
  assert.match(walletSrc, /Math\.min\(hooks\.waitMs == null \? 800/);
  assert.doesNotMatch(walletSrc, /setInterval/);
  assert.match(walletSrc, /releaseStorageWait/);
  assert.match(walletSrc, /closeModal\(modal\);\n  return finishConnect/);
  const signClient = readFileSync(new URL('../node_modules/@walletconnect/sign-client/dist/index.js', import.meta.url), 'utf8');
  assert.match(signClient, /methods:\["wc_sessionAuthenticate"\]/);
});

test('storage and the signature deep link do not wait', async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const provider = { persist: () => blocked };
  releaseStorageWait(provider);
  const storageStarted = performance.now();
  await provider.persist('namespaces', { eip155: { accounts: ['eip155:1:0xabc'] } });
  const storageMs = performance.now() - storageStarted;
  assert.ok(storageMs < 30, `storage ${storageMs}ms`);
  release();
  await blocked;

  noteWalletChoice({ name: 'MetaMask', href: 'metamask:///' });
  let opened = '';
  const listeners = [];
  const wcProvider = {
    session: { topic: 'topic-1' },
    client: { events: { once(name, fn) { listeners.push({ name, fn }); } } }
  };
  const linkStarted = performance.now();
  scheduleSignDeepLink(wcProvider, (href) => {
    opened = href;
  });
  assert.equal(opened, '');
  assert.equal(listeners[0].name, 'session_request_sent');
  listeners[0].fn();
  const linkMs = performance.now() - linkStarted;
  assert.match(opened, /^metamask:\/\/wc\?/);
  assert.ok(linkMs < 50, `deeplink ${linkMs}ms`);
  console.log(`muzz-login storage=${storageMs.toFixed(3)}ms deeplink=${linkMs.toFixed(3)}ms`);
});

test('a stuck login lock can be reset and the next tap runs', async () => {
  const flight = createSingleFlight();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = flight(async () => {
    await gate;
    return 'stuck';
  });
  assert.equal(flight(async () => 'no'), first);
  flight.reset();
  const next = flight(async () => 'next');
  assert.notEqual(next, first);
  assert.equal(await next, 'next');
  release();
  assert.equal(await first, 'stuck');
});

test('MetaMask uses a plain connect, and one-click falls back after a timeout or a bad CACAO', async () => {
  assert.equal(walletAdvertisesOneClick(null), false);
  assert.equal(walletAdvertisesOneClick({ name: 'MetaMask', oneClick: true }), false);
  assert.equal(walletAdvertisesOneClick({ name: 'Trust Wallet' }), false);
  assert.equal(walletAdvertisesOneClick({ name: 'Example', oneClick: true }), true);
  assert.equal(walletAdvertisesOneClick({ name: 'Example', methods: ['wc_sessionAuthenticate'] }), true);
  assert.equal(shouldUsePlainConnect({ name: 'MetaMask' }), true);
  assert.equal(shouldUsePlainConnect({ name: 'Example', oneClick: true }), false);
  assert.equal(ONE_CLICK_TIMEOUT_MS, 20_000);
  const stripped = loginConnectParams({ authentication: [{ statement: 'SIWE' }], namespaces: {} }, false, null);
  assert.equal(stripped.authentication, undefined);
  const opted = loginConnectParams({ namespaces: {} }, true, { nonce: 'ab' });
  assert.deepEqual(opted.authentication, [{ nonce: 'ab' }]);

  const metamaskCalls = [];
  const metamask = await connectForLogin({
    choice: { name: 'MetaMask', id: METAMASK_WC_ID },
    connect: async (plan) => {
      metamaskCalls.push(plan);
      return { topic: 'mm' };
    }
  });
  assert.equal(metamaskCalls.length, 1);
  assert.equal(metamaskCalls[0].plain, true);
  assert.equal(metamask.needsPersonalSign, true);
  assert.equal(metamask.fallback, false);

  const cacaoCalls = [];
  const withCacao = await connectForLogin({
    choice: { name: 'Example', oneClick: true },
    hasCacao: () => true,
    connect: async (plan) => {
      cacaoCalls.push(plan.plain ? 'plain' : 'one-click');
      return { topic: 'cacao' };
    }
  });
  assert.deepEqual(cacaoCalls, ['one-click']);
  assert.equal(withCacao.needsPersonalSign, false);

  const missingCalls = [];
  const missing = await connectForLogin({
    choice: { name: 'Example', sessionAuthenticate: true },
    hasCacao: () => false,
    connect: async (plan) => {
      missingCalls.push(plan.plain ? 'plain' : 'one-click');
      return { topic: 'session-only' };
    }
  });
  assert.deepEqual(missingCalls, ['one-click']);
  assert.equal(missing.reason, 'no_cacao');
  assert.equal(missing.needsPersonalSign, true);

  const timeoutCalls = [];
  const timed = await connectForLogin({
    choice: { name: 'Example', oneClick: true },
    timeoutMs: 20,
    connect: async (plan) => {
      timeoutCalls.push(plan.plain ? 'plain' : 'one-click');
      if (!plan.plain) return new Promise(() => {});
      return { topic: 'plain-after-timeout' };
    }
  });
  assert.deepEqual(timeoutCalls, ['one-click', 'plain']);
  assert.equal(timed.reason, 'one_click_timeout');
  assert.equal(timed.session.topic, 'plain-after-timeout');
  assert.equal(timed.needsPersonalSign, true);

  const errorCalls = [];
  const failed = await connectForLogin({
    choice: { name: 'Example', methods: ['wc_sessionAuthenticate'] },
    connect: async (plan) => {
      errorCalls.push(Boolean(plan.fallback));
      if (!plan.plain) throw Object.assign(new Error('wallet rejected auth'), { code: 'rejected' });
      return { topic: 'plain-after-error' };
    }
  });
  assert.deepEqual(errorCalls, [false, true]);
  assert.equal(failed.reason, 'rejected');
  assert.equal(failed.session.topic, 'plain-after-error');

  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../www/js/login-page.js', import.meta.url), 'utf8');
  assert.match(login, /v1\.0\.21/);
  assert.match(login, />Copy log</);
  assert.match(page, /muzz_debug_log/);
  assert.match(page, /Copy log|copyLog/);
  assert.doesNotMatch(login, /connect:timeout|rememberSignRequest|personal_sign:suppressed|resume:wait/);
  assert.doesNotMatch(page, /wc_sessionAuthenticate|one-click/);
  const pub = readFileSync(new URL('../www/config.public.js', import.meta.url), 'utf8');
  assert.match(pub, /8ff03dad157892146048cfe2b4e381ca/);
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /android:scheme="muzzsnap"/);
  assert.match(manifest, /android:host="wc"/);
  assert.match(readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8'), /applicationId "app\.muzzsnap\.chat"/);
  const catalog = readFileSync(new URL('../src/walletCatalog.js', import.meta.url), 'utf8');
  assert.match(catalog, /muzzsnap:\/\/wc/);
  const walletSrc = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');
  assert.match(walletSrc, /native: nativeReturnUrl\(url\)/);
  assert.match(walletSrc, /host === 'localhost'/);
});
