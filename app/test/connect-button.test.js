import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Connect Wallet still opens the 1.0.12 picker and only one personal_sign can be in flight', async () => {
  const login = readFileSync(new URL('../www/login.html', import.meta.url), 'utf8');
  const wallet = readFileSync(new URL('../src/wallet.js', import.meta.url), 'utf8');

  assert.match(login, /id="btnConnect" class="icon-bezel" onclick="accessWithWallet\(\)"/);
  assert.match(login, /getElementById\('btnWc'\)\.addEventListener\('click'/);
  assert.match(login, /cancelStuckLogin/);
  assert.match(login, /reconnectWalletConnect/);
  assert.match(login, /enterDurableSession/);
  assert.match(login, /const mod = await import\('\.\/js\/wc-login\.js'\);\s*const onSession = /);
  assert.match(login, /session = await mod\.connectWalletConnect\(/);
  assert.doesNotMatch(login, /firebase\.auth\s*\(/);
  assert.doesNotMatch(login, /enterKnownSession/);

  assert.match(wallet, /return createAppKit\(/);
  assert.doesNotMatch(wallet, /modal\.ready\s*\(/);
  assert.doesNotMatch(wallet, /setSIWX/);
  assert.match(wallet, /modal\.open\(\)/);
  assert.doesNotMatch(wallet, /authenticate\(/);

  assert.match(login, /if \(signFlight\) return signFlight/);
  assert.match(login, /signFlight = flight/);
  assert.match(login, /if \(epoch === signEpoch && signFlight === flight\) \{\s*signFlight = null/);
  assert.match(login, /sessionSign = signInWithProvider/);
  assert.match(login, /if \(!sessionSign\)/);
  assert.match(login, /await sessionSign/);
  assert.doesNotMatch(login, /setTimeout\([\s\S]{0,600}signFlight = null/);
  const resume = login.slice(login.indexOf('function resumeWalletLogin'), login.indexOf('async function acceptAuthToken'));
  assert.match(resume, /if \(signFlight\) return/);
  const timer = resume.slice(resume.indexOf('setTimeout'), resume.indexOf('}, 1500)'));
  assert.match(timer, /if \(signFlight\) return/);
  assert.ok(timer.indexOf('if (signFlight) return') < timer.indexOf('loginTask = null'));

  let calls = 0;
  let release;
  let rejectPending;
  let pending = new Promise((resolve, reject) => {
    release = resolve;
    rejectPending = reject;
  });
  let signFlight = null;
  function signInWithProvider() {
    if (signFlight) return signFlight;
    let resolveFlight;
    let rejectFlight;
    const flight = new Promise((resolve, reject) => {
      resolveFlight = resolve;
      rejectFlight = reject;
    });
    signFlight = flight;
    const once = (async () => {
      calls += 1;
      return pending;
    })();
    once.then(resolveFlight, rejectFlight).finally(() => {
      if (signFlight === flight) signFlight = null;
    });
    return flight;
  }
  function resumeWhileSigning() {
    if (signFlight) return 'blocked';
    return signInWithProvider();
  }

  const first = signInWithProvider();
  const second = signInWithProvider();
  assert.equal(second, first);
  assert.equal(calls, 1);
  assert.equal(resumeWhileSigning(), 'blocked');
  assert.equal(calls, 1);
  release('sig');
  assert.equal(await first, 'sig');
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(signFlight, null);

  pending = new Promise((resolve, reject) => {
    release = resolve;
    rejectPending = reject;
  });
  const third = signInWithProvider();
  assert.equal(calls, 2);
  assert.equal(resumeWhileSigning(), 'blocked');
  rejectPending(Object.assign(new Error('Signature rejected.'), { code: 'rejected' }));
  await assert.rejects(third, /Signature rejected/);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(signFlight, null);
  pending = Promise.resolve('next');
  const fourth = signInWithProvider();
  assert.equal(calls, 3);
  assert.equal(await fourth, 'next');
});
