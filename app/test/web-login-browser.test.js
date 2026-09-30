import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';
import playwright from 'playwright';

const { chromium } = playwright;
const root = new URL('../www/', import.meta.url);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'login.html';
    if (rel.includes('..')) {
      res.writeHead(400);
      res.end('bad');
      return;
    }
    const file = join(root.pathname, rel);
    try {
      const body = readFileSync(file);
      statSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('missing');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function rpcResult(data) {
  if (String(data).startsWith('0x313ce567')) return '0x12';
  return '0x84595161401484a000000';
}

async function armRoutes(page, bag) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/api/session')) {
      if (method === 'GET') {
        bag.nonce += 1;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ nonce: 'ab'.repeat(16), exp: Date.now() + 10 * 60 * 1000 })
        });
      }
      bag.posted = route.request().postData() || '';
      bag.postResolve();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ customToken: 'custom-token' }) });
    }
    if (/publicnode|drpc\.org|rpc\.ankr\.com/.test(url)) {
      let data = '';
      try { data = JSON.parse(route.request().postData() || '{}').params[0].data; } catch { data = ''; }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: rpcResult(data) })
      });
    }
    return route.continue();
  });
}

function watch(page) {
  const bag = { opened: [], logs: [], csp: [], nonce: 0, posted: '', postResolve() {} };
  bag.postedWait = new Promise((resolve) => { bag.postResolve = resolve; });
  page.on('console', (msg) => bag.logs.push(msg.text()));
  page.on('pageerror', (err) => bag.logs.push('pageerror ' + err.message));
  page.on('request', (req) => {
    if (/^(metamask|trust|cbwallet|rainbow|okx|phantom|muzzsnap):/i.test(req.url())) bag.opened.push(req.url());
  });
  page.on('requestfailed', (req) => {
    if (/^(metamask|trust|cbwallet|rainbow|okx|phantom|muzzsnap):/i.test(req.url())) bag.opened.push(req.url());
  });
  page.addListener?.('console', () => {});
  page.on('console', () => {});
  return bag;
}

async function captureClicks(page) {
  await page.addInitScript(() => {
    document.addEventListener('click', (event) => {
      const node = event.target && event.target.closest ? event.target.closest('a') : null;
      if (!node || !node.href) return;
      (window.__opened = window.__opened || []).push(node.href);
      if (/^(metamask|trust|cbwallet|rainbow|okx|phantom|muzzsnap):/i.test(node.href)) event.preventDefault();
    }, true);
  });
}

test('desktop login shows a WalletConnect QR and does not open a native wallet link', async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const bag = watch(page);
    await captureClicks(page);
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__csp.push(event.violatedDirective + ' ' + event.blockedURI);
      });
    });
    await page.goto('http://127.0.0.1:' + port + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#muzzUpdateBar').count(), 0, bag.logs.join('\n'));
    assert.equal(await page.locator('#copyLog').evaluate((el) => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('#walletLinks').evaluate((el) => getComputedStyle(el).display), 'none');
    const started = Date.now();
    await page.locator('#btnConnect').click();
    await page.waitForSelector('w3m-modal, appkit-modal', { timeout: 3000, state: 'attached' });
    assert.ok(Date.now() - started < 3000);
    const opened = await page.evaluate(() => window.__opened || []);
    const csp = await page.evaluate(() => window.__csp || []);
    assert.deepEqual(opened.filter((href) => /^(metamask|trust|cbwallet|rainbow|okx|phantom):/i.test(href)), []);
    assert.equal(bag.opened.length, 0);
    assert.deepEqual(csp, [], csp.join('\n') + '\n' + bag.logs.join('\n'));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('desktop EIP-6963 prefers MetaMask, signs once, and reaches /api/session', async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const bag = { nonce: 0, posted: '', postResolve() {} };
    bag.postedWait = new Promise((resolve) => { bag.postResolve = resolve; });
    await page.addInitScript(() => {
      const address = '0x' + 'ab'.repeat(20);
      const calls = (window.__walletCalls = []);
      function provider(name) {
        return {
          request: async ({ method }) => {
            calls.push(name + ':' + method);
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
            if (method === 'eth_chainId') return '0x1';
            if (method === 'personal_sign') return '0x' + '11'.repeat(65);
            return null;
          }
        };
      }
      window.ethereum = provider('phantom-global');
      window.addEventListener('eip6963:requestProvider', () => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: { info: { rdns: 'app.phantom', name: 'Phantom' }, provider: provider('phantom') }
        }));
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: { info: { rdns: 'io.metamask', name: 'MetaMask' }, provider: provider('metamask') }
        }));
      });
    });
    await armRoutes(page, bag);
    await page.goto('http://127.0.0.1:' + port + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#btnConnect').click();
    await Promise.race([
      bag.postedWait,
      new Promise((_, reject) => setTimeout(() => reject(new Error('session was not reached')), 15000))
    ]);
    const calls = await page.evaluate(() => window.__walletCalls || []);
    assert.equal(calls.filter((item) => item.startsWith('phantom')).length, 0);
    assert.equal(calls.filter((item) => item === 'phantom-global:eth_requestAccounts').length, 0);
    assert.equal(calls.filter((item) => item === 'metamask:personal_sign').length, 1);
    assert.equal(calls.filter((item) => item.endsWith(':personal_sign')).length, 1);
    assert.match(bag.posted, /\/api\/session|message/);
    assert.match(bag.posted, /Chain ID: 1/);
    assert.ok(bag.nonce >= 1);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a mobile browser opens metamask:// and returns to the site, while the APK still uses muzzsnap://wc', async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const phoneUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  try {
    const phone = await browser.newPage({ userAgent: phoneUa, viewport: { width: 390, height: 844 } });
    await captureClicks(phone);
    const phoneLogs = [];
    phone.on('console', (msg) => phoneLogs.push(msg.text()));
    await phone.goto('http://127.0.0.1:' + port + '/login.html', { waitUntil: 'domcontentloaded' });
    assert.equal(await phone.locator('#walletLinks').evaluate((el) => el.hidden), false);
    await phone.locator('#btnConnect').click();
    await phone.waitForFunction(() => (window.__opened || []).some((href) => href.startsWith('metamask://wc?uri=')), null, { timeout: 20000 });
    const opened = await phone.evaluate(() => window.__opened || []);
    const link = opened.find((href) => href.startsWith('metamask://wc?uri='));
    assert.ok(link);
    assert.doesNotMatch(link, /muzzsnap:\/\/wc/);
    const redirect = phoneLogs.find((line) => line.includes('redirect:'));
    assert.match(redirect || '', /"universal":"https:\/\/muzzsnap-app\.vercel\.app\/login\.html"/);
    assert.doesNotMatch(redirect || '', /"native":"muzzsnap:\/\/wc"/);

    const apk = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await apk.addInitScript(() => {
      window.Capacitor = {
        isNativePlatform() { return true; },
        getPlatform() { return 'android'; }
      };
    });
    await captureClicks(apk);
    const apkLogs = [];
    apk.on('console', (msg) => apkLogs.push(msg.text()));
    await apk.goto('http://127.0.0.1:' + port + '/login.html', { waitUntil: 'domcontentloaded' });
    await apk.locator('#btnConnect').click();
    await apk.waitForFunction(() => (window.__apkLogsReady = true) || (window.__opened || []).length >= 0, null, { timeout: 20000 });
    await apk.waitForFunction(() => (window.__opened || []).some((href) => href.startsWith('metamask://wc?uri=')), null, { timeout: 20000 });
    const apkRedirect = apkLogs.find((line) => line.includes('redirect:'));
    assert.match(apkRedirect || '', /"native":"muzzsnap:\/\/wc"/);
    assert.doesNotMatch(apkRedirect || '', /universal/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
