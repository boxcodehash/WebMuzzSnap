import { clearSignLock, disconnectWallet, explainLoginError, loginWithWallet, readRestoredAddress, shortAddress } from './login.js';

const statusText = document.getElementById('statusText');
const signOverlay = document.getElementById('signOverlay');
const signStep = document.getElementById('signStep');
const errorBox = document.getElementById('errorBox');
const debugBox = document.getElementById('muzzDebug');
const copyLogBtn = document.getElementById('copyLog');
const DEBUG_LOG_KEY = 'muzz_debug_log';
let running = false;
let connectTimer = 0;
let connectWatch = 0;

function debugOn() {
  try { return localStorage.getItem('muzz_debug') === '1'; } catch { return false; }
}

function paintDebug() {
  const on = debugOn();
  if (debugBox) debugBox.hidden = !on;
  if (copyLogBtn) copyLogBtn.hidden = !on;
}

try {
  const saved = JSON.parse(sessionStorage.getItem(DEBUG_LOG_KEY) || '[]');
  if (Array.isArray(saved)) window.__muzzDebugLines = saved;
} catch { /* private mode */ }

function log(label) {
  const line = new Date().toISOString() + '  ' + String(label || '');
  const rows = window.__muzzDebugLines || (window.__muzzDebugLines = []);
  rows.push(line);
  if (rows.length > 80) rows.shift();
  try { sessionStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(rows)); } catch { /* private mode */ }
  console.log('[muzz]', line);
  if (debugBox && debugOn()) {
    debugBox.hidden = false;
    if (copyLogBtn) copyLogBtn.hidden = false;
    debugBox.textContent = rows.join('\n');
    debugBox.scrollTop = debugBox.scrollHeight;
  }
}

paintDebug();
(function () {
  const tag = document.getElementById('buildTag');
  if (!tag) return;
  let taps = 0;
  let last = 0;
  tag.addEventListener('click', () => {
    const now = Date.now();
    taps = now - last < 2500 ? taps + 1 : 1;
    last = now;
    if (taps < 5) return;
    taps = 0;
    const next = debugOn() ? '0' : '1';
    try { localStorage.setItem('muzz_debug', next); } catch { /* private mode */ }
    paintDebug();
    if (next === '1' && debugBox) {
      debugBox.hidden = false;
      if (copyLogBtn) copyLogBtn.hidden = false;
      debugBox.textContent = (window.__muzzDebugLines || []).join('\n') || 'Login debug on';
    }
  });
})();

function setStep(text) {
  if (statusText) {
    statusText.dataset.busy = '1';
    statusText.hidden = false;
    statusText.textContent = text;
  }
  if (signStep) signStep.textContent = text;
  if (signOverlay) signOverlay.classList.remove('hidden');
}

function showSaved(address) {
  const box = document.getElementById('savedWallet');
  const text = document.getElementById('savedWalletText');
  const line = document.getElementById('walletLine');
  const short = shortAddress(address);
  if (line) {
    line.hidden = !short;
    line.textContent = short ? 'Connected ' + short : '';
  }
  if (!box || !text || !short) {
    if (box) box.classList.add('hidden');
    return;
  }
  text.textContent = 'Connected ' + short;
  box.dataset.address = String(address || '').toLowerCase();
  box.classList.remove('hidden');
}

function hideSaved() {
  const box = document.getElementById('savedWallet');
  if (box) box.classList.add('hidden');
}

function showError(text) {
  if (signOverlay) signOverlay.classList.add('hidden');
  if (!errorBox) return;
  errorBox.classList.remove('hidden');
  const title = document.getElementById('errorTitle');
  const desc = document.getElementById('errorDesc');
  if (title) title.textContent = text.title;
  if (desc) desc.textContent = text.desc;
  const retry = document.getElementById('loginRetry');
  if (retry) retry.classList.remove('hidden');
  const disconnect = document.getElementById('btnDisconnectError');
  if (disconnect) disconnect.classList.remove('hidden');
  log('error: ' + text.title + ' ' + text.desc);
}

function hideError() {
  if (errorBox) errorBox.classList.add('hidden');
}

function rememberWallet(address) {
  const wallet = String(address || '').toLowerCase();
  try {
    sessionStorage.setItem('muzz_wallet_address', wallet);
    localStorage.setItem('muzz_wallet_address', wallet);
    sessionStorage.removeItem('muzz_login_hold');
  } catch { /* private mode */ }
}

function firebaseConfig() {
  return {
    apiKey: atob('QUl6YVN5QWUxLUpmTmRlME5LSU1kRTdwaGZFWGxtOUphcVVIMGpZ'),
    authDomain: atob('cHVsc2FyaS5maXJlYmFzZWFwcC5jb20='),
    databaseURL: atob('aHR0cHM6Ly9wdWxzYXJpLWRlZmF1bHQtcnRkYi5maXJlYmFzZWlvLmNvbQ=='),
    projectId: atob('cHVsc2FyaQ=='),
    storageBucket: atob('cHVsc2FyaS5maXJlYmFzZXN0b3JhZ2UuYXBw'),
    messagingSenderId: atob('ODI0MzA2MzIxMjMz'),
    appId: atob('MTo4MjQzMDYzMjEyMzM6d2ViOjJjOWJmYTAyMTcwYTE3ZDU2MGI1NzA=')
  };
}

function auth() {
  if (!window.firebase || !firebase.auth) return null;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig());
  return firebase.auth();
}

function walletUid(uid) {
  return /^0x[a-f0-9]{40}$/.test(String(uid || ''));
}

async function currentWalletUser() {
  const session = auth();
  if (!session) return null;
  try {
    await session.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  } catch { /* persistence may already be set */ }
  return new Promise((resolve) => {
    const unsub = session.onAuthStateChanged((user) => {
      unsub();
      resolve(user && walletUid(user.uid) ? user : null);
    });
  });
}

async function resumeIfSignedIn() {
  const user = await currentWalletUser();
  if (!user) return false;
  if (window.muzzGate && typeof muzzGate.confirmServerBalance === 'function') {
    const holding = await muzzGate.confirmServerBalance();
    if (!holding.ok) {
      log('balance:resume ' + (holding.code || 'denied'));
      try {
        const session = auth();
        if (session) await session.signOut();
      } catch { /* already signed out */ }
      return false;
    }
  }
  rememberWallet(user.uid);
  log('session:restored ' + user.uid);
  window.location.href = 'chat.html';
  return true;
}

function stopConnectWatch() {
  clearTimeout(connectTimer);
  clearTimeout(connectWatch);
}

async function forgetWallet() {
  stopConnectWatch();
  running = false;
  hideError();
  hideSaved();
  const line = document.getElementById('walletLine');
  if (line) {
    line.hidden = true;
    line.textContent = '';
  }
  clearSignLock();
  const cleared = await disconnectWallet();
  log('disconnect keys=' + cleared.removed.length + ' dbs=' + cleared.dbs.join(','));
  try {
    const session = auth();
    if (session) await session.signOut();
  } catch { /* already signed out */ }
  try {
    sessionStorage.removeItem('muzz_wallet_address');
    localStorage.removeItem('muzz_wallet_address');
    sessionStorage.removeItem('muzz_login_hold');
  } catch { /* private mode */ }
}

async function startLogin(mode, options = {}) {
  if (running) return;
  running = true;
  let gaveUp = false;
  let phase = 'connect';
  hideError();
  if (mode !== 'restored') hideSaved();
  clearSignLock();
  setStep('Connecting…');
  const failConnect = () => {
    if (!running || gaveUp || phase !== 'connect') return;
    if (document.visibilityState === 'hidden') return;
    const modal = document.querySelector('w3m-modal, wcm-modal');
    if (modal && modal.open) return;
    gaveUp = true;
    running = false;
    showError(explainLoginError({ code: 'connect', message: 'The wallet did not return a connection.' }));
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    clearTimeout(connectWatch);
    connectWatch = setTimeout(failConnect, 30000);
  };
  connectTimer = setTimeout(failConnect, 90000);
  document.addEventListener('visibilitychange', onVisible);
  const onReturn = () => {
    log('return:native');
    if (!running || phase !== 'connect') return;
    clearTimeout(connectWatch);
    connectWatch = setTimeout(failConnect, 30000);
  };
  window.addEventListener('muzz-wc-return', onReturn);
  try {
    const namedOther = options.walletId && options.walletId !== 'metamask';
    const result = await loginWithWallet({
      restored: mode === 'restored',
      walletId: options.walletId || '',
      showModal: options.showModal === true,
      ethereum: mode === 'restored' || namedOther || options.showModal ? null : undefined,
      log: (label) => {
        log(label);
        if (String(label).startsWith('address:') || String(label).startsWith('balance:')) phase = 'wallet';
        if (String(label).startsWith('address:')) {
          const shown = shortAddress(String(label).slice('address:'.length));
          if (shown) setStep('Wallet ' + shown);
        }
        if (String(label).startsWith('balance:start')) setStep('Checking MUZZ balance');
        if (label === 'sign:start') setStep('Check your wallet to sign');
        if (label === 'server:start') setStep('Verifying…');
      }
    });
    stopConnectWatch();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('muzz-wc-return', onReturn);
    const session = auth();
    if (!session) throw Object.assign(new Error('Firebase auth did not load.'), { code: 'server' });
    await session.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await session.signInWithCustomToken(result.customToken);
    rememberWallet(result.address);
    log('session:saved ' + result.address);
    window.location.href = 'chat.html';
  } catch (err) {
    stopConnectWatch();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('muzz-wc-return', onReturn);
    if (gaveUp) return;
    running = false;
    showError(explainLoginError(err));
  }
}

async function showRestored() {
  const address = await readRestoredAddress();
  if (!address) return;
  showSaved(address);
  log('session:stored ' + address + ' balance:skipped');
}

document.getElementById('btnConnect').addEventListener('click', () => { startLogin('fresh', { walletId: 'metamask' }); });
document.querySelectorAll('[data-wallet]').forEach((button) => {
  button.addEventListener('click', () => {
    startLogin('fresh', { walletId: button.getAttribute('data-wallet') || '' });
  });
});
document.getElementById('btnWc').addEventListener('click', () => { startLogin('fresh', { showModal: true }); });
document.getElementById('openWalletLink').addEventListener('click', () => { startLogin('fresh', { showModal: true }); });
document.getElementById('btnContinue').addEventListener('click', () => { startLogin('restored'); });
document.getElementById('btnDisconnect').addEventListener('click', () => { forgetWallet(); });
document.getElementById('btnDisconnectError').addEventListener('click', () => { forgetWallet(); });
document.getElementById('loginRetry').addEventListener('click', () => {
  clearSignLock();
  running = false;
  startLogin('fresh', { showModal: true });
});
if (copyLogBtn) {
  copyLogBtn.addEventListener('click', () => {
    const text = (window.__muzzDebugLines || []).join('\n');
    const done = () => log('log copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {
        if (debugBox) debugBox.textContent = text;
      });
      return;
    }
    if (debugBox) debugBox.textContent = text;
  });
}
window.addEventListener('error', (event) => {
  log('window: ' + (event && event.message ? event.message : 'error'));
});
showRestored();
resumeIfSignedIn();
