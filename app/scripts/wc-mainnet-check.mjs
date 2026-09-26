/**
 * Drives login.html with a scripted WalletConnect wallet.
 * eth_chainId is answered as the number 1, which is what the Reown provider
 * returns. The page must reach personal_sign and then the MUZZ balance gate.
 */
import { spawn } from 'node:child_process';
import { Wallet, getBytes, toUtf8String } from 'ethers';
import SignClientPkg from '@walletconnect/sign-client';

const SignClient = SignClientPkg.default || SignClientPkg;
const PROJECT_ID = '8ff03dad157892146048cfe2b4e381ca';
const PORT = 4188;
const PAGE = `http://127.0.0.1:${PORT}/login.html`;

const wallet = Wallet.createRandom();
const CASES = [
  { name: 'eip155:1 reports 0x38', chains: ['eip155:1'], chainIdResult: '0x38' },
  { name: 'eip155:1 reports number 1', chains: ['eip155:1'], chainIdResult: 1 },
  { name: 'eip155:1 reports 0x1', chains: ['eip155:1'], chainIdResult: '0x1' },
  { name: 'eip155:56 and eip155:1, active 56', chains: ['eip155:56', 'eip155:1'], chainIdResult: '0x38' }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('cdp socket failed')));
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    }
  };
}

function signPayload(params) {
  const raw = params && params[0];
  if (typeof raw === 'string' && raw.startsWith('0x')) {
    try {
      return wallet.signMessage(toUtf8String(getBytes(raw)));
    } catch {
      return wallet.signMessage(raw);
    }
  }
  return wallet.signMessage(String(raw || ''));
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: new URL('../www/', import.meta.url).pathname,
    stdio: 'ignore'
  });
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=9223',
    '--user-data-dir=/tmp/muzz-wc-chrome',
    '--window-size=1280,800',
    'about:blank'
  ], { stdio: 'ignore' });

  let client;
  try {
    let version = null;
    for (let i = 0; i < 40 && !version; i += 1) {
      await sleep(250);
      try {
        version = await fetch('http://127.0.0.1:9223/json/version').then((res) => res.json());
      } catch {
        version = null;
      }
    }
    if (!version) throw new Error('Chrome DevTools did not start');
    const browser = await cdp(version.webSocketDebuggerUrl);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { webSocketDebuggerUrl } = (await fetch('http://127.0.0.1:9223/json/list').then((res) => res.json()))
      .find((item) => item.id === targetId);
    const page = await cdp(webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__MUZZ_WC_URI = '';
        const mark = (value) => {
          const found = String(value || '').match(/wc:[0-9a-f]+@2\\?[^\\s"'<>]+/);
          if (found) window.__MUZZ_WC_URI = found[0];
        };
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { mark(value); return orig.apply(this, arguments); };
      })();`
    });
    client = await SignClient.init({
      projectId: PROJECT_ID,
      metadata: {
        name: 'Scripted MuzzSnap wallet',
        description: 'Test wallet',
        url: 'https://muzzsnap-app.vercel.app',
        icons: ['https://muzzsnap-app.vercel.app/muzzsnap.jpg']
      }
    });
    let active = CASES[0];
    const seen = [];
    client.on('session_proposal', async (proposal) => {
      const required = proposal.params.requiredNamespaces || {};
      const optional = proposal.params.optionalNamespaces || {};
      const requiredChains = (required.eip155 && required.eip155.chains) || [];
      const optionalChains = (optional.eip155 && optional.eip155.chains) || [];
      if (!requiredChains.includes('eip155:1') && !optionalChains.includes('eip155:1')) {
        throw new Error(`eip155:1 was not requested (${JSON.stringify({ requiredChains, optionalChains })})`);
      }
      const methods = [...new Set([
        ...((required.eip155 && required.eip155.methods) || []),
        ...((optional.eip155 && optional.eip155.methods) || []),
        'personal_sign',
        'eth_sign'
      ])];
      const events = [...new Set([
        ...((required.eip155 && required.eip155.events) || []),
        'chainChanged',
        'accountsChanged'
      ])];
      await client.approve({
        id: proposal.id,
        namespaces: {
          eip155: {
            chains: active.chains,
            accounts: active.chains.map((chain) => `${chain}:${wallet.address}`),
            methods,
            events
          }
        }
      });
    });
    client.on('session_request', async (event) => {
      const method = event.params.request.method;
      const params = event.params.request.params;
      seen.push(method);
      let result = null;
      if (method === 'eth_chainId') result = active.chainIdResult;
      else if (method === 'net_version') result = '56';
      else if (method === 'eth_requestAccounts' || method === 'eth_accounts') result = [wallet.address];
      else if (method === 'personal_sign' || method === 'eth_sign') result = await signPayload(params);
      else if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') result = null;
      else {
        await client.respond({
          topic: event.topic,
          response: { id: event.id, jsonrpc: '2.0', error: { code: -32601, message: method } }
        });
        return;
      }
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: '2.0', result }
      });
    });

    const results = [];
    for (const spec of CASES) {
      active = spec;
      seen.length = 0;
      await page.send('Page.navigate', { url: `${PAGE}?case=${encodeURIComponent(spec.name)}` });
      await sleep(1200);
      await page.send('Runtime.evaluate', {
        expression: `(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} if (!indexedDB.databases) return null; return indexedDB.databases().then((list) => Promise.all((list || []).map((db) => indexedDB.deleteDatabase(db.name)))).catch(() => null); })()`,
        awaitPromise: true
      });
      await page.send('Page.reload', { ignoreCache: true });
      let ready = false;
      for (let i = 0; i < 30 && !ready; i += 1) {
        await sleep(400);
        const probe = await page.send('Runtime.evaluate', {
          expression: `!!document.getElementById('btnWc') && !!document.getElementById('networkLabel')`,
          returnByValue: true
        });
        ready = Boolean(probe.result?.value);
      }
      if (!ready) {
        const body = await page.send('Runtime.evaluate', {
          expression: `location.href + ' | ' + (document.body ? document.body.innerText.slice(0, 400) : 'no body')`,
          returnByValue: true
        });
        throw new Error(`${spec.name}: login page did not load. ${body.result?.value}`);
      }
      await page.send('Runtime.evaluate', {
        expression: `document.getElementById('btnWc').click()`,
        awaitPromise: true
      });
      let uri = '';
      for (let i = 0; i < 50 && !uri; i += 1) {
        await sleep(500);
        const read = await page.send('Runtime.evaluate', {
          expression: `(() => {
            const re = /wc:[0-9a-f]+@2\\?[^\\s"'<>]+/;
            const found = [];
            const consider = (value) => {
              const match = String(value || '').match(re);
              if (match) found.push(match[0]);
            };
            consider(window.__MUZZ_WC_URI);
            const walk = (node) => {
              if (!node || found.length) return;
              consider(node.nodeValue);
              consider(node.href);
              consider(node.uri);
              if (node.attributes) {
                for (const attr of node.attributes) consider(attr.value);
              }
              if (node.shadowRoot) walk(node.shadowRoot);
              for (const child of node.childNodes || []) walk(child);
            };
            walk(document);
            if (!found.length) {
              const clickWc = (node) => {
                if (!node) return;
                const testid = node.getAttribute && node.getAttribute('data-testid');
                const name = (node.getAttribute && node.getAttribute('name')) || '';
                if ((testid && /walletconnect/i.test(testid)) || /^walletconnect$/i.test(String(name))) {
                  if (typeof node.click === 'function') node.click();
                }
                if (node.shadowRoot) clickWc(node.shadowRoot);
                for (const child of node.children || []) clickWc(child);
              };
              clickWc(document);
            }
            return found[0] || '';
          })()`,
          returnByValue: true
        });
        uri = read.result?.value || '';
      }
      if (!uri) {
        const status = await page.send('Runtime.evaluate', {
          expression: `location.href + ' || ' + document.getElementById('errorTitle')?.innerText + ' | ' + document.getElementById('errorDesc')?.innerText + ' || ' + (document.body ? document.body.innerText.slice(0, 500) : '')`,
          returnByValue: true
        });
        throw new Error(`${spec.name}: no WalletConnect URI. Page: ${status.result?.value}`);
      }
      await page.send('Runtime.evaluate', { expression: `window.__MUZZ_WC_URI = ''` });
      await client.pair({ uri });
      let title = '';
      let desc = '';
      for (let i = 0; i < 40; i += 1) {
        await sleep(500);
        const read = await page.send('Runtime.evaluate', {
          expression: `JSON.stringify({
            title: document.getElementById('errorTitle')?.innerText || '',
            desc: document.getElementById('errorDesc')?.innerText || '',
            step: document.getElementById('signStep')?.innerText || ''
          })`,
          returnByValue: true
        });
        const state = JSON.parse(read.result.value);
        title = state.title;
        desc = state.desc;
        if (/Insufficient MUZZ|Wrong network|Signature rejected|Could not sign in|Wallet not installed/i.test(`${title} ${desc}`)) break;
        if (seen.includes('personal_sign') || seen.includes('eth_sign')) break;
      }
      const row = { name: spec.name, requests: [...seen], title, desc };
      results.push(row);
      console.log(JSON.stringify(row));
      if (/Wrong network/i.test(`${title} ${desc}`)) {
        throw new Error(`${spec.name} blocked on the network check: ${title} ${desc}`);
      }
      if (!seen.includes('personal_sign') && !seen.includes('eth_sign')) {
        throw new Error(`${spec.name} did not reach personal_sign. Methods: ${seen.join(',')}`);
      }
      try {
        const topics = client.session.getAll().map((item) => item.topic);
        for (const topic of topics) {
          await Promise.race([
            client.disconnect({ topic, reason: { code: 6000, message: 'next case' } }),
            sleep(2000)
          ]);
        }
      } catch {
        /* the next case starts a new pairing */
      }
    }
    console.log(JSON.stringify({ ok: true, results }));
    page.close();
    browser.close();
    return;
  } finally {
    chrome.kill('SIGKILL');
    server.kill('SIGKILL');
    if (client) {
      await Promise.race([
        (async () => {
          const topics = client.session.getAll().map((item) => item.topic);
          for (const topic of topics) {
            await client.disconnect({ topic, reason: { code: 6000, message: 'test done' } });
          }
        })(),
        sleep(3000)
      ]).catch(() => {});
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
