import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ethers } from 'ethers';
import { SUPPORTED_WALLETS } from '../src/walletCatalog.js';
import { mapWalletError, walletMessage } from '../src/walletErrors.js';
import { inAppWalletId, walletDeepLinks } from '../src/walletLinks.js';
import { discoverInjected, isMainnet, normalizeChainId, openSession, signLogin } from '../src/walletSession.js';

function mockProvider(wallet, options = {}) {
  let chain = options.chainId || '0x1';
  const calls = [];
  const provider = {
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet.address];
      if (method === 'eth_chainId') return chain;
      if (method === 'wallet_switchEthereumChain') {
        if (options.rejectSwitch) {
          const err = new Error('user rejected the request');
          err.code = 4001;
          throw err;
        }
        chain = params[0].chainId;
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        chain = params[0].chainId;
        return null;
      }
      if (method === 'personal_sign') {
        if (options.rejectSign) {
          const err = new Error('user denied');
          err.code = 4001;
          throw err;
        }
        return wallet.signMessage(ethers.toUtf8String(params[0]));
      }
      throw new Error(`método no simulado: ${method}`);
    }
  };
  return provider;
}

function fakeWindow(announcements, extra = {}) {
  const announceListeners = new Set();
  return {
    ...extra,
    addEventListener(type, fn) {
      if (type === 'eip6963:announceProvider') announceListeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'eip6963:announceProvider') announceListeners.delete(fn);
    },
    dispatchEvent(event) {
      if (event.type !== 'eip6963:requestProvider') return true;
      for (const detail of announcements) {
        for (const fn of announceListeners) fn({ type: 'eip6963:announceProvider', detail });
      }
      return true;
    }
  };
}

test('EIP-6963 detecta las wallets pedidas y no duplica el mismo provider', async () => {
  const providers = SUPPORTED_WALLETS.map((wallet) => ({ wallet, provider: { request() {} } }));
  const root = fakeWindow(providers.map(({ wallet, provider }) => ({
    info: { rdns: wallet.rdns, name: wallet.name, uuid: wallet.id },
    provider
  })), { ethereum: providers[0].provider });
  const found = await discoverInjected(root, 0);
  assert.equal(found.length, SUPPORTED_WALLETS.length);
  for (const wallet of SUPPORTED_WALLETS) {
    assert.ok(found.some((item) => item.id === wallet.id && item.rdns === wallet.rdns));
  }
});

test('sin anuncio EIP-6963 sigue viendo Phantom y MetaMask globales', async () => {
  const phantom = { request() {} };
  const metamask = { request() {}, isMetaMask: true };
  const root = fakeWindow([], { phantom: { ethereum: phantom }, ethereum: metamask });
  const found = await discoverInjected(root, 0);
  assert.deepEqual(found.map((item) => item.id).sort(), ['metamask', 'phantom']);
});

test('mainnet acepta 1, 0x1 y eip155:1', async () => {
  for (const value of [1, '1', '0x1', '0x01', 'eip155:1']) {
    assert.equal(isMainnet(value), true, String(value));
    assert.equal(normalizeChainId(value), '0x1');
  }
  assert.equal(isMainnet(137), false);
  assert.equal(isMainnet('0x89'), false);
  assert.equal(isMainnet('eip155:137'), false);
  const wallet = ethers.Wallet.createRandom();
  const provider = mockProvider(wallet, { chainId: 1 });
  const session = await openSession(provider);
  assert.equal(session.address, wallet.address.toLowerCase());
  assert.equal(provider.calls.includes('wallet_switchEthereumChain'), false);
});

test('la wallet simulada firma, cambia a mainnet y la firma se verifica', async () => {
  const wallet = ethers.Wallet.createRandom();
  const provider = mockProvider(wallet, { chainId: '0xaa36a7' });
  let phase = '';
  const session = await openSession(provider, { onPhase: (next) => { phase = next; } });
  assert.equal(phase, 'chain');
  assert.equal(session.address, wallet.address.toLowerCase());
  assert.ok(provider.calls.includes('wallet_switchEthereumChain'));
  assert.equal(normalizeChainId(await provider.request({ method: 'eth_chainId' })), '0x1');
  const message = 'MuzzSnap prueba de firma';
  const signature = await signLogin(provider, session.address, message);
  assert.equal(ethers.verifyMessage(message, signature).toLowerCase(), session.address);
});

test('rechazar el cambio de red o la firma se explica en inglés', async () => {
  const wallet = ethers.Wallet.createRandom();
  await assert.rejects(
    openSession(mockProvider(wallet, { chainId: '0x89', rejectSwitch: true })),
    (err) => err.code === 'chain'
  );
  assert.match(walletMessage('chain'), /Wrong network/);
  const onMainnet = mockProvider(wallet, { rejectSign: true });
  await assert.rejects(
    signLogin(onMainnet, wallet.address, 'hello'),
    (err) => err.code === 'rejected'
  );
  assert.match(walletMessage('rejected'), /Signature rejected/);
  assert.match(walletMessage('NO_WALLET'), /Wallet not installed/);
  assert.match(walletMessage('disconnected'), /disconnected/);
  assert.match(walletMessage('NO_PROJECT_ID'), /cloud\.reown\.com/);
  const pending = mapWalletError(Object.assign(new Error('request already pending'), { code: -32002 }));
  assert.equal(pending.code, 'pending');
});

test('los deep links de móvil apuntan a la página y el APK vuelve por muzzsnap', () => {
  const page = 'http://127.0.0.1:4173/?view=login';
  const links = walletDeepLinks(page);
  assert.equal(links.length, 6);
  const metamask = links.find((item) => item.id === 'metamask');
  assert.match(metamask.href, /^https:\/\/metamask\.app\.link\/dapp\/127\.0\.0\.1:4173\//);
  for (const item of links) {
    if (item.id === 'metamask') continue;
    assert.match(item.href, /127\.0\.0\.1/);
  }
  assert.equal(inAppWalletId('Mozilla Trust/1.0'), 'trust');
  assert.equal(inAppWalletId('Mozilla CoinbaseWallet'), 'coinbase');
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /android:scheme="muzzsnap"/);
  assert.match(manifest, /android:host="wc"/);
  const runtime = readFileSync(new URL('../www/config.runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /walletConnectProjectId:\s*''/);
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /config\.local\.json/);
  assert.match(ignore, /^\.env$/m);
  const source = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');
  assert.match(source, /@reown\/appkit/);
  assert.match(source, /enableEIP6963:\s*true/);
  assert.match(source, /featuredWalletIds/);
  for (const wallet of SUPPORTED_WALLETS) {
    assert.match(wallet.wcId, /^[a-f0-9]{64}$/);
  }
});
