import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadGate() {
  const context = {
    ethers: { utils: { getAddress: (v) => v, verifyMessage: () => '' } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    location: {
      origin: 'https://muzzsnap-app.vercel.app',
      hostname: 'muzzsnap-app.vercel.app',
      protocol: 'https:',
      host: 'muzzsnap-app.vercel.app'
    },
    URL,
    MUZZ_PUBLIC: { appPublicUrl: 'https://muzzsnap-app.vercel.app', walletConnectProjectId: '' }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../www/js/muzz-gate.js', import.meta.url), 'utf8'), context);
  return context.muzzGate;
}

test('iPhone home screen tags, 16px inputs, and WalletConnect return links', () => {
  const pages = ['login.html', 'chat.html', 'private.html', 'index.html'].map((name) =>
    readFileSync(new URL('../www/' + name, import.meta.url), 'utf8'));
  for (const html of pages) {
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
    assert.match(html, /apple-touch-icon/);
    assert.match(html, /apple-touch-startup-image/);
    assert.match(html, /manifest\.webmanifest/);
  }
  const manifest = JSON.parse(readFileSync(new URL('../www/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'MuzzSnap');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#070708');
  assert.equal(manifest.theme_color, '#070708');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '180x180'));
  const ios = readFileSync(new URL('../www/js/ios-pwa.js', import.meta.url), 'utf8');
  assert.match(ios, /Install MuzzSnap for full screen/);
  assert.match(ios, /Add to Home Screen/);
  assert.match(ios, /Minimize/);
  assert.match(ios, /muzz\.install\.dismissed/);
  assert.match(ios, /touchend/);
  assert.match(ios, /requestFullscreen/);
  assert.match(ios, /muzz-standalone/);
  assert.doesNotMatch(ios, /Install on iPhone/);
  assert.doesNotMatch(ios, /muzz-ios-hint/);
  assert.match(ios, /isStandalone/);
  assert.equal(manifest.start_url, './login.html');
  assert.equal(manifest.scope, './');
  const priv = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  assert.match(priv, /textarea\{[^}]*font-size:16px/);
  assert.match(priv, /people-btn/);
  assert.match(priv, /100dvh/);
  const chat = readFileSync(new URL('../www/chat.html', import.meta.url), 'utf8');
  assert.doesNotMatch(chat, /msg-input \{ font-size: 15px; \}/);
  assert.match(chat, /font-size: 16px/);
  const wallet = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');
  assert.match(wallet, /iPad\|iPhone\|iPod/);
  assert.match(wallet, /NATIVE_RETURN/);
  assert.match(wallet, /\/login\.html/);
  const sw = readFileSync(new URL('../www/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /New private message/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /muzz-sw-update/);
  assert.match(ios, /New version, tap to reload/);
  assert.match(ios, /controlledAtLoad/);
  assert.match(ios, /if \(!controlledAtLoad\) return/);
  assert.doesNotMatch(ios, /hadWorker = true/);
  assert.match(ios, /removeChild/);
  assert.match(ios, /nativeApp\(\)/);
  assert.match(readFileSync(new URL('../www/css/ios-pwa.css', import.meta.url), 'utf8'), /#muzzUpdateBar\[hidden\]/);
  const gate = loadGate();
  const links = gate.walletConnectDeepLinks('wc:abc');
  const names = Array.from(links, (item) => String(item.name)).sort();
  assert.deepEqual(names, ['Coinbase Wallet', 'MetaMask', 'OKX', 'Phantom', 'Rainbow', 'Trust Wallet']);
  const byName = Object.fromEntries(links.map((item) => [item.name, item.href]));
  assert.match(byName.MetaMask, /^metamask:\/\/wc\?uri=wc%3Aabc$/);
  assert.match(byName['Trust Wallet'], /^trust:\/\/wc\?uri=/);
  assert.match(byName['Coinbase Wallet'], /^cbwallet:\/\/wc\?uri=/);
  assert.match(byName.Rainbow, /^rainbow:\/\/wc\?uri=/);
  assert.match(byName.OKX, /^okx:\/\/wc\?uri=wc%3Aabc$/);
  assert.match(byName.Phantom, /^phantom:\/\/wc\?uri=/);
  assert.match(byName.Phantom, /redirect_link=muzzsnap%3A%2F%2Fwc/);
  const dapp = gate.walletDeepLinks('https://muzzsnap-app.vercel.app/login.html#from=apk');
  assert.doesNotMatch(dapp.find((item) => item.name === 'MetaMask').href, /\/dapp\//);
  assert.doesNotMatch(JSON.stringify(dapp), /\/browse|open_url|dappUrl/);
});
