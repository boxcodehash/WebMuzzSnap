import { ethers } from 'ethers';
import { buildLoginMessage } from '../shared/loginMessage.js';
import { demoAllowed, getConfig } from './config.js';
import { formatMuzz } from './format.js';
import { purgeCache } from './keys.js';
import * as api from './api.js';
import { bannerHtml, messagesHtml, shellHtml } from './render.js';
import * as wallet from './wallet.js';

const DEMO_ME = '0x875c5a7794b601f273da0000000000000000d3e0';
const DEMO_A = '0x4c1e90aa77b3d81264c00000000000000000a91f';
const DEMO_B = '0x90bb12cd44e671aa0099000000000000000022ce';

const state = {
  route: 'login',
  phase: '',
  error: '',
  notice: '',
  deepLink: '',
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
      return `Saldo insuficiente. Tienes ${formatBalance(payload)} MUZZ y el mínimo es ${formatMuzz(payload.minMuzz)} MUZZ.`;
    }
    return `Hacen falta al menos ${formatMuzz(state.minMuzz)} MUZZ.`;
  }
  const map = {
    functions_unconfigured: 'Falta functionsBase en config.runtime.js. Sin las Cloud Functions el servidor no puede comprobar el saldo.',
    NO_WALLET: 'No hay una wallet en este navegador. Instala MetaMask o entra con WalletConnect.',
    NO_PROJECT_ID: 'WalletConnect necesita walletConnectProjectId en config.runtime.js.',
    wc_load: 'No se pudo cargar WalletConnect. Revisa la conexión e inténtalo otra vez.',
    rejected: 'La wallet canceló la conexión o la firma.',
    chain: 'Hay que usar Ethereum mainnet.',
    network: 'Sin conexión con el servidor de acceso.',
    format: 'El mensaje de acceso no es válido.',
    issued_skew: 'La hora del dispositivo está desfasada. Ajústala e inténtalo de nuevo.',
    nonce: 'Ese intento ya no vale. Vuelve a firmar.',
    origin: 'Este origen no está autorizado en el servidor.',
    token: 'El contrato firmado no coincide con el del servidor.',
    minimum: 'El mínimo firmado no coincide con el del servidor.',
    address: 'La firma no corresponde a esa wallet.',
    signature: 'No se pudo verificar la firma.',
    rpc_failed: 'No se pudo leer el saldo en Ethereum. No se ha cerrado el acceso por eso.',
    access_expired: 'La sesión caducó. Entra otra vez para comprobar el saldo.',
    claim: 'La sesión no tiene permiso de holder.',
    auth: 'La sesión no es válida. Entra otra vez.',
    NO_PREKEY: 'Esa persona no tiene llaves de un solo uso disponibles.',
    NO_KEYS: 'Esa wallet todavía no ha publicado sus llaves.',
    no_members: 'Aún no hay otros holders en el grupo.',
    too_many: 'Hay demasiados miembros para un solo envío.',
    too_long: 'El mensaje pasa de 2.000 caracteres.',
    file_size: 'El adjunto supera 8 MB.',
    TRUST: 'La llave de identidad cambió.'
  };
  return map[code] || 'No se pudo completar la operación.';
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
      text: '¿Dejamos el acceso en diez millones de MUZZ?',
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
      text: 'Sí. Si el saldo baja de ahí, la sesión se cierra sola.',
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
      text: 'Recibido. Mi copia de este mensaje se borra a las 24 h.',
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
        text: 'Te escribo por el canal privado. Esto no lo ve el grupo.',
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
        text: 'Enterado. Se borra 24 horas después de que lo leas.',
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
    { wallet: DEMO_A, preview: 'Enterado. Se borra 24 horas después de que lo leas.', updatedAt: now - 8 * 60 * 1000 },
    { wallet: DEMO_B, preview: 'Mensaje cifrado', updatedAt: now - 2 * 60 * 60 * 1000 }
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

async function dropSession(message) {
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
        dropSession('El acceso se cerró: el saldo ya no llega al mínimo o la sesión fue revocada.');
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

async function login(kind) {
  state.error = '';
  state.notice = '';
  state.deepLink = '';
  if (!getConfig().functionsBase) {
    state.error = human({ code: 'functions_unconfigured' });
    paint();
    return;
  }
  try {
    state.phase = 'connect';
    paint();
    const session = kind === 'walletconnect'
      ? await wallet.connectWalletConnect()
      : await wallet.connectMetaMask();
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
    const signature = await wallet.signLogin(session.signer, message);
    state.phase = 'verify';
    paint();
    const result = await api.verifyAccess(message, signature);
    state.balance = formatBalance(result);
    state.minMuzz = Number(result.minMuzz || state.minMuzz);
    api.noteFreshLogin();
    await api.signInToken(result.token);
    state.phase = '';
  } catch (err) {
    state.phase = '';
    state.error = human(err);
    if (err.code === 'NO_WALLET' && wallet.isMobile()) state.deepLink = wallet.metamaskDeepLink();
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
        state.notice = `Enviado. ${result.skipped.length} ${result.skipped.length === 1 ? 'persona no tenía' : 'personas no tenían'} llave de un solo uso.`;
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
    await login(button.dataset.kind);
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
    paint();
    return;
  }
  if (action === 'wipe') {
    if (!window.confirm('Se borrarán las llaves y los mensajes guardados en este dispositivo. No se pueden recuperar.')) return;
    if (!state.demo) await api.eraseDeviceKeys();
    await dropSession('Llaves borradas en este dispositivo.');
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

  if (state.demo) {
    seedDemo();
    syncRoute();
    return;
  }
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

boot();
