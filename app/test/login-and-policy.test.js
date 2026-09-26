import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ethers } from 'ethers';
import { assertSignedPolicy, hasEnoughBalance } from '../functions/src/accessLogic.js';
import { buildLoginMessage, originOf, parseLoginMessage } from '../shared/loginMessage.js';
import { TOKEN_ADDRESS } from '../shared/policy.js';
import { expireAtOnRead, expireAtOnSend, shouldPurge } from '../src/expiry.js';
import { formatMuzz } from '../src/format.js';
import { shellHtml } from '../src/render.js';

const sample = {
  address: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca',
  nonce: 'ab'.repeat(16),
  issuedAt: '2026-09-25T12:00:00.000Z',
  uri: 'http://127.0.0.1:4173',
  chainId: 1,
  tokenAddress: TOKEN_ADDRESS,
  minMuzz: '10000000'
};

test('el mensaje de login se construye y se lee igual', () => {
  const now = Date.parse(sample.issuedAt);
  const text = buildLoginMessage(sample);
  const parsed = parseLoginMessage(text, now);
  assert.equal(parsed.address, sample.address);
  assert.equal(parsed.nonce, sample.nonce);
  assert.equal(parsed.minMuzz, '10000000');
  assert.equal(parsed.token, TOKEN_ADDRESS.toLowerCase());
  assert.equal(parsed.chainId, 1);
  assert.throws(() => parseLoginMessage(text, now + 11 * 60 * 1000), /issued_skew/);
  const wrongChain = parseLoginMessage(text.replace('Chain ID: 1', 'Chain ID: 5'), now);
  assert.equal(wrongChain.chainId, 5);
  assert.throws(() => assertSignedPolicy(wrongChain, {
    tokenAddress: TOKEN_ADDRESS,
    minMuzz: '10000000',
    recovered: sample.address
  }), /chain/);
});

test('la política firmada tiene que coincidir con el servidor', () => {
  const parsed = parseLoginMessage(buildLoginMessage(sample), Date.parse(sample.issuedAt));
  assert.doesNotThrow(() => assertSignedPolicy(parsed, {
    tokenAddress: TOKEN_ADDRESS,
    minMuzz: '10000000',
    recovered: sample.address
  }));
  assert.throws(() => assertSignedPolicy(parsed, {
    tokenAddress: TOKEN_ADDRESS,
    minMuzz: '1',
    recovered: sample.address
  }), /minimum/);
});

test('origin de capacitor no se pierde', () => {
  assert.equal(originOf('capacitor://localhost'), 'capacitor://localhost');
  assert.equal(originOf('https://localhost'), 'https://localhost');
});

test('el saldo se compara en enteros, no en float', () => {
  const exact = ethers.parseUnits('10000000', 18);
  const less = exact - 1n;
  assert.equal(hasEnoughBalance(exact, 18, '10000000'), true);
  assert.equal(hasEnoughBalance(less, 18, '10000000'), false);
  assert.equal(hasEnoughBalance(ethers.parseUnits('10000000', 6), 6, 10000000), true);
});

test('caducidad: 24 h al leer, 72 h si nadie lee, 24 h la copia del emisor', () => {
  const sent = 1_000_000;
  const read = sent + 5_000;
  assert.equal(expireAtOnRead(read) - read, 24 * 60 * 60 * 1000);
  assert.equal(expireAtOnSend(sent, 'inbox') - sent, 72 * 60 * 60 * 1000);
  assert.equal(expireAtOnSend(sent, 'sender-copy') - sent, 24 * 60 * 60 * 1000);
  assert.equal(shouldPurge(read, read), true);
  assert.equal(shouldPurge(read + 1, read), false);
});

test('las reglas exigen el claim y la ventana de 24 h', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /muzzAccess == true/);
  assert.match(rules, /duration\.value\(23, 'h'\)/);
  assert.match(rules, /duration\.value\(70, 'h'\)/);
  assert.match(rules, /duration\.value\(22, 'h'\)/);
  assert.match(rules, /allow write: if false/);
  const storage = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');
  assert.match(storage, /application\/octet-stream/);
  const shared = readFileSync(new URL('../shared/loginMessage.js', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../functions/src/loginMessage.js', import.meta.url), 'utf8');
  assert.equal(shared, copy);
});

test('la pantalla de acceso muestra el mínimo y las wallets', () => {
  const html = shellHtml({ route: 'login', minMuzz: 10000000, phase: '', error: '', mobile: true, pageUrl: 'http://127.0.0.1:4173/' });
  assert.match(html, /Connect wallet/);
  assert.match(html, /MetaMask/);
  assert.match(html, /Trust Wallet/);
  assert.match(html, /Coinbase Wallet/);
  assert.match(html, /Rainbow/);
  assert.match(html, /OKX Wallet/);
  assert.match(html, /Phantom/);
  assert.match(html, /WalletConnect/);
  assert.match(html, /metamask\.app\.link/);
  assert.equal(formatMuzz(10000000), '10,000,000');
  assert.match(html, /10,000,000 MUZZ/);
  assert.doesNotMatch(html, /<script/i);
});
