import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../www', import.meta.url));
const outDir = '/opt/cursor/artifacts';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, rel === '/' ? 'login.html' : rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/login.html`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err && err.stack || err)));

const stale = '0x' + 'b'.repeat(40);
const other = '0x' + 'a'.repeat(40);
const rpcHits = [];
page.on('request', (req) => {
  const url = req.url();
  if (/publicnode|drpc|ankr|eth_call/i.test(url)) rpcHits.push(url);
});
await page.addInitScript(({ staleAddress, otherAddress }) => {
  localStorage.setItem('muzz_wallet_address', otherAddress);
  localStorage.setItem('wc@2:client:0.3//session', JSON.stringify({
    namespaces: { eip155: { accounts: ['eip155:1:' + staleAddress], chains: ['eip155:1'] } }
  }));
  return new Promise((resolve) => {
    const request = indexedDB.open('WALLET_CONNECT_V2_INDEXED_DB', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('keyvaluestorage')) db.createObjectStore('keyvaluestorage');
    };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('keyvaluestorage', 'readwrite');
      tx.objectStore('keyvaluestorage').put(JSON.stringify({
        namespaces: { eip155: { accounts: ['eip155:1:' + staleAddress] } }
      }), 'wc@2:client:0.3//session');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    };
  });
}, { staleAddress: stale, otherAddress: other });

await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
const shown = 'Connected 0xbbbb…bbbb';
await page.locator('#savedWalletText').filter({ hasText: shown }).waitFor({ state: 'visible', timeout: 15000 });
await page.waitForTimeout(1500);
const staleText = await page.locator('#savedWalletText').innerText();
if (staleText !== shown) {
  console.error('STALE_TEXT', staleText);
  process.exit(4);
}
if (await page.getByText('Insufficient MUZZ').count()) process.exit(5);
if (await page.getByText('Checking MUZZ').count()) process.exit(6);
if (rpcHits.length) {
  console.error('RPC_DURING_STALE', rpcHits);
  process.exit(7);
}
await page.screenshot({ path: join(outDir, 'login-stale-session-android.png'), fullPage: true });
await page.locator('#btnDisconnect').click();
await page.locator('#savedWallet').waitFor({ state: 'hidden', timeout: 10000 });
const after = await page.evaluate(async () => {
  const keys = Object.keys(localStorage);
  const dbs = indexedDB.databases ? (await indexedDB.databases()).map((row) => row.name) : [];
  return { keys, dbs };
});
const kept = after.keys.filter((key) => key === 'muzz_wallet_address' || key.startsWith('wc@2') || /w3m|appkit|walletconnect/i.test(key));
if (kept.length || after.dbs.includes('WALLET_CONNECT_V2_INDEXED_DB')) {
  console.error('STILL_STORED', JSON.stringify(after));
  process.exit(8);
}
await page.screenshot({ path: join(outDir, 'login-after-disconnect-android.png'), fullPage: true });
await page.screenshot({ path: join(outDir, 'login-page-android.png'), fullPage: true });
await page.getByRole('button', { name: 'Connect with WalletConnect' }).click();

const metamask = page.getByText('MetaMask', { exact: true }).first();
try {
  await metamask.waitFor({ state: 'visible', timeout: 40000 });
} catch (err) {
  await page.screenshot({ path: join(outDir, 'login-wallet-modal-android.png'), fullPage: true });
  const html = await page.content();
  console.error('MODAL_WAIT_FAILED');
  console.error(String(err && err.message || err));
  console.error('CONSOLE', JSON.stringify(consoleErrors, null, 2));
  console.error('PAGE', JSON.stringify(pageErrors, null, 2));
  console.error('HAS_W3M', html.includes('w3m-') || html.includes('wcm-'));
  await browser.close();
  server.close();
  process.exit(2);
}

await page.screenshot({ path: join(outDir, 'login-wallet-modal-android.png'), fullPage: true });
const bufferErrors = [...consoleErrors, ...pageErrors].filter((line) => /buffer is not defined/i.test(line));
const report = {
  url: pageUrl,
  metamaskVisible: true,
  consoleErrors,
  pageErrors,
  bufferErrors
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
if (bufferErrors.length || pageErrors.length) process.exit(3);
