import { ethers } from 'ethers';
import { buildLoginMessage } from '../shared/loginMessage.js';
import { demoAllowed, getConfig } from './config.js';
import { formatMuzz } from './format.js';
import { purgeCache } from './keys.js';
import * as api from './api.js';
import { bannerHtml, messagesHtml, shellHtml } from './render.js';
import * as wallet from './wallet.js';
import { walletMessage } from './walletErrors.js';
import { inAppWalletId } from './walletLinks.js';
import { normalizeChainId } from './walletSession.js';
import { shortAddr } from './names.js';

const DEMO_ME = '0x875c5a7794b601f273da0000000000000000d3e0';
const DEMO_A = '0x4c1e90aa77b3d81264c00000000000000000a91f';
const DEMO_B = '0x90bb12cd44e671aa0099000000000000000022ce';

const state = {
  route: 'login',
  phase: '',
  error: '',
  notice: '',
  wallets: [],
  inApp: '',
  mobile: false,
  wcReady: false,
  pageUrl: '',
  me: null,
  draft: '',
  file: null,
  panel: '',
  peer: '',
  online: [],
  threads: [],
  messages: [],
  groupMessages: [],
  privateThreads: {},
  trust: null,
  pending: null,
  sending: false,
  booting: !demoAllowed(),
  demo: demoAllowed(),
  minMuzz: getConfig().minMuzz,
  balance: ''
};

let painted = '';
let bootedFor = '';

function paint() {
  const root = document.getElementById('app');
  if (!root) return;
  const key = [
    state.route,
    state.peer,
    state.panel,
    state.phase,
    state.booting ? '1' : '0',
    state.me ? state.me.wallet : '',
    state.file ? state.file.name : '',
    state.trust ? state.trust.wallet : '',
    (state.wallets || []).map((item) => item.id).join(','),
    state.inApp,
    state.mobile ? 'm' : '',
    state.wcReady ? 'w' : '',
    state.panel === 'online' ? state.online.map((item) => item.wallet).join(',') : '',
    state.route === 'privado' ? state.threads.map((item) => `${item.wallet}:${item.preview}`).join('|') : ''
  ].join('~');
  if (key !== painted) {
    painted = key;
    root.innerHTML = shellHtml(state);
    const draft = document.getElementById('draft');
    if (draft) draft.value = state.draft || '';
  }
  const msgs = document.getElementById('msgs');
  if (msgs) {
    const stick = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 140;
    msgs.innerHTML = messagesHtml(state);
    if (stick) msgs.scrollTop = msgs.scrollHeight;
  }
  const banner = document.getElementById('banner');
  if (banner) banner.innerHTML = bannerHtml(state);
  const count = document.getElementById('onlineCount');
  if (count) count.textContent = String(state.online.length);
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = state.sending;
}

function formatBalance(data) {
  try {
    return formatMuzz(ethers.formatUnits(BigInt(data.balance), Number(data.decimals)));
  } catch {
    return '';
  }
}

function human(err) {
  const code = err && (err.code || err.message);
  if (code === 'below_minimum') {
    const payload = err.payload || {};
    if (payload.balance) {
      return `Insufficient MUZZ balance. You have ${formatBalance(payload)} MUZZ and the minimum is ${formatMuzz(payload.minMuzz)} MUZZ.`;
    }
    return `Insufficient MUZZ balance. You need at least ${formatMuzz(state.minMuzz)} MUZZ.`;
  }
  const fromWallet = walletMessage(code);
  if (fromWallet) return fromWallet;
  const map = {
    functions_unconfigured: 'functionsBase is missing in config.runtime.js. Without the Cloud Functions the server cannot check the balance.',
    network: 'No connection to the access server.',
    format: 'The sign-in message is not valid.',
    issued_skew: 'This device clock is off. Set the time and try again.',
    nonce: 'That attempt is no longer valid. Sign again.',
    origin: 'This origin is not allowed on the server.',
    token: 'The signed contract does not match the server.',
    minimum: 'The signed minimum does not match the server.',
    address: 'The signature does not match that wallet.',
    signature: 'The signature could not be verified.',
    rpc_failed: 'The Ethereum balance could not be read. Access was not closed because of that.',
    access_expired: 'The session expired. Sign in again so the balance can be checked.',
    claim: 'This session does not have holder access.',
    auth: 'This session is not valid. Sign in again.',
    NO_PREKEY: 'That person has no one-time keys available.',
    NO_KEYS: 'That wallet has not published keys yet.',
    no_members: 'There are no other holders in the group yet.',
    too_many: 'Too many members for a single send.',
    too_long: 'The message is over 2,000 characters.',
    file_size: 'The attachment is over 8 MB.',
    TRUST: 'The identity key changed.',
    no_signing_key: 'This device has no signing key yet. Sign in again.'
  };
  return map[code] || 'The operation could not be completed.';
}

function readRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const fromHash = parseRoute(hash);
  if (hash && fromHash) return fromHash;
  const query = new URLSearchParams(location.search);
  if (query.get('view') === 'hilo') {
    return parseRoute(`hilo/${query.get('peer') || ''}`) || { name: 'login', peer: '' };
  }
  const fromView = parseRoute(query.get('view') || '');
  if (fromView) return fromView;
  if (state.demo || state.me) return { name: 'chat', peer: '' };
  return { name: 'login', peer: '' };
}

function parseRoute(raw) {
  const [name, peer] = String(raw || '').split('/');
  if (name === 'login' || name === 'chat' || name === 'privado') return { name, peer: '' };
  if (name === 'hilo' && /^0x[0-9a-f]{40}$/.test(peer || '')) return { name, peer };
  return null;
}

function go(name, peer) {
  const next = name === 'hilo' ? `#/hilo/${peer}` : `#/${name}`;
  if (location.hash === next) syncRoute();
  else location.hash = next;
}

function seedDemo() {
  const now = Date.now();
  state.me = { wallet: DEMO_ME };
  state.booting = false;
  state.online = [
    { wallet: DEMO_ME, lastSeen: now },
    { wallet: DEMO_A, lastSeen: now },
    { wallet: DEMO_B, lastSeen: now }
  ];
  state.groupMessages = [
    {
      id: 'g1',
      sender: DEMO_A,
      mine: false,
      text: 'Should we keep the gate at ten million MUZZ?',
      locked: '',
      sentAt: now - 50 * 60 * 1000,
      readAt: now - 48 * 60 * 1000,
      expireAt: now - 48 * 60 * 1000 + 24 * 60 * 60 * 1000,
      kind: 'inbox',
      fileName: '',
      canDownload: false
    },
    {
      id: 'g2',
      sender: DEMO_B,
      mine: false,
      text: 'Yes. If the balance drops below that, the session closes on its own.',
      locked: '',
      sentAt: now - 36 * 60 * 1000,
      readAt: now - 30 * 60 * 1000,
      expireAt: now - 30 * 60 * 1000 + 24 * 60 * 60 * 1000,
      kind: 'inbox',
      fileName: '',
      canDownload: false
    },
    {
      id: 'g3',
      sender: DEMO_ME,
      mine: true,
      text: 'Got it. My copy of this message deletes in 24 h.',
      locked: '',
      sentAt: now - 12 * 60 * 1000,
      readAt: null,
      expireAt: now - 12 * 60 * 1000 + 24 * 60 * 60 * 1000,
      kind: 'sender-copy',
      fileName: '',
      canDownload: false
    }
  ];
  state.privateThreads = {
    [DEMO_A]: [
      {
        id: 'p1',
        sender: DEMO_A,
        mine: false,
        text: 'Writing on the private channel. The group cannot see this.',
        locked: '',
        sentAt: now - 20 * 60 * 1000,
        readAt: now - 18 * 60 * 1000,
        expireAt: now - 18 * 60 * 1000 + 24 * 60 * 60 * 1000,
        kind: 'inbox',
        fileName: '',
        canDownload: false
      },
      {
        id: 'p2',
        sender: DEMO_ME,
        mine: true,
        text: 'Noted. It deletes 24 hours after you read it.',
        locked: '',
        sentAt: now - 8 * 60 * 1000,
        readAt: null,
        expireAt: now + 70 * 60 * 60 * 1000,
        kind: 'inbox',
        fileName: '',
        canDownload: false
      }
    ],
    [DEMO_B]: []
  };
  state.threads = [
    { wallet: DEMO_A, preview: 'Noted. It deletes 24 hours after you read it.', updatedAt: now - 8 * 60 * 1000 },
    { wallet: DEMO_B, preview: 'Encrypted message', updatedAt: now - 2 * 60 * 60 * 1000 }
  ];
}

function applyDemoView() {
  if (state.route === 'chat') state.messages = state.groupMessages;
  else if (state.route === 'hilo') state.messages = state.privateThreads[state.peer] || [];
}

function syncRoute() {
  let next = readRoute();
  if (!state.demo && !state.me && !state.booting && next.name !== 'login') {
    if (location.hash !== '#/login') {
      location.hash = '#/login';
      return;
    }
    next = { name: 'login', peer: '' };
  }
  state.route = state.me || state.demo ? next.name : 'login';
  if (state.route === 'login') state.route = next.name === 'login' || !state.me ? 'login' : next.name;
  state.peer = next.peer || '';
  if (state.demo && state.me) applyDemoView();
  if (!state.demo && state.me && state.route === 'chat') state.messages = state.groupMessages || [];
  if (!state.demo && state.me && state.route === 'hilo') {
    api.watchPrivate(state.peer, (messages) => {
      state.messages = messages;
      paint();
    });
  } else if (!state.demo && state.me) {
    api.watchPrivate('', () => {});
  }
  paint();
}

let walletWatch = () => {};
let dropping = false;

function armWalletWatch(provider) {
  walletWatch();
  walletWatch = wallet.watchProvider(provider, {
    onDisconnect() {
      dropSession(walletMessage('disconnected'));
    },
    onAccounts(accounts) {
      const next = String((accounts && accounts[0]) || '').toLowerCase();
      if (!next) dropSession(walletMessage('disconnected'));
      else if (state.me && next !== state.me.wallet) dropSession(walletMessage('account_changed'));
    },
    onChain(chainId) {
      const hex = normalizeChainId(chainId);
      if (hex && hex !== '0x1') dropSession(walletMessage('chain'));
    }
  });
}

async function dropSession(message) {
  if (dropping) return;
  dropping = true;
  try {
    walletWatch();
    walletWatch = () => {};
    if (!state.demo) await wallet.disconnectWallet();
    bootedFor = '';
    state.me = null;
    state.phase = '';
    state.booting = false;
    state.panel = '';
    state.messages = [];
    state.threads = [];
    state.online = [];
    state.error = message || '';
    if (!state.demo) await api.logout();
    painted = '';
    go('login');
  } finally {
    dropping = false;
  }
}

async function enterSession(user) {
  if (bootedFor === user.uid) return;
  bootedFor = user.uid;
  state.me = { wallet: user.uid.toLowerCase() };
  state.booting = false;
  state.error = '';
  try {
    if (!api.consumeFreshLogin()) {
      const check = await api.recheckAccess();
      state.balance = formatBalance(check);
      state.minMuzz = Number(check.minMuzz || state.minMuzz);
    }
    state.phase = 'keys';
    paint();
    await api.prepareDeviceKeys();
    state.phase = '';
    api.startPresence();
    api.watchAccess((data) => {
      if (!data || data.active !== true) {
        dropSession('Access closed: the balance is below the minimum, or the session was revoked.');
      }
    });
    api.watchPresence((online) => {
      state.online = online;
      paint();
    });
    api.watchThreads((threads) => {
      state.threads = threads;
      paint();
    });
    api.watchGroup((messages) => {
      state.groupMessages = messages;
      if (state.route === 'chat') {
        state.messages = messages;
        paint();
      }
    });
    if (state.route === 'login' || !location.hash) go('chat');
    else syncRoute();
  } catch (err) {
    state.phase = '';
    if (err.code === 'below_minimum' || err.code === 'access_expired' || err.code === 'claim') {
      await dropSession(human(err));
      return;
    }
    state.error = human(err);
    paint();
  }
}

async function login(kind, walletId) {
  state.error = '';
  state.notice = '';
  state.panel = '';
  if (!getConfig().functionsBase) {
    state.error = human({ code: 'functions_unconfigured' });
    paint();
    return;
  }
  const hooks = {
    onPhase(phase) {
      state.phase = phase;
      paint();
    }
  };
  try {
    state.phase = 'connect';
    paint();
    let session;
    if (kind === 'injected') {
      session = await wallet.connectInjected(walletId, hooks);
    } else if (getConfig().walletConnectProjectId) {
      session = await wallet.connectModal(hooks);
    } else {
      const found = await wallet.discoverInjected();
      if (found.length === 1) session = await wallet.connectInjected(found[0].id, hooks);
      else if (found.length > 1) {
        state.phase = '';
        state.panel = 'wallets';
        state.wallets = found.map(({ id, name, rdns }) => ({ id, name, rdns }));
        painted = '';
        paint();
        return;
      } else {
        throw Object.assign(new Error('NO_WALLET'), { code: 'NO_WALLET' });
      }
    }
    state.phase = 'nonce';
    paint();
    const nonce = await api.createNonce();
    state.minMuzz = Number(nonce.minMuzz || state.minMuzz);
    const message = buildLoginMessage({
      address: session.address,
      nonce: nonce.nonce,
      issuedAt: new Date().toISOString(),
      uri: location.origin,
      chainId: nonce.chainId,
      tokenAddress: nonce.tokenAddress,
      minMuzz: nonce.minMuzz
    });
    state.phase = 'sign';
    paint();
    const signature = await wallet.signLogin(session.provider, session.address, message);
    state.phase = 'verify';
    paint();
    const result = await api.verifyAccess(message, signature);
    state.balance = formatBalance(result);
    state.minMuzz = Number(result.minMuzz || state.minMuzz);
    api.noteFreshLogin();
    await api.signInToken(result.token);
    armWalletWatch(session.provider);
    state.phase = '';
  } catch (err) {
    state.phase = '';
    state.error = human(err);
    paint();
  }
}

function appendDemo(text) {
  const now = Date.now();
  const mine = {
    id: crypto.randomUUID(),
    sender: DEMO_ME,
    mine: true,
    text: text.trim(),
    locked: '',
    sentAt: now,
    readAt: null,
    expireAt: state.route === 'chat' ? now + 24 * 60 * 60 * 1000 : now + 72 * 60 * 60 * 1000,
    kind: state.route === 'chat' ? 'sender-copy' : 'inbox',
    fileName: state.file ? state.file.name : '',
    canDownload: false
  };
  if (state.route === 'chat') state.groupMessages = [...state.groupMessages, mine];
  if (state.route === 'hilo') {
    const list = state.privateThreads[state.peer] || [];
    state.privateThreads[state.peer] = [...list, mine];
    state.threads = state.threads.map((thread) => thread.wallet === state.peer
      ? { ...thread, preview: mine.text, updatedAt: now }
      : thread);
  }
  applyDemoView();
}

async function send() {
  const text = state.draft || '';
  const file = state.file;
  if (state.sending || (!text.trim() && !file)) return;
  if (state.demo) {
    appendDemo(text || file.name);
    state.draft = '';
    state.file = null;
    painted = '';
    paint();
    return;
  }
  state.sending = true;
  state.error = '';
  state.notice = '';
  paint();
  try {
    if (state.route === 'chat') {
      const result = await api.sendGroup(text, file);
      if (result?.skipped?.length) {
        state.notice = `Sent. ${result.skipped.length} ${result.skipped.length === 1 ? 'person had' : 'people had'} no one-time key.`;
      }
    } else if (state.route === 'hilo') {
      await api.sendPrivate(state.peer, text, file);
    }
    state.draft = '';
    state.file = null;
    state.pending = null;
    painted = '';
  } catch (err) {
    if (err.code === 'TRUST') {
      state.trust = err.trust;
      state.panel = 'trust';
      state.pending = { text, file };
      painted = '';
    } else {
      state.error = human(err);
    }
  } finally {
    state.sending = false;
    paint();
  }
}

async function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'login') {
    await login(button.dataset.kind, button.dataset.wallet);
    return;
  }
  if (action === 'go') {
    state.panel = '';
    go(button.dataset.route);
    return;
  }
  if (action === 'panel') {
    state.panel = button.dataset.panel || '';
    painted = '';
    paint();
    return;
  }
  if (action === 'open-peer') {
    state.panel = '';
    go('hilo', button.dataset.peer);
    return;
  }
  if (action === 'pick-file') {
    document.getElementById('file')?.click();
    return;
  }
  if (action === 'clear-file') {
    state.file = null;
    painted = '';
    paint();
    return;
  }
  if (action === 'logout') {
    state.panel = '';
    await dropSession('');
    state.error = '';
    state.notice = 'Logged out on this device.';
    paint();
    return;
  }
  if (action === 'wipe') {
    if (!window.confirm('Keys and messages stored on this device will be deleted. They cannot be recovered.')) return;
    if (!state.demo) await api.eraseDeviceKeys();
    await dropSession('Keys deleted on this device.');
    return;
  }
  if (action === 'trust-accept' && state.trust) {
    const pending = state.pending;
    if (!state.demo) await api.acceptTrust(state.trust.wallet, state.trust);
    state.trust = null;
    state.panel = '';
    state.pending = null;
    painted = '';
    if (pending) {
      state.draft = pending.text || '';
      state.file = pending.file || null;
      await send();
    } else paint();
    return;
  }
  if (action === 'download') {
    if (state.demo || !button.dataset.path) return;
    try {
      await api.downloadAttachment(button.dataset.id, button.dataset.path);
    } catch (err) {
      state.error = human(err);
      paint();
    }
  }
}

function bindViewport() {
  const apply = () => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    document.documentElement.style.setProperty('--vvh', `${Math.round(viewport.height)}px`);
    document.documentElement.style.setProperty('--vvtop', `${Math.round(viewport.offsetTop)}px`);
  };
  apply();
  window.visualViewport?.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('scroll', apply);
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.Capacitor?.isNativePlatform?.()) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function boot() {
  state.demo = demoAllowed();
  state.preview = getConfig().preview;
  state.booting = !state.demo;
  state.minMuzz = getConfig().minMuzz;
  const root = document.getElementById('app');
  root.addEventListener('click', (event) => { onClick(event); });
  root.addEventListener('submit', (event) => {
    if (event.target.id === 'composer') {
      event.preventDefault();
      send();
    }
  });
  root.addEventListener('input', (event) => {
    if (event.target.id === 'draft') state.draft = event.target.value;
  });
  root.addEventListener('change', (event) => {
    if (event.target.id !== 'file') return;
    state.file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
    if (state.file && state.file.size > 8 * 1024 * 1024) {
      state.file = null;
      state.error = human({ code: 'file_size' });
    }
    painted = '';
    paint();
  });
  root.addEventListener('keydown', (event) => {
    if (event.target.id === 'draft' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  window.addEventListener('hashchange', syncRoute);
  window.addEventListener('muzz-denied', async () => {
    if (state.demo) return;
    try {
      await api.recheckAccess();
    } catch (err) {
      if (['below_minimum', 'access_expired', 'claim', 'auth'].includes(err.code)) {
        await dropSession(human(err));
      }
    }
  });
  bindViewport();
  registerWorker();
  setInterval(() => {
    const now = Date.now();
    const alive = (item) => !item.expireAt || item.expireAt > now;
    state.groupMessages = (state.groupMessages || []).filter(alive);
    if (state.demo) {
      for (const peer of Object.keys(state.privateThreads)) {
        state.privateThreads[peer] = state.privateThreads[peer].filter(alive);
      }
      applyDemoView();
    } else if (state.route === 'chat') {
      state.messages = state.groupMessages;
      purgeCache().catch(() => {});
    } else {
      state.messages = (state.messages || []).filter(alive);
      purgeCache().catch(() => {});
    }
    paint();
  }, 30000);

  state.mobile = wallet.isMobile();
  state.pageUrl = location.href.split('#')[0];
  state.inApp = inAppWalletId(navigator.userAgent);
  state.wcReady = Boolean(getConfig().walletConnectProjectId);
  if (state.demo) {
    seedDemo();
    syncRoute();
    return;
  }
  wallet.inspectInjected().then((found) => {
    state.wallets = found.wallets;
    state.wcReady = Boolean(getConfig().walletConnectProjectId);
    if (found.restored && !state.me) {
      state.notice = `Wallet reconnected (${shortAddr(found.restored)}). Tap Connect wallet and sign again to enter.`;
    }
    painted = '';
    paint();
  }).catch(() => {});
  wallet.peekWalletConnect().then((address) => {
    if (!address || state.me) return;
    state.notice = `Wallet reconnected (${shortAddr(address)}). Tap Connect wallet and sign again to enter.`;
    painted = '';
    paint();
  }).catch(() => {});
  api.initBackend();
  api.watchAuth((user) => {
    if (!user) {
      state.booting = false;
      if (bootedFor) {
        bootedFor = '';
        state.me = null;
      }
      syncRoute();
      return;
    }
    enterSession(user);
  });
  syncRoute();
}

async function loadLocalConfig() {
  try {
    const res = await fetch('./config.local.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data !== 'object') return;
    globalThis.MUZZ_RUNTIME = globalThis.MUZZ_RUNTIME || {};
    const runtime = globalThis.MUZZ_RUNTIME;
    const id = String(data.walletConnectProjectId || '').trim();
    if (/^[a-f0-9]{32}$/i.test(id)) runtime.walletConnectProjectId = id;
    if (data.preview === true) runtime.preview = true;
    if (typeof data.functionsBase === 'string' && data.functionsBase.trim()) {
      runtime.functionsBase = data.functionsBase.trim().replace(/\/$/, '');
    }
    const min = Number(data.minMuzz);
    if (Number.isFinite(min) && min > 0) runtime.minMuzz = min;
    if (data.firebase && typeof data.firebase === 'object') {
      runtime.firebase = { ...(runtime.firebase && typeof runtime.firebase === 'object' ? runtime.firebase : {}), ...data.firebase };
    }
  } catch {
    /* sin config.local.json siguen el runtime público y las wallets inyectadas */
  }
}

loadLocalConfig().finally(() => boot());
