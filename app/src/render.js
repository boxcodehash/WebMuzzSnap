import { getConfig } from './config.js';
import { dayLabel, formatMuzz, metaLine } from './format.js';
import { avatarColor, avatarText, displayName, shortAddr } from './names.js';
import { SUPPORTED_WALLETS } from './walletCatalog.js';
import { walletDeepLinks } from './walletLinks.js';

const PHASES = {
  connect: ['Connecting the wallet', 'Approve the connection. It does not authorize any spend.'],
  chain: ['Ethereum network', 'If the wallet is on another network, switch it to mainnet.'],
  nonce: ['Preparing access', 'The server issues a one-time nonce.'],
  sign: ['Sign the message', 'This proves the wallet is yours. It does not spend gas.'],
  verify: ['Checking MUZZ', 'The signature and the balance are verified on the server.'],
  keys: ['Preparing encryption', 'The keys stay on this device.']
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
  return parts.join('');
}

function tabs(state) {
  const chatOn = state.route === 'chat';
  const privateOn = state.route === 'privado' || state.route === 'hilo';
  return `<nav class="tabbar">
    <button type="button" data-action="go" data-route="chat" class="${chatOn ? 'on' : ''}">Chat</button>
    <button type="button" data-action="go" data-route="privado" class="${privateOn ? 'on' : ''}">Private</button>
  </nav>`;
}

function composer(state, placeholder) {
  const file = state.file
    ? `<div class="file-chip"><span>${esc(state.file.name)}</span><button type="button" data-action="clear-file" aria-label="Remove attachment">×</button></div>`
    : '';
  return `<form class="composer" id="composer">
    ${file}
    <div class="composer-row">
      <button type="button" class="icon-btn" data-action="pick-file" aria-label="Attach file">${ICONS.clip}</button>
      <input id="file" type="file" hidden>
      <textarea id="draft" rows="1" maxlength="2000" placeholder="${esc(placeholder)}" enterkeyhint="send"></textarea>
      <button id="sendBtn" class="send" type="submit" aria-label="Send">${ICONS.send}</button>
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
      : '<p class="empty">Nobody else is online right now.</p>';
    return wrapSheet('Online', '<p class="sheet-note">Tap someone to message them privately.</p>' + people);
  }
  if (state.panel === 'info') {
    const balance = state.balance ? `<p class="sheet-note">Verified balance: <strong>${esc(state.balance)} MUZZ</strong>. Minimum ${esc(formatMuzz(state.minMuzz))}.</p>` : '';
    return wrapSheet('How this is protected', `
      ${balance}
      <ul class="sheet-list">
        <li>Each message uses a new ephemeral key, a one-time prekey from the recipient, and a server factor.</li>
        <li>Firebase stores the factor and the ciphertext. That alone cannot read the message.</li>
        <li>In private chat, the 24 h timer starts when the message is read. In the group, your copy expires 24 h after you send it; each person’s copy expires 24 h after they open it.</li>
        <li>Private keys never leave this device.</li>
      </ul>
      <button type="button" class="btn btn-ghost" data-action="logout">Log out</button>
      <button type="button" class="btn btn-danger" data-action="wipe">Delete keys on this device</button>
    `);
  }
  if (state.panel === 'wallets') {
    const buttons = (state.wallets || []).map((item) => `<button type="button" class="btn btn-ghost" data-action="login" data-kind="injected" data-wallet="${esc(item.id)}">Continue with ${esc(item.name)}</button>`).join('');
    const empty = buttons || '<p class="sheet-note">No injected wallet was found in this browser.</p>';
    return wrapSheet('Choose a wallet', `${empty}<p class="sheet-note">The QR code and other WalletConnect wallets need the project id.</p>`);
  }
  if (state.panel === 'trust' && state.trust) {
    return wrapSheet('Key changed', `
      <p class="sheet-note">The identity of ${esc(displayName(state.trust.wallet))} does not match the one stored on this device. If you do not confirm it out of band, someone could be in the middle.</p>
      <p class="mono">${esc(shortAddr(state.trust.wallet))}</p>
      <button type="button" class="btn btn-primary" data-action="trust-accept">I trust the new key</button>
      <button type="button" class="btn btn-ghost" data-action="panel" data-panel="">Cancel</button>
    `);
  }
  return '';
}

function wrapSheet(title, body) {
  return `<div class="backdrop" data-action="panel" data-panel=""></div>
    <section class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" data-action="panel" data-panel="" aria-label="Close">×</button></div>
      ${body}
    </section>`;
}

function loginButtons(state) {
  const injected = state.wallets || [];
  const inApp = injected.find((item) => item.id === state.inApp);
  const parts = [];
  if (inApp) {
    parts.push(`<button type="button" class="btn btn-primary" data-action="login" data-kind="injected" data-wallet="${esc(inApp.id)}">Continue with ${esc(inApp.name)}</button>`);
  }
  parts.push(`<button type="button" class="btn ${inApp ? 'btn-ghost' : 'btn-primary'}" data-action="login" data-kind="modal">Connect wallet</button>`);
  if (!state.wcReady && injected.length && !inApp) {
    for (const item of injected) {
      parts.push(`<button type="button" class="btn btn-ghost" data-action="login" data-kind="injected" data-wallet="${esc(item.id)}">Continue with ${esc(item.name)}</button>`);
    }
  }
  if (state.mobile) {
    const links = walletDeepLinks(state.pageUrl || '').map((item) => `<a href="${esc(item.href)}">${esc(item.name)}</a>`).join('');
    parts.push(`<details class="deeplinks"><summary>Open in wallet</summary><p class="fine">If this browser has no wallet, open it here. The page loads inside the wallet so you can sign.</p><div class="link-row">${links}</div></details>`);
  }
  return parts.join('');
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
      <p class="lede">Group chat and private messages for holders. End-to-end encrypted.</p>
      <dl class="gate">
        <div><dt>Minimum</dt><dd>${esc(formatMuzz(state.minMuzz || cfg.minMuzz))} MUZZ</dd></div>
        <div><dt>Contract</dt><dd>${esc(shortAddr(cfg.tokenAddress))}</dd></div>
        <div><dt>Proof</dt><dd>Nonce signature</dd></div>
      </dl>
    </div>
    <div class="login-actions">
      <div id="banner"></div>
      ${loginButtons(state)}
      <p class="fine">${esc(SUPPORTED_WALLETS.map((item) => item.name).join(', '))} and any WalletConnect wallet. On desktop, a QR code. On mobile, the wallet returns to this page. Phantom must be on Ethereum, not Solana.</p>
      <p class="fine">The signature is not a transaction. The server reads <span class="mono">balanceOf</span> and opens a session only if you meet the minimum. If the balance drops, the session ends.</p>
    </div>
    ${overlay}
  </section>`;
}

function topbar(title, subtitle, extra) {
  return `<header class="top">
    ${extra || `<img src="muzzsnap.jpg" alt="" class="brand-mark">`}
    <div class="top-text"><h1>${title}</h1><p>${subtitle}</p></div>
    <button type="button" class="count" data-action="panel" data-panel="online" aria-label="Online"><span id="onlineCount">${''}</span></button>
    <button type="button" class="icon-btn" data-action="panel" data-panel="info" aria-label="Security">${ICONS.lock}</button>
  </header>`;
}

export function shellHtml(state) {
  if (state.booting) {
    return `<section class="splash"><img src="muzzsnap.jpg" alt=""><p>Connecting</p></section>`;
  }
  if (!state.me || state.route === 'login') return loginHtml(state);
  const panel = sheet(state);
  if (state.route === 'chat') {
    return `<section class="shell">
      ${topbar('General', 'End-to-end encrypted')}
      <div id="banner" class="banner-slot"></div>
      <div id="msgs" class="msgs"></div>
      ${composer(state, 'Encrypted message')}
      ${tabs(state)}
      ${panel}
    </section>`;
  }
  if (state.route === 'hilo') {
    const back = `<button type="button" class="icon-btn" data-action="go" data-route="privado" aria-label="Back">${ICONS.back}</button>`;
    return `<section class="shell">
      ${topbar(esc(displayName(state.peer)), esc(shortAddr(state.peer)), back)}
      <div id="banner" class="banner-slot"></div>
      <div id="msgs" class="msgs"></div>
      ${composer(state, 'Private message')}
      ${tabs(state)}
      ${panel}
    </section>`;
  }
  return `<section class="shell">
    ${topbar('Private', 'Only you and the other wallet')}
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
      ? 'No messages yet. What you write is encrypted for each holder who is online.'
      : 'No messages in this thread. The first one is encrypted too.';
    return `<div class="empty-block"><span class="lock-badge">${ICONS.lock}</span><p>${text}</p></div>`;
  }
  let lastDay = '';
  return list.map((message) => {
    const day = dayLabel(message.sentAt);
    const divider = day && day !== lastDay ? `<div class="day">${esc(day)}</div>` : '';
    lastDay = day || lastDay;
    const body = message.text != null
      ? `<p>${esc(message.text)}</p>`
      : `<p class="locked">${esc(message.locked || 'Cannot be opened on this device.')}</p>`;
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
    return `<div class="empty-block"><span class="lock-badge">${ICONS.lock}</span><p>No conversations yet. Open Online and pick a wallet.</p></div>`;
  }
  return list.map((thread) => `<button type="button" class="thread" data-action="open-peer" data-peer="${esc(thread.wallet)}">
    <span class="avatar" style="background:${avatarColor(thread.wallet)}">${esc(avatarText(thread.wallet))}</span>
    <span class="thread-body"><strong>${esc(displayName(thread.wallet))}</strong><small>${esc(thread.preview || 'Encrypted message')}</small></span>
    <time>${esc(thread.updatedAt ? metaTime(thread.updatedAt) : '')}</time>
  </button>`).join('');
}

function metaTime(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(date);
}
