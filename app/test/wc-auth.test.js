import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Wallet } from 'ethers';
import { formatMessage } from '@walletconnect/utils';
import { proveLogin } from '../server/login-proof.js';
import {
  AUTH_CHAINS,
  AUTH_METHODS,
  buildAuthStatement,
  buildOneClickAuth,
  cacaoProof,
  createSingleFlight,
  hasLiveSession
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
  assert.match(source, /if \(connectPromise\) return connectPromise/);
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
