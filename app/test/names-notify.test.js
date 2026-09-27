import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { isBalanceExempt } from '../functions/src/accessLogic.js';
import { displayName } from '../src/names.js';

const OLD = '0xfab5835ca14fb3f9f978c5e4d733734e6394e03f';
const OLD_B64 = 'MHhmYWI1ODM1Y2ExNGZiM2Y5Zjk3OGM1ZTRkNzMzNzM0ZTYzOTRlMDNm';
const WHITE = '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a';
const ITSUKI = '0x3e1c5e792fc73e8a2b72df4b0a8a8a462b2ce501';
const RYACHU = '0x208157b5ec396759e8754058108ecf53e32392ff';
const ESTEBAN = '0x875c5a7794b601f273da58e3c1d10671d16130ec';

function loadScript(url) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(readFileSync(url, 'utf8'), context);
  return context;
}

test('visible admin names and the whitelist node use the requested form', () => {
  assert.equal(displayName(RYACHU), 'RYASHU');
  assert.equal(displayName('0x3E1c5e792FC73e8a2B72dF4B0a8A8A462b2CE501'), 'ITZUKI');
  assert.equal(displayName(ESTEBAN), 'Esteban');
  assert.equal(displayName(WHITE), 'Node_6bcb8a');
  assert.equal(displayName('0x111111111111111111111111111111111111abcd'), 'Node abcd');
  assert.equal(displayName(RYACHU, RYACHU), 'You');
  assert.equal(isBalanceExempt(WHITE.toUpperCase()), true);
  assert.equal(isBalanceExempt(RYACHU), false);
  assert.equal(isBalanceExempt(OLD), false);

  const names = loadScript(new URL('../../muzz-names.js', import.meta.url)).MuzzNames;
  assert.equal(names.displayName(RYACHU), 'RYASHU');
  assert.equal(names.displayName(ITSUKI), 'ITZUKI');
  assert.equal(names.roleOf(ITSUKI), 'itsuki');
  assert.equal(names.isAdmin(WHITE), false);
  assert.equal(names.isAdmin(OLD), false);
  assert.equal(names.isWhitelisted(WHITE), true);
  assert.equal(names.nodeName(WHITE), 'Node_6bcb8a');
  assert.equal(names.nodeName('0x111111111111111111111111111111111111abcd'), 'Node_abcd');
  assert.equal(names.ADMINS.esteban.wallet, ESTEBAN);
  assert.equal(names.ADMINS.ryachu.wallet, RYACHU);
});

test('encrypted private previews stay generic', () => {
  const notify = loadScript(new URL('../../private-notify.js', import.meta.url)).MuzzNotify;
  assert.equal(notify.previewOf({ text: 'Hello there' }), 'Hello there');
  assert.equal(notify.previewOf({ ciphertext: 'abc', text: 'secret' }), 'New private message');
  assert.equal(notify.previewOf({ text: { sealed: true } }), 'New private message');
  assert.equal(notify.previewOf({ text: 'A'.repeat(48) }), 'New private message');
});

test('live pages and the app drop the old Itsuki wallet and add the private picker', () => {
  const files = [
    new URL('../../login.html', import.meta.url),
    new URL('../../chat.html', import.meta.url),
    new URL('../../private.html', import.meta.url),
    new URL('../www/login.html', import.meta.url),
    new URL('../www/chat.html', import.meta.url),
    new URL('../www/private.html', import.meta.url),
    new URL('../src/names.js', import.meta.url),
    new URL('../functions/src/accessLogic.js', import.meta.url)
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, new RegExp(OLD, 'i'), String(file));
    assert.doesNotMatch(text, new RegExp(OLD_B64), String(file));
  }
  const rootPrivate = readFileSync(new URL('../../private.html', import.meta.url), 'utf8');
  const appPrivate = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  for (const text of [rootPrivate, appPrivate]) {
    assert.match(text, /people-btn/);
    assert.match(text, /picker-closed/);
    assert.match(text, /Tap People to choose a conversation/);
    assert.match(text, /isWhitelisted\(meWallet\)/);
    assert.doesNotMatch(text, /data-wallet/);
    assert.match(text, /localShot/);
  }
  assert.match(readFileSync(new URL('../../login.html', import.meta.url), 'utf8'), /Ryashu &amp; Itzuki/);
  assert.match(readFileSync(new URL('../www/login.html', import.meta.url), 'utf8'), /Ryashu &amp; Itzuki/);
  assert.match(readFileSync(new URL('../www/login.html', import.meta.url), 'utf8'), /v1\.0\.8/);
  assert.match(readFileSync(new URL('../../chat.html', import.meta.url), 'utf8'), /MuzzNames\.isWhitelisted\(me\.wallet\)/);
  assert.match(readFileSync(new URL('../www/chat.html', import.meta.url), 'utf8'), /MuzzNames\.isWhitelisted\(walletAddress\)/);
  const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(gradle, /versionCode 8/);
  assert.match(gradle, /versionName "1\.0\.8"/);
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /POST_NOTIFICATIONS/);
  assert.match(readFileSync(new URL('../www/sw.js', import.meta.url), 'utf8'), /notificationclick/);
  assert.match(readFileSync(new URL('../../sw.js', import.meta.url), 'utf8'), /notificationclick/);
  assert.doesNotMatch(readFileSync(new URL('../../sw.js', import.meta.url), 'utf8'), /caches\.open/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies['@capacitor/local-notifications']);
});
