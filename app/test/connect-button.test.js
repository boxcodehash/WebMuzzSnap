import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clearSignLock, loginWithWallet } from '../src/login-client.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

test('the login page loads one module and asks for one signature', () => {
  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../www/js/login-page.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/login-client.js', import.meta.url), 'utf8');

  assert.match(login, /id="btnConnect"/);
  assert.match(login, /id="btnWc"/);
  assert.match(login, /firebase-auth-compat\.js/);
  assert.match(login, /js\/login-page\.js/);
  assert.match(login, />Copy log</);
  assert.doesNotMatch(login, /onclick="accessWithWallet|wc-login\.js|enterDurableSession|signFlight/);
  assert.match(page, /clearSignLock\(\)/);
  assert.match(page, /setPersistence/);
  assert.match(page, /signInWithCustomToken/);
  assert.match(page, /muzz_wallet_address/);
  assert.doesNotMatch(page, /wc_sessionAuthenticate|siwe:reused|personal_sign:suppressed/);
  assert.match(login, /Disconnect \/ Change wallet/);
  assert.match(login, /id="btnContinue"/);
  assert.match(page, /balance:skipped/);
  assert.match(page, /showRestored/);
  assert.doesNotMatch(client, /if \(provider\.session && provider\.accounts/);
  assert.match(client, /method: 'personal_sign'/);
  assert.doesNotMatch(client, /authenticate\(|wallet_switchEthereumChain|wc_sessionAuthenticate/);
  assert.equal(client.split("method: 'personal_sign'").length - 1, 1);
});

test('injected ethereum is preferred and a second tap does not sign twice', async () => {
  const address = '0x' + 'ab'.repeat(20);
  const storage = memoryStorage();
  let accounts = 0;
  let signs = 0;
  const pending = [];
  const ethereum = {
    async request({ method }) {
      if (method === 'eth_requestAccounts') {
        accounts += 1;
        return [address];
      }
      if (method === 'personal_sign') {
        signs += 1;
        await new Promise((resolve) => pending.push(resolve));
        return '0x' + '11'.repeat(65);
      }
      throw new Error('unexpected ' + method);
    }
  };
  let wc = 0;
  const deps = {
    ethereum,
    storage,
    readBalance: async () => ({ ok: true, formatted: '10,000,000' }),
    nonce: async () => ({ nonce: 'aa'.repeat(16) }),
    exchange: async () => ({ customToken: 'token' }),
    connectWc: async () => { wc += 1; throw new Error('walletconnect should not run'); }
  };
  const first = loginWithWallet(deps);
  for (let i = 0; i < 20 && signs < 1; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(accounts, 1);
  assert.equal(signs, 1);
  assert.equal(wc, 0);
  await assert.rejects(loginWithWallet(deps), (err) => err && err.code === 'sign_pending');
  assert.equal(signs, 1);
  clearSignLock(storage);
  const retry = loginWithWallet(deps);
  for (let i = 0; i < 20 && signs < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(signs, 2);
  pending[0]();
  pending[1]();
  const [a, b] = await Promise.all([first, retry]);
  assert.equal(a.customToken, 'token');
  assert.equal(b.address, address);
});
