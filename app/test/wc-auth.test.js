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
  resetLoginTiming,
  settleLoginConnection,
  shouldUsePlainConnect
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
  const body = login.slice(login.indexOf('async function signInWithProvider'), login.indexOf('async function accessWithWallet'));
  const sent = body.indexOf("window.muzzMark('personal_sign:sent')");
  const balanceStart = body.indexOf("window.muzzMark('balance:start')");
  const balanceAwait = body.indexOf('await balancePromise');
  const api = body.indexOf("window.muzzMark('api:none')");
  assert.ok(balanceStart > 0 && balanceStart < sent);
  assert.ok(api > 0 && sent > api);
  assert.ok(balanceAwait > sent);
  assert.doesNotMatch(body, /fetch\(\s*['"]\/api/);
  assert.match(login, /preloadWalletConnect/);
  assert.match(login, /prefetchLoginNonce/);
  const walletSrc = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');
  assert.match(walletSrc, /plainConnect/);
  assert.match(walletSrc, /releaseConnectLock/);
  assert.doesNotMatch(walletSrc, /authenticate\(/);
  assert.doesNotMatch(walletSrc, /await connectPromise/);
  assert.match(walletSrc, /modal\.open\(\)/);
  assert.match(walletSrc, /Math\.min\(hooks\.waitMs == null \? 800/);
  assert.doesNotMatch(walletSrc, /setInterval/);
  const signClient = readFileSync(new URL('../node_modules/@walletconnect/sign-client/dist/index.js', import.meta.url), 'utf8');
  assert.match(signClient, /methods:\["wc_sessionAuthenticate"\]/);
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
