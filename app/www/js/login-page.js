import { applySignRecovery, clearSignLock, createResumeBinder, disconnectWallet, explainLoginError, isMobileBrowser, isNativeApp, loginWithWallet, openWalletForSignature, readRestoredAddress, resumeRelay, shortAddress, SIGN_STUCK_MS } from './login.js';

const statusText = document.getElementById('statusText');
const signOverlay = document.getElementById('signOverlay');
const signStep = document.getElementById('signStep');
const errorBox = document.getElementById('errorBox');
const debugBox = document.getElementById('muzzDebug');
const copyLogBtn = document.getElementById('copyLog');
const DEBUG_LOG_KEY = 'muzz_debug_log';
let running = false;
let loginGen = 0;
let connectTimer = 0;
let connectWatch = 0;
let signStuckTimer = 0;
let activeBinder = null;

function installCapacitorResume() {
  const Cap = window.Capacitor;
  const App = Cap && Cap.Plugins && Cap.Plugins.App;
  if (!App || typeof App.addListener !== 'function' || App.__muzzResume) return;
  App.__muzzResume = true;
  App.addListener('appStateChange', (state) => {
    if (state && state.isActive && activeBinder) activeBinder.onAppState(state);
  });
  App.addListener('resume', () => {
    if (activeBinder) activeBinder.onResume();
  });
}
installCapacitorResume();

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

function deepLinks() {
  return isNativeApp() || isMobileBrowser();
}

function setStep(text, opts = {}) {
  if (statusText) {
    statusText.dataset.busy = '1';
    statusText.hidden = false;
    statusText.textContent = text;
  }
  if (signStep) signStep.textContent = text;
  if (signOverlay) {
    if (opts.leaveOpen) signOverlay.classList.add('hidden');
    else signOverlay.classList.remove('hidden');
  }
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
  clearTimeout(signStuckTimer);
  if (activeBinder) activeBinder.cancel();
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
  const gen = ++loginGen;
  running = true;
  let gaveUp = false;
  let phase = 'connect';
  hideError();
  if (mode !== 'restored') hideSaved();
  clearSignLock();
  const stuck = document.getElementById('signStuck');
  const spinner = document.getElementById('signSpinner');
  const openSign = document.getElementById('openWalletSign');
  if (stuck) stuck.hidden = true;
  if (spinner) spinner.hidden = false;
  if (openSign) openSign.hidden = true;
  const qrDesktop = mode !== 'restored' && !deepLinks();
  setStep('Connecting…', { leaveOpen: qrDesktop });
  window.__muzzWalletId = options.walletId || 'metamask';
  const binder = createResumeBinder({
    resume: () => resumeRelay(log),
    phase: () => phase
  });
  activeBinder = binder;
  const failConnect = () => {
    if (gen !== loginGen || !running || gaveUp || phase !== 'connect') return;
    if (document.visibilityState === 'hidden') return;
    const modal = document.querySelector('w3m-modal, wcm-modal');
    if (modal && modal.open) return;
    gaveUp = true;
    running = false;
    showError(explainLoginError({ code: 'connect', message: 'The wallet did not return a connection.' }));
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    binder.onVisible('visible');
    clearTimeout(connectWatch);
    connectWatch = setTimeout(failConnect, 30000);
  };
  connectTimer = setTimeout(failConnect, 90000);
  document.addEventListener('visibilitychange', onVisible);
  const onReturn = () => {
    log('return:native');
    binder.onReturn();
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
      alive: () => gen === loginGen,
      ethereum: mode === 'restored' || namedOther || options.showModal ? null : undefined,
      log: (label) => {
        log(label);
        if (phase !== 'sign' && (String(label).startsWith('address:') || String(label).startsWith('balance:'))) phase = 'wallet';
        if (String(label).startsWith('address:')) {
          const shown = shortAddress(String(label).slice('address:'.length));
          if (shown) setStep('Wallet ' + shown);
        }
        if (String(label).startsWith('balance:start')) setStep('Checking MUZZ balance');
        if (label === 'sign:start') {
          phase = 'sign';
          setStep('Check your wallet to sign');
          if (openSign && deepLinks()) openSign.hidden = false;
          clearTimeout(signStuckTimer);
          signStuckTimer = setTimeout(() => {
            if (gen !== loginGen || phase !== 'sign') return;
            const show = applySignRecovery({
              stuck: document.getElementById('signStuck'),
              spinner: document.getElementById('signSpinner')
            }, SIGN_STUCK_MS, deepLinks());
            if (show && openSign) openSign.hidden = true;
          }, SIGN_STUCK_MS);
        }
        if (label === 'server:start') setStep('Verifying…');
      }
    });
    if (gen !== loginGen) return;
    const session = auth();
    if (!session) throw Object.assign(new Error('Firebase auth did not load.'), { code: 'server' });
    await session.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await session.signInWithCustomToken(result.customToken);
    rememberWallet(result.address);
    log('session:saved ' + result.address);
    window.location.href = 'chat.html';
  } catch (err) {
    if (gen !== loginGen) return;
    if (gaveUp) return;
    running = false;
    showError(explainLoginError(err));
  } finally {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('muzz-wc-return', onReturn);
    if (gen === loginGen) stopConnectWatch();
  }
}

async function showRestored() {
  const address = await readRestoredAddress();
  if (!address) return;
  showSaved(address);
  log('session:stored ' + address + ' balance:skipped');
}

const walletLinks = document.getElementById('walletLinks');
if (walletLinks && !deepLinks()) walletLinks.hidden = true;
document.getElementById('btnConnect').addEventListener('click', () => { startLogin('fresh', { walletId: 'metamask' }); });
document.querySelectorAll('[data-wallet]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!deepLinks()) {
      startLogin('fresh', { showModal: true });
      return;
    }
    startLogin('fresh', { walletId: button.getAttribute('data-wallet') || '' });
  });
});
function openChosenWallet() {
  openWalletForSignature({ walletId: window.__muzzWalletId || 'metamask' });
}
const openSignBtn = document.getElementById('openWalletSign');
if (openSignBtn) openSignBtn.addEventListener('click', openChosenWallet);
const openMetaMaskBtn = document.getElementById('openMetaMask');
if (openMetaMaskBtn) openMetaMaskBtn.addEventListener('click', openChosenWallet);
const signRetryBtn = document.getElementById('signRetry');
if (signRetryBtn) {
  signRetryBtn.addEventListener('click', () => {
    if (activeBinder) activeBinder.cancel();
    clearTimeout(connectTimer);
    clearTimeout(connectWatch);
    clearTimeout(signStuckTimer);
    loginGen += 1;
    running = false;
    clearSignLock();
    startLogin('fresh', { walletId: window.__muzzWalletId || 'metamask' });
  });
}
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
