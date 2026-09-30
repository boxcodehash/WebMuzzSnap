import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ethers } from 'ethers';
import { SUPPORTED_WALLETS } from '../src/walletCatalog.js';
import { mapWalletError, walletMessage } from '../src/walletErrors.js';
import { inAppWalletId, isInAppBrowserLink, rewriteWalletOpen, walletDeepLinks } from '../src/walletLinks.js';
import { discoverInjected, firstEvmAddress, ignoreChainSwitch, isMainnet, normalizeChainId, openSession, signLogin } from '../src/walletSession.js';

function mockProvider(wallet, options = {}) {
  let chain = options.chainId || '0x1';
  const calls = [];
  const provider = {
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (method === 'eth_requestAccounts') return options.emptyRequest ? [] : [wallet.address];
      if (method === 'eth_accounts') return options.emptyAccounts ? [] : [wallet.address];
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

function approve(provider, wallet, chains) {
  provider.session = {
    namespaces: {
      eip155: {
        chains,
        accounts: chains.map((chain) => `${chain}:${wallet.address}`)
      }
    }
  };
  return provider;
}

test('mainnet acepta 1, 0x1 y eip155:1', async () => {
  for (const value of [1, '1', '0x1', '0x01', 'eip155:1', 'eip155:1:0xabc']) {
    assert.equal(isMainnet(value), true, String(value));
    assert.equal(normalizeChainId(value), '0x1');
  }
  assert.equal(isMainnet(137), false);
  assert.equal(isMainnet('0x89'), false);
  assert.equal(isMainnet('eip155:137'), false);
  const wallet = ethers.Wallet.createRandom();
  for (const chainId of [1, '0x1']) {
    const provider = mockProvider(wallet, { chainId });
    const session = await openSession(provider);
    assert.equal(session.address, wallet.address.toLowerCase());
    assert.equal(provider.calls.includes('wallet_switchEthereumChain'), false);
  }
});

test('56, 0x1, 1 y solo eip155:56 llegan a personal_sign sin cambiar de red', async () => {
  const wallet = ethers.Wallet.createRandom();
  const message = 'MuzzSnap login';
  for (const chainId of [56, '0x1', 1, '0x38']) {
    const provider = mockProvider(wallet, { chainId, rejectSwitch: true });
    const session = await openSession(provider);
    assert.equal(session.address, wallet.address.toLowerCase());
    assert.equal(provider.calls.includes('wallet_switchEthereumChain'), false);
    assert.equal(provider.calls.includes('wallet_addEthereumChain'), false);
    const signature = await signLogin(provider, session.address, message);
    assert.equal(ethers.verifyMessage(message, signature).toLowerCase(), session.address);
    assert.equal(provider.calls.includes('wallet_switchEthereumChain'), false);
  }
  const only56 = approve(mockProvider(wallet, { chainId: 56, rejectSwitch: true, emptyRequest: true, emptyAccounts: true }), wallet, ['eip155:56']);
  assert.equal(firstEvmAddress(only56, []), wallet.address.toLowerCase());
  const session = await openSession(only56);
  assert.equal(session.address, wallet.address.toLowerCase());
  assert.equal(only56.calls.includes('wallet_switchEthereumChain'), false);
  const signature = await signLogin(only56, session.address, message);
  assert.equal(ethers.verifyMessage(message, signature).toLowerCase(), session.address);
});

test('wallet_switchEthereumChain no se reenvía y la firma rechazada se explica', async () => {
  const wallet = ethers.Wallet.createRandom();
  const provider = mockProvider(wallet, { chainId: '0x89', rejectSwitch: true });
  ignoreChainSwitch(provider);
  assert.equal(await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }), null);
  assert.equal(await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x1' }] }), null);
  assert.equal(provider.calls.includes('wallet_switchEthereumChain'), false);
  assert.equal(await provider.request({ method: 'eth_chainId' }), 1);
  assert.equal(provider.calls.includes('eth_chainId'), false);
  assert.equal(provider.__muzzRealChain, undefined);
  const onPolygon = approve(mockProvider(wallet, { chainId: '0x89' }), wallet, ['eip155:137']);
  ignoreChainSwitch(onPolygon);
  assert.equal(await onPolygon.request({ method: 'eth_chainId' }), 1);
  assert.equal(onPolygon.__muzzRealChain, '0x89');
  assert.equal(onPolygon.calls.includes('eth_chainId'), false);
  assert.equal((await onPolygon.request({ method: 'eth_accounts' }))[0].toLowerCase(), wallet.address.toLowerCase());
  assert.equal(onPolygon.calls.includes('eth_accounts'), false);
  const switched = mapWalletError(new Error('EthersAdapter:connect - Switch network failed'));
  assert.notEqual(switched.code, 'chain');
  assert.doesNotMatch(String(switched.message || ''), /Wrong network/);
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

test('los deep links de móvil son wc nativos y el APK vuelve por muzzsnap', () => {
  const page = 'http://127.0.0.1:4173/?view=login';
  const links = walletDeepLinks(page);
  assert.equal(links.length, 6);
  for (const item of links) {
    assert.doesNotMatch(item.href, /127\.0\.0\.1/);
    assert.doesNotMatch(item.href, /\/dapp\/|\/browse|open_url|dappUrl/);
    assert.match(item.href, /:\/\/wc$/);
  }
  const uri = 'wc:abc@2?relay-protocol=irn&symKey=aa';
  const native = walletDeepLinks(uri);
  const metamask = native.find((item) => item.id === 'metamask');
  assert.match(metamask.href, /^metamask:\/\/wc\?uri=wc%3Aabc%402/);
  assert.match(native.find((item) => item.id === 'phantom').href, /redirect_link=muzzsnap%3A%2F%2Fwc/);
  assert.equal(isInAppBrowserLink('https://metamask.app.link/dapp/muzzsnap-app.vercel.app/login.html'), true);
  assert.equal(isInAppBrowserLink('https://phantom.app/ul/browse/https%3A%2F%2Fexample'), true);
  assert.equal(isInAppBrowserLink('https://link.trustwallet.com/open_url?coin_id=60&url=https%3A%2F%2Fexample'), true);
  assert.equal(isInAppBrowserLink('metamask://wc?uri=wc%3Aabc'), false);
  assert.equal(rewriteWalletOpen('https://metamask.app.link/dapp/muzzsnap-app.vercel.app/login.html', uri), metamask.href);
  assert.equal(rewriteWalletOpen('https://metamask.app.link/dapp/muzzsnap-app.vercel.app/login.html', ''), '');
  assert.equal(
    rewriteWalletOpen('https://metamask.app.link/wc?uri=' + encodeURIComponent(uri), ''),
    metamask.href
  );
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
  assert.match(source, /plainConnect/);
  assert.match(source, /releaseConnectLock/);
  assert.doesNotMatch(source, /authenticate\(/);
  assert.match(source, /loginConnectParams/);
  assert.match(source, /walletAdvertisesOneClick/);
  assert.doesNotMatch(source, /siwe-in-proposal/);
  assert.doesNotMatch(source, /authentication: \[authConnectParams\(currentLoginAuth\(\)\)\]/);
  assert.match(source, /return originalConnect\(/);
  assert.doesNotMatch(source, /await connectPromise/);
  assert.match(source, /hasLiveSession/);
  assert.match(source, /modal\.close/);
  assert.match(source, /method !== 'wallet_switchEthereumChain'/);
  assert.match(source, /@reown\/appkit/);
  assert.match(source, /enableEIP6963:\s*true/);
  assert.match(source, /featuredWalletIds/);
  for (const wallet of SUPPORTED_WALLETS) {
    assert.match(wallet.wcId, /^[a-f0-9]{64}$/);
  }
});
