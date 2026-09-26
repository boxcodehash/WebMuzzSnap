import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { demoAllowed } from '../src/config.js';
import { shellHtml } from '../src/render.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('el demo local sigue solo en 127.0.0.1 y el preview es una variable', () => {
  assert.equal(demoAllowed(undefined, {}), false);
  assert.equal(demoAllowed({ hostname: '127.0.0.1', search: '' }, {}), false);
  assert.equal(demoAllowed({ hostname: '127.0.0.1', search: '?demo=1' }, {}), true);
  assert.equal(demoAllowed({ hostname: 'localhost', search: '?demo=1' }, {}), false);
  assert.equal(demoAllowed({ hostname: 'muzz.vercel.app', search: '?demo=1' }, {}), false);
  assert.equal(demoAllowed({ hostname: 'muzz.vercel.app', search: '' }, { preview: true }), true);
  assert.equal(demoAllowed({ hostname: 'localhost', search: '' }, { preview: true }), true);
  assert.equal(demoAllowed({ hostname: 'muzz.vercel.app', search: '?login=1' }, { preview: true }), false);
  assert.equal(demoAllowed({ hostname: '127.0.0.1', search: '?demo=0' }, { preview: true }), false);
});

test('la barra de preview está en inglés y no sale si el flag está apagado', () => {
  const on = shellHtml({
    route: 'chat',
    me: { wallet: '0x875c5a7794b601f273da0000000000000000d3e0' },
    preview: true,
    demo: true,
    messages: [],
    online: []
  });
  assert.match(on, /Preview build/);
  assert.match(on, /Real sign-in/);
  const off = shellHtml({
    route: 'chat',
    me: { wallet: '0x875c5a7794b601f273da0000000000000000d3e0' },
    preview: false,
    demo: false,
    messages: [],
    online: []
  });
  assert.doesNotMatch(off, /Preview build/);
});

test('MUZZ_PREVIEW escribe el json sin imprimir secretos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'muzz-cfg-'));
  const out = join(dir, 'config.local.json');
  const secret = 'a'.repeat(32);
  const result = spawnSync(process.execPath, ['scripts/write-local-config.mjs', out], {
    cwd: root,
    env: {
      ...process.env,
      MUZZ_PREVIEW: '1',
      WALLETCONNECT_PROJECT_ID: secret,
      MUZZ_FUNCTIONS_BASE: 'https://us-central1-example.cloudfunctions.net/',
      MUZZ_MIN_MUZZ: '10000000'
    },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret));
  const data = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(data.preview, true);
  assert.equal(data.walletConnectProjectId, secret);
  assert.equal(data.functionsBase, 'https://us-central1-example.cloudfunctions.net');
  assert.equal(data.minMuzz, 10000000);
  rmSync(dir, { recursive: true, force: true });
});

test('el sitio de Vercel publica las páginas reales, no el chat de muestra', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.outputDirectory, 'www');
  assert.doesNotMatch(vercel.buildCommand, /build:preview/);
  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  assert.match(login, /10,000,000 MUZZ/);
  assert.match(login, /muzz-gate\.js/);
  assert.doesNotMatch(login, /Enter as Guest/);
  assert.doesNotMatch(login, /MUZZ_PREVIEW/);
  const rootLogin = readFileSync(new URL('../../login.html', import.meta.url), 'utf8');
  assert.match(rootLogin, /Enter as Guest/);
  const chat = readFileSync(new URL('../www/chat.html', import.meta.url), 'utf8');
  const priv = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  assert.match(chat, /messages\/\$\{activeChannel\.id\}/);
  assert.match(chat, /firebase\.database\(\)/);
  assert.match(priv, /privateInbox/);
  assert.match(chat, /muzzGate\.readMuzzBalance/);
  assert.match(priv, /muzzGate\.readMuzzBalance/);
  assert.doesNotMatch(chat, /MUZZ_PREVIEW/);
});
