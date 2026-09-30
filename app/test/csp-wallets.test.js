import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const HOSTS = [
  'https://api.web3modal.org',
  'https://api.web3modal.com',
  'https://explorer-api.walletconnect.com',
  'https://pulse.walletconnect.org',
  'https://rpc.walletconnect.org',
  'https://rpc.walletconnect.com',
  'wss://relay.walletconnect.org',
  'wss://relay.walletconnect.com',
  'https://verify.walletconnect.org',
  'https://verify.walletconnect.com',
  'https://secure.walletconnect.org',
  'https://*.reown.com',
  'wss://*.reown.com'
];

function csp(file) {
  const html = readFileSync(new URL(file, import.meta.url), 'utf8');
  const match = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(match, file + ' has a CSP');
  return match[1];
}

test('login CSP lets the wallet list and WalletConnect hosts load', () => {
  const policy = csp('../www/login.html');
  assert.match(policy, /img-src[^;]*data:/);
  assert.match(policy, /img-src[^;]*blob:/);
  assert.match(policy, /img-src[^;]*https:/);
  assert.match(policy, /frame-src[^;]*https:\/\/verify\.walletconnect\.org/);
  for (const host of HOSTS) {
    assert.ok(policy.includes(host), 'missing ' + host);
  }
  const page = readFileSync(new URL('../www/js/login-page.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/login-client.js', import.meta.url), 'utf8');
  assert.match(page, /data-wallet/);
  assert.match(page, /walletId: 'metamask'/);
  assert.match(page, /showModal: true/);
  assert.match(client, /showQrModal: deps\.showModal === true/);
  assert.match(client, /wallet:open/);
  assert.match(readFileSync(new URL('../src/walletLinks.js', import.meta.url), 'utf8'), /metamask:\/\/wc\?uri=/);
});

test('chat and private use the same wallet connect hosts', () => {
  for (const file of ['../www/chat.html', '../www/private.html']) {
    const policy = csp(file);
    assert.ok(policy.includes('https://api.web3modal.org'));
    assert.ok(policy.includes('wss://relay.walletconnect.org'));
    assert.match(policy, /frame-src/);
  }
});
