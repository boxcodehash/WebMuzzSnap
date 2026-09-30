import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, verifyMessage } from 'ethers';
import { SignClient } from '@walletconnect/sign-client';
import { getSdkError } from '@walletconnect/utils';
import { readMuzzBalance } from '../src/login-client.js';

const PROJECT_ID = '8ff03dad157892146048cfe2b4e381ca';
const METADATA = {
  name: 'MuzzSnap',
  description: 'Login relay check',
  url: 'https://muzzsnap-app.vercel.app',
  icons: ['https://muzzsnap-app.vercel.app/icons/icon-512.png'],
  redirect: { native: 'muzzsnap://wc' }
};

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async getKeys() { return [...this.map.keys()]; }
  async getEntries() { return [...this.map.entries()]; }
  async getItem(key) { return this.map.has(key) ? this.map.get(key) : undefined; }
  async setItem(key, value) { this.map.set(key, value); }
  async removeItem(key) { this.map.delete(key); }
}

function requestedNamespaces(proposal) {
  const params = proposal.params || proposal;
  const required = params.requiredNamespaces || {};
  const optional = params.optionalNamespaces || {};
  return Object.keys(required).length ? required : optional;
}

function namespacesFor(required, address) {
  const namespaces = {};
  for (const [name, value] of Object.entries(required || {})) {
    const chains = value.chains || [];
    namespaces[name] = {
      accounts: chains.map((chain) => `${chain}:${address}`),
      methods: value.methods || [],
      events: value.events || []
    };
  }
  return namespaces;
}

async function initClient(storage, prefix) {
  return SignClient.init({
    projectId: PROJECT_ID,
    metadata: METADATA,
    storage,
    customStoragePrefix: prefix,
    logger: 'error'
  });
}

async function closeClient(client) {
  if (!client) return;
  try { client.core.heartbeat.stop(); } catch { /* already stopped */ }
  try { await client.core.relayer.subscriber.stop(); } catch { /* already stopped */ }
  try { await client.core.relayer.transportClose(); } catch { /* already closed */ }
}

function within(ms, label, work) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out')), ms);
    Promise.resolve().then(work).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('a scripted wallet on the WalletConnect relay approves, rejects, times out, persists, and drops a stale session', { timeout: 70000 }, async () => {
  const signer = Wallet.createRandom();
  const address = signer.address.toLowerCase();
  const holding = await within(20000, 'balance', () => readMuzzBalance(address));
  assert.equal(holding.ok, false);
  assert.equal(holding.formatted, '0');

  const dappStorage = new MemoryStorage();
  const walletStorage = new MemoryStorage();
  let dapp;
  let wallet;
  let restarted;
  try {
  dapp = await within(20000, 'dapp init', () => initClient(dappStorage, 'muzzdapp'));
  wallet = await within(20000, 'wallet init', () => initClient(walletStorage, 'muzzwallet'));
  const namespaces = {
    eip155: {
      chains: ['eip155:1'],
      methods: ['personal_sign', 'eth_requestAccounts', 'eth_accounts'],
      events: ['chainChanged', 'accountsChanged']
    }
  };

  const proposals = [];
  let rejectNext = false;
  wallet.on('session_proposal', (proposal) => { proposals.push(proposal); });
  wallet.on('session_request', async (event) => {
    const id = event.id;
    const topic = event.topic;
    if (rejectNext) {
      await wallet.respond({
        topic,
        response: { id, jsonrpc: '2.0', error: { code: 4001, message: 'User rejected' } }
      });
      return;
    }
    const text = event.params.request.params[0];
    const signature = await signer.signMessage(text);
    await wallet.respond({ topic, response: { id, jsonrpc: '2.0', result: signature } });
  });

  async function nextProposal(previous) {
    const start = Date.now();
    while (proposals.length === previous && Date.now() - start < 20000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(proposals.length > previous, 'wallet did not receive a session proposal');
    return proposals[proposals.length - 1];
  }

  const first = await within(20000, 'connect', () => dapp.connect({ optionalNamespaces: namespaces }));
  assert.match(first.uri, /^wc:/);
  await within(20000, 'pair', () => wallet.pair({ uri: first.uri }));
  const proposal = await nextProposal(0);
  assert.equal(proposal.params.proposer.metadata.redirect.native, 'muzzsnap://wc');
  assert.equal(proposal.params.proposer.metadata.redirect.universal, undefined);
  const approved = await wallet.approve({
    id: proposal.id,
    namespaces: namespacesFor(requestedNamespaces(proposal), address)
  });
  const session = await within(20000, 'approval', () => first.approval());
  await within(15000, 'ack', () => approved.acknowledged());
  const message = 'MuzzSnap\nWallet: ' + address + '\nNonce: ' + 'ab'.repeat(16);
  const signature = await within(20000, 'personal_sign', () => dapp.request({
    topic: session.topic,
    chainId: 'eip155:1',
    request: { method: 'personal_sign', params: [message, address] }
  }));
  assert.equal(verifyMessage(message, signature).toLowerCase(), address);

  rejectNext = true;
  await assert.rejects(
    within(15000, 'rejected sign', () => dapp.request({
      topic: session.topic,
      chainId: 'eip155:1',
      request: { method: 'personal_sign', params: [message, address] }
    })),
    (err) => /reject/i.test(String(err && (err.message || err)))
  );
  rejectNext = false;

  const pending = await within(15000, 'timeout connect', () => dapp.connect({ optionalNamespaces: namespaces }));
  const timed = await Promise.race([
    pending.approval().then(() => 'approved', () => 'failed'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 1500))
  ]);
  assert.equal(timed, 'timeout');
  const retry = await within(15000, 'retry connect', () => dapp.connect({ optionalNamespaces: namespaces }));
  const beforeRetry = proposals.length;
  await within(15000, 'retry pair', () => wallet.pair({ uri: retry.uri }));
  const retried = await nextProposal(beforeRetry);
  const retryAck = await wallet.approve({
    id: retried.id,
    namespaces: namespacesFor(requestedNamespaces(retried), address)
  });
  const retriedSession = await within(15000, 'retry approval', () => retry.approval());
  await within(15000, 'retry ack', () => retryAck.acknowledged());
  assert.match(retriedSession.topic, /[a-f0-9]/);

  await closeClient(dapp);
  delete globalThis._walletConnectCore_muzzdapp;
  delete globalThis._walletConnectCore_muzzdapp_count;
  restarted = await within(15000, 'restart', () => initClient(dappStorage, 'muzzdapp'));
  assert.ok(restarted.session.getAll().some((item) => item.topic === retriedSession.topic));

  await restarted.disconnect({ topic: retriedSession.topic, reason: getSdkError('USER_DISCONNECTED') });
  await dapp.disconnect({ topic: session.topic, reason: getSdkError('USER_DISCONNECTED') }).catch(() => {});
  assert.equal(restarted.session.getAll().some((item) => item.topic === retriedSession.topic), false);
  } finally {
    for (const client of [dapp, wallet, restarted]) {
      const provider = client && client.core && client.core.relayer && client.core.relayer.provider;
      const socket = provider && provider.connection && provider.connection.socket;
      if (socket && typeof socket.close === 'function') socket.close();
    }
    await closeClient(dapp);
    await closeClient(wallet);
    await closeClient(restarted);
    for (const handle of process._getActiveHandles()) {
      const name = handle && handle.constructor && handle.constructor.name;
      if (name !== 'Socket' && name !== 'TLSSocket') continue;
      if (typeof handle.destroy === 'function') handle.destroy();
      if (typeof handle.unref === 'function') handle.unref();
    }
    delete globalThis._walletConnectCore_muzzdapp;
    delete globalThis._walletConnectCore_muzzdapp_count;
    delete globalThis._walletConnectCore_muzzwallet;
    delete globalThis._walletConnectCore_muzzwallet_count;
  }
});
