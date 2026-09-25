import { getConfig } from './config.js';
import { dayLabel, formatMuzz, metaLine } from './format.js';
import { avatarColor, avatarText, displayName, shortAddr } from './names.js';

const PHASES = {
  connect: ['Conectando la wallet', 'Aprueba la conexión. No autoriza ningún gasto.'],
  chain: ['Red Ethereum', 'Si la wallet está en otra red, cámbiala a mainnet.'],
  nonce: ['Preparando el acceso', 'El servidor emite un nonce de un solo uso.'],
  sign: ['Firma el mensaje', 'Así se prueba que la wallet es tuya. No gasta gas.'],
  verify: ['Comprobando MUZZ', 'La firma y el saldo se verifican en el servidor.'],
  keys: ['Preparando el cifrado', 'Las llaves se quedan en este dispositivo.']
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function icon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

const ICONS = {
  lock: icon('<rect x="6" y="10" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10V8a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.7"/>'),
  info: icon('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5M12 8h.01" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  back: icon('<path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  clip: icon('<path d="M8 12.5l6.2-6.2a3 3 0 0 1 4.2 4.2l-7.4 7.4a4.2 4.2 0 0 1-6-6L12 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  send: icon('<path d="M5 12l14-7-4 14-3.2-5.2L5 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>')
};

export function bannerHtml(state) {
  const parts = [];
  if (state.error) parts.push(`<p class="banner bad">${esc(state.error)}</p>`);
  if (state.notice) parts.push(`<p class="banner ok">${esc(state.notice)}</p>`);
  if (state.deepLink) {
    parts.push(`<a class="banner link" href="${esc(state.deepLink)}">Abrir esta página en MetaMask</a>`);
  }
  return parts.join('');
}

function tabs(state) {
  const chatOn = state.route === 'chat';
  const privateOn = state.route === 'privado' || state.route === 'hilo';
  return `<nav class="tabbar">
    <button type="button" data-action="go" data-route="chat" class="${chatOn ? 'on' : ''}">Chat</button>
    <button type="button" data-action="go" data-route="privado" class="${privateOn ? 'on' : ''}">Privado</button>
  </nav>`;
}

function composer(state, placeholder) {
  const file = state.file
    ? `<div class="file-chip"><span>${esc(state.file.name)}</span><button type="button" data-action="clear-file" aria-label="Quitar adjunto">×</button></div>`
    : '';
  return `<form class="composer" id="composer">
    ${file}
    <div class="composer-row">
      <button type="button" class="icon-btn" data-action="pick-file" aria-label="Adjuntar archivo">${ICONS.clip}</button>
      <input id="file" type="file" hidden>
      <textarea id="draft" rows="1" maxlength="2000" placeholder="${esc(placeholder)}" enterkeyhint="send"></textarea>
      <button id="sendBtn" class="send" type="submit" aria-label="Enviar">${ICONS.send}</button>
    </div>
  </form>`;
}

function sheet(state) {
  if (state.panel === 'online') {
    const people = state.online.length
      ? state.online.map((person) => {
        const mine = state.me && person.wallet === state.me.wallet;
        return `<button type="button" class="person" data-action="open-peer" data-peer="${esc(person.wallet)}" ${mine ? 'disabled' : ''}>
          <span class="avatar" style="background:${avatarColor(person.wallet)}">${esc(avatarText(person.wallet))}</span>
          <span><strong>${esc(displayName(person.wallet, state.me && state.me.wallet))}</strong><small>${esc(shortAddr(person.wallet))}</small></span>
        </button>`;
      }).join('')
      : '<p class="empty">Nadie más en línea ahora mismo.</p>';
    return wrapSheet('En línea', '<p class="sheet-note">Toca a alguien para escribirle en privado.</p>' + people);
  }
  if (state.panel === 'info') {
    const balance = state.balance ? `<p class="sheet-note">Saldo verificado: <strong>${esc(state.balance)} MUZZ</strong>. Mínimo ${esc(formatMuzz(state.minMuzz))}.</p>` : '';
    return wrapSheet('Cómo está protegido', `
      ${balance}
      <ul class="sheet-list">
        <li>Cada mensaje usa una llave efímera nueva, una prekey de un solo uso del receptor y un factor del servidor.</li>
        <li>Firebase guarda el factor y el texto cifrado. Con eso solo no puede leer el mensaje.</li>
        <li>En privado, al leerlo empieza a contar 24 h y luego se borra. En el grupo, tu copia caduca a las 24 h del envío; la de cada persona, 24 h después de que ella lo abre.</li>
        <li>Las llaves privadas no salen de este dispositivo.</li>
      </ul>
      <button type="button" class="btn btn-ghost" data-action="logout">Cerrar sesión</button>
      <button type="button" class="btn btn-danger" data-action="wipe">Borrar llaves de este dispositivo</button>
    `);
  }
  if (state.panel === 'trust' && state.trust) {
    return wrapSheet('Cambió la llave', `
      <p class="sheet-note">La identidad de ${esc(displayName(state.trust.wallet))} no coincide con la que guardó este dispositivo. Si no lo confirmas por otro canal, alguien podría ponerse en medio.</p>
      <p class="mono">${esc(shortAddr(state.trust.wallet))}</p>
      <button type="button" class="btn btn-primary" data-action="trust-accept">Confío en la llave nueva</button>
      <button type="button" class="btn btn-ghost" data-action="panel" data-panel="">Cancelar</button>
    `);
  }
  return '';
}

function wrapSheet(title, body) {
  return `<div class="backdrop" data-action="panel" data-panel=""></div>
    <section class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" data-action="panel" data-panel="" aria-label="Cerrar">×</button></div>
      ${body}
    </section>`;
}

function loginHtml(state) {
  const cfg = getConfig();
  const phase = PHASES[state.phase];
  const overlay = phase
    ? `<div class="overlay" role="status"><div class="spinner"></div><h2>${esc(phase[0])}</h2><p>${esc(phase[1])}</p></div>`
    : '';
  return `<section class="login">
    <header class="login-top"><span class="pulse" aria-hidden="true"></span><span>Ethereum mainnet · ERC-20</span></header>
    <div class="login-hero">
      <img src="muzzsnap.jpg" alt="MuzzSnap" class="login-logo">
      <p class="eyebrow">Muzzle Token</p>
      <h1>MuzzSnap</h1>
      <p class="lede">Chat y mensajes privados para holders. Cifrado de extremo a extremo.</p>
      <dl class="gate">
        <div><dt>Mínimo</dt><dd>${esc(formatMuzz(state.minMuzz || cfg.minMuzz))} MUZZ</dd></div>
        <div><dt>Contrato</dt><dd>${esc(shortAddr(cfg.tokenAddress))}</dd></div>
        <div><dt>Prueba</dt><dd>Firma con nonce</dd></div>
      </dl>
    </div>
    <div class="login-actions">
      <div id="banner"></div>
      <button type="button" class="btn btn-primary" data-action="login" data-kind="metamask">Entrar con MetaMask</button>
      <button type="button" class="btn btn-ghost" data-action="login" data-kind="walletconnect">WalletConnect</button>
      <p class="fine">La firma no envía una transacción. El servidor lee <span class="mono">balanceOf</span> y, si llegas al mínimo, abre la sesión. Si el saldo baja, se cierra.</p>
    </div>
    ${overlay}
  </section>`;
}

function topbar(title, subtitle, extra) {
  return `<header class="top">
    ${extra || `<img src="muzzsnap.jpg" alt="" class="brand-mark">`}
    <div class="top-text"><h1>${title}</h1><p>${subtitle}</p></div>
    <button type="button" class="count" data-action="panel" data-panel="online" aria-label="Conectados"><span id="onlineCount">${''}</span></button>
    <button type="button" class="icon-btn" data-action="panel" data-panel="info" aria-label="Seguridad">${ICONS.lock}</button>
  </header>`;
}

export function shellHtml(state) {
  if (state.booting) {
    return `<section class="splash"><img src="muzzsnap.jpg" alt=""><p>Conectando</p></section>`;
  }
  if (!state.me || state.route === 'login') return loginHtml(state);
  const panel = sheet(state);
  if (state.route === 'chat') {
    return `<section class="shell">
      ${topbar('General', 'Cifrado de extremo a extremo')}
      <div id="banner" class="banner-slot"></div>
      <div id="msgs" class="msgs"></div>
      ${composer(state, 'Mensaje cifrado')}
      ${tabs(state)}
      ${panel}
    </section>`;
  }
  if (state.route === 'hilo') {
    const back = `<button type="button" class="icon-btn" data-action="go" data-route="privado" aria-label="Volver">${ICONS.back}</button>`;
    return `<section class="shell">
      ${topbar(esc(displayName(state.peer)), esc(shortAddr(state.peer)), back)}
      <div id="banner" class="banner-slot"></div>
      <div id="msgs" class="msgs"></div>
      ${composer(state, 'Mensaje privado')}
      ${tabs(state)}
      ${panel}
    </section>`;
  }
  return `<section class="shell">
    ${topbar('Privado', 'Solo tú y la otra wallet')}
    <div id="banner" class="banner-slot"></div>
    <div id="msgs" class="msgs threads"></div>
    ${tabs(state)}
    ${panel}
  </section>`;
}

export function messagesHtml(state) {
  if (state.route === 'privado') return threadsHtml(state);
  if (state.route !== 'chat' && state.route !== 'hilo') return '';
  const list = state.messages || [];
  if (!list.length) {
    const text = state.route === 'chat'
      ? 'Todavía no hay mensajes. Lo que escribas se cifra para cada holder conectado.'
      : 'No hay mensajes en este hilo. El primero también queda cifrado.';
    return `<div class="empty-block"><span class="lock-badge">${ICONS.lock}</span><p>${text}</p></div>`;
  }
  let lastDay = '';
  return list.map((message) => {
    const day = dayLabel(message.sentAt);
    const divider = day && day !== lastDay ? `<div class="day">${esc(day)}</div>` : '';
    lastDay = day || lastDay;
    const body = message.text != null
      ? `<p>${esc(message.text)}</p>`
      : `<p class="locked">${esc(message.locked || 'No se puede abrir en este dispositivo.')}</p>`;
    const file = message.fileName
      ? `<button type="button" class="file-link" data-action="download" data-id="${esc(message.id)}" data-path="${esc(message.attachmentPath || '')}" ${message.canDownload ? '' : 'disabled'}>${esc(message.fileName)}</button>`
      : '';
    const who = message.mine ? '' : `<span class="who">${esc(displayName(message.sender))}</span>`;
    return `${divider}<article class="row ${message.mine ? 'mine' : ''}">${who}<div class="bubble">${body}${file}</div><time>${esc(metaLine(message))}</time></article>`;
  }).join('');
}

function threadsHtml(state) {
  const list = state.threads || [];
  if (!list.length) {
    return `<div class="empty-block"><span class="lock-badge">${ICONS.lock}</span><p>No hay conversaciones. Abre “en línea” y elige una wallet.</p></div>`;
  }
  return list.map((thread) => `<button type="button" class="thread" data-action="open-peer" data-peer="${esc(thread.wallet)}">
    <span class="avatar" style="background:${avatarColor(thread.wallet)}">${esc(avatarText(thread.wallet))}</span>
    <span class="thread-body"><strong>${esc(displayName(thread.wallet))}</strong><small>${esc(thread.preview || 'Mensaje cifrado')}</small></span>
    <time>${esc(thread.updatedAt ? metaTime(thread.updatedAt) : '')}</time>
  </button>`).join('');
}

function metaTime(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(date);
}
