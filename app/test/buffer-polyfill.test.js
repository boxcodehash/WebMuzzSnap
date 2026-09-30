import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { getAddress, verifyMessage } from 'ethers';

const bundleUrl = pathToFileURL(fileURLToPath(new URL('../www/js/login.js', import.meta.url))).href;

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

function loadGate() {
  const context = {
    ethers: { utils: { getAddress, verifyMessage } },
    localStorage: memoryStorage(),
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    location: { origin: 'https://localhost', hostname: 'localhost', protocol: 'https:' },
    URL,
    MUZZ_PUBLIC: { appPublicUrl: 'https://muzzsnap-app.vercel.app', walletConnectProjectId: '' }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../www/js/muzz-gate.js', import.meta.url), 'utf8'), context);
  return context.muzzGate;
}

test('the bundled login does not need Node Buffer', () => {
  const bundle = readFileSync(new URL('../www/js/login.js', import.meta.url), 'utf8');
  assert.match(bundle, /muzz-buffer-polyfill/);
  assert.doesNotMatch(bundle, /(?:^|[^.\w])Buffer\.from/);
  assert.doesNotMatch(bundle, /import\(["']@reown\/appkit\/core["']\)/);
  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  assert.match(login, /js\/login-page\.js/);
  assert.doesNotMatch(login, /wc-login\.js/);
  const rootLogin = readFileSync(new URL('../../login.html', import.meta.url), 'utf8');
  assert.doesNotMatch(rootLogin, /wc-login|@reown\/appkit|WalletConnect/);

  const runner = `
    delete globalThis.Buffer;
    if (typeof Buffer !== 'undefined') throw new Error('Buffer global still visible');
    globalThis.window = globalThis;
    globalThis.self = globalThis;
    const mem = () => {
      const data = new Map();
      return { getItem: (k) => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
    };
    if (!globalThis.localStorage) globalThis.localStorage = mem();
    if (!globalThis.sessionStorage) globalThis.sessionStorage = mem();
    if (!globalThis.document) {
      globalThis.document = {
        visibilityState: 'visible',
        documentElement: { style: {} },
        createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null
      };
    }
    try {
      await import(${JSON.stringify(bundleUrl)});
    } catch (err) {
      const text = String((err && (err.stack || err.message)) || err);
      console.error(text);
      if (err && (err.name === 'ReferenceError' || /Buffer is not defined/.test(text))) process.exit(2);
      process.exit(1);
    }
    if (globalThis.__muzzBufferPolyfill !== 'muzz-buffer-polyfill') process.exit(3);
    if (typeof globalThis.Buffer !== 'function' || typeof globalThis.Buffer.from !== 'function') process.exit(4);
    const encoded = globalThis.Buffer.from('wc:test').toString('base64');
    if (encoded !== 'd2M6dGVzdA==') process.exit(5);
    console.log('ok');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', runner], {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('..', import.meta.url))
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ok/);
});

test('a Buffer crash is not shown as a cancelled signature', () => {
  const gate = loadGate();
  const crashed = Object.assign(new Error('Buffer is not defined'), { code: 'rejected' });
  const shown = gate.explainSignError(crashed, { namespaces: null, chain: undefined });
  assert.equal(shown.title, 'Could not open the wallet list.');
  assert.match(shown.desc, /Buffer is not defined/);
  assert.doesNotMatch(`${shown.title} ${shown.desc}`, /Signature rejected|cancelled the connection/);
  const line = gate.debugLine(crashed, { namespaces: null });
  assert.match(line, /chain:unknown/);
  assert.match(line, /ns:none/);
  assert.match(line, /Buffer is not defined/);

  const closed = Object.assign(new Error('rejected'), { code: 'rejected', noSession: true });
  const closedText = gate.explainSignError(closed, { namespaces: null, chain: 'unknown' });
  assert.equal(closedText.title, 'Could not connect the wallet.');
  assert.match(closedText.desc, /before a connection was made/);
  assert.doesNotMatch(closedText.title, /Signature rejected/);

  const signed = Object.assign(new Error('user rejected the request'), { code: 'rejected', userCancel: true });
  const signedText = gate.explainSignError(signed, { namespaces: { eip155: { chains: ['eip155:1'] } }, chain: '1' });
  assert.equal(signedText.title, 'Signature rejected.');
});
