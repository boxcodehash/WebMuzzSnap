/**
 * MuzzSnap Hub — auth guard + menú izquierdo unificado.
 * En web desktop preferir app.html (shell fijo + iframe).
 * Con ?embed=1 o dentro de iframe: oculta nav propia y pide navegación al padre.
 */
(function (global) {
  'use strict';

  function inIframe() {
    try { return global.self !== global.top; } catch (_) { return true; }
  }

  function wantEmbed() {
    try {
      if (/[?&]embed=1(?:&|$)/.test(String(global.location.search || ''))) return true;
      if (inIframe()) return true;
    } catch (_) {}
    return false;
  }

  var IS_EMBED = wantEmbed();

  var BASE = (function () {
    var p = String(location.pathname || '').replace(/\\/g, '/');
    var i = p.lastIndexOf('/muzzocial/');
    if (i >= 0) return p.slice(0, i + '/muzzocial'.length);

    // Capacitor / file / flat Vercel deploy: same folder as page
    var dir = p.replace(/\/[^/]*$/, '');
    if (!dir || dir === '/') return '';
    // Avoid treating /app as base
    if (/\/app$/i.test(dir)) return dir.replace(/\/app$/i, '') || '';
    return dir;
  })();

  function join(base, file) {
    if (!base) return file;
    if (base.slice(-1) === '/') return base + file;
    return base + '/' + file;
  }

  // Prefer clean paths on Vercel host; keep .html for local/Capacitor
  var CLEAN = /\.vercel\.app$/i.test(location.hostname) ||
    /muzzsnap\.com$/i.test(location.hostname);

  function page(nameHtml, cleanName) {
    if (CLEAN) return '/' + (cleanName || nameHtml.replace(/\.html$/i, ''));
    return join(BASE, nameHtml);
  }

  var PATHS = {
    login: CLEAN ? '/' : join(BASE, 'index.html'),
    app: CLEAN ? '/app' : join(BASE, 'app.html'),
    social: page('social.html', 'social'),
    profile: page('profile.html', 'profile'),
    chat: page('chat.html', 'chat'),
    private: page('private.html', 'private'),
    game: page('game.html', 'game'),
    buy: page('buy.html', 'buy'),
    studio: page('muzzstudio.html', 'muzzstudio'),
    whitepaper: page('whitepaper.html', 'whitepaper'),
    muzzid: page('muzzid.html', 'muzzid'),
    galaxy: '/MUZZ-GALAXY/www/index.html',
    studioApp: '/streamingsoftware/MuzzStudio-LIVE/index.html',
    studioWallet: '/streamingsoftware/MuzzStudio-LIVE/wallet-login.html'
  };

  var SECTION_BY_FILE = {
    'index.html': null,
    'app.html': null,
    'social.html': 'social',
    'profile.html': 'profile',
    'chat.html': 'chat',
    'private.html': 'private',
    'game.html': 'game',
    'muzzstudio.html': 'studio',
    'buy.html': 'buy',
    'muzzid.html': 'muzzid',
    'whitepaper.html': 'whitepaper'
  };

  function getWallet() {
    return String(sessionStorage.getItem('muzz_wallet_address') || '').trim();
  }

  var MIN_MUZZ = 2000000;

  function goLogin() {
    var url = PATHS.login;
    try {
      if (inIframe() && global.parent) {
        global.parent.location.href = url;
        return;
      }
    } catch (_) {}
    location.href = url;
  }

  function requireAuth(opts) {
    opts = opts || {};
    var w = getWallet();
    var method = sessionStorage.getItem('muzz_login_method') || '';
    var gate = sessionStorage.getItem('muzz_social_gate') || '';
    var isAdmin = sessionStorage.getItem('muzz_is_admin') === 'true';
    var balance = Number(sessionStorage.getItem('muzz_token_balance') || 0);
    var isGuest = !w || w.indexOf('guest_') === 0 || method === 'guest';

    if (global.MuzzAuthGate && typeof global.MuzzAuthGate.canEnterHub === 'function') {
      var check = global.MuzzAuthGate.canEnterHub();
      if (!check.ok && !opts.allowPublic) {
        goLogin();
        return null;
      }
      return {
        wallet: w,
        guest: false,
        username: sessionStorage.getItem('muzz_profile_display') || sessionStorage.getItem('muzz_username') || ('Node_' + String(w).slice(-4)),
        role: sessionStorage.getItem('muzz_user_role') || 'user',
        isAdmin: !!check.admin || isAdmin,
        gate: check.ok ? 'ok' : 'deny',
        balance: balance,
        entryPath: check.path || sessionStorage.getItem('muzz_entry_path') || ''
      };
    }

    if (!w || isGuest) {
      goLogin();
      return null;
    }
    if (!isAdmin && gate !== 'ok' && balance < MIN_MUZZ) {
      goLogin();
      return null;
    }

    return {
      wallet: w,
      guest: false,
      username: sessionStorage.getItem('muzz_username') || ('Node_' + w.slice(-4)),
      role: sessionStorage.getItem('muzz_user_role') || 'user',
      isAdmin: isAdmin,
      gate: gate || (balance >= MIN_MUZZ ? 'ok' : 'deny'),
      balance: balance
    };
  }

  function disconnect() {
    try { sessionStorage.clear(); } catch (e) {}
    goLogin();
  }

  function shortAddr(a) {
    if (!a || a.length < 12) return a || '';
    return a.slice(0, 6) + '…' + a.slice(-4);
  }

  function navigateToSection(sectionId) {
    // Always use original pages (user sidebar). No app.html shell.
    try {
      if (inIframe() && global.parent && global.parent !== global) {
        // If somehow still in an old shell iframe, break out to real page
        var mapIframe = {
          social: PATHS.social, profile: PATHS.profile, chat: PATHS.chat,
          private: PATHS.private, game: PATHS.game, studio: PATHS.studio,
          buy: PATHS.buy, muzzid: PATHS.muzzid, whitepaper: PATHS.whitepaper
        };
        if (mapIframe[sectionId]) {
          global.top.location.href = mapIframe[sectionId];
          return true;
        }
      }
    } catch (_) {}
    var map = {
      social: PATHS.social,
      profile: PATHS.profile,
      chat: PATHS.chat,
      private: PATHS.private,
      game: PATHS.game,
      studio: PATHS.studio,
      buy: PATHS.buy,
      muzzid: PATHS.muzzid,
      whitepaper: PATHS.whitepaper
    };
    if (map[sectionId]) {
      location.href = map[sectionId];
      return true;
    }
    return false;
  }

  function fileToSection(href) {
    try {
      var path = String(href || '');
      var m = path.match(/\/?([a-z0-9_-]+)\.html(?:[?#]|$)/i);
      if (!m) {
        m = path.match(/\/(social|profile|chat|private|game|muzzstudio|buy|muzzid|whitepaper|index|app)(?:\/?(?:[?#]|$))/i);
        if (m) {
          var id = m[1].toLowerCase();
          if (id === 'muzzstudio') return 'studio';
          if (id === 'index' || id === 'app') return null;
          return id;
        }
        return null;
      }
      var file = m[1].toLowerCase() + '.html';
      if (file === 'muzzstudio.html') return 'studio';
      return SECTION_BY_FILE[file] || null;
    } catch (_) {
      return null;
    }
  }

  function injectEmbedCss() {
    if (document.getElementById('muzz-embed-css')) return;
    var css = document.createElement('style');
    css.id = 'muzz-embed-css';
    css.textContent =
      'html.muzz-embed .muzz-sidebar,' +
      'html.muzz-embed #muzzNavMount,' +
      'html.muzz-embed aside.muzz-sidebar,' +
      'html.muzz-embed .sidebar,' +
      'html.muzz-embed .side,' +
      'html.muzz-embed .mobile-bottom,' +
      'html.muzz-embed .fab{display:none!important}' +
      'html.muzz-embed .app,' +
      'html.muzz-embed .layout,' +
      'html.muzz-embed .muzz-desktop-app{' +
      'grid-template-columns:minmax(0,1fr)!important;' +
      'padding:0!important;gap:0!important;max-width:none!important;width:100%!important;' +
      'height:100dvh!important;min-height:100dvh!important}' +
      'html.muzz-embed .rightbar{display:none!important}' +
      'html.muzz-embed .feed-shell,' +
      'html.muzz-embed .main,' +
      'html.muzz-embed .chat{' +
      'border-radius:0!important;height:100dvh!important;max-height:100dvh!important;' +
      'min-height:100dvh!important;box-shadow:none!important}';
    document.head.appendChild(css);
    try { document.documentElement.classList.add('muzz-embed'); } catch (_) {}
  }

  function patchInlineLocationClicks() {
    try {
      document.querySelectorAll('[onclick]').forEach(function (el) {
        var oc = el.getAttribute('onclick') || '';
        var m = oc.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (!m) return;
        var sec = fileToSection(m[1]);
        if (!sec) return;
        el.removeAttribute('onclick');
        el.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          navigateToSection(sec);
        });
      });
    } catch (_) {}
  }

  function wireEmbedLinkInterceptor() {
    patchInlineLocationClicks();
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el) return;
      var node = el;
      for (var i = 0; i < 6 && node; i++) {
        var href = node.getAttribute && (node.getAttribute('href') || node.getAttribute('data-href'));
        if (href && !/^https?:/i.test(href) && !/^mailto:/i.test(href) && href.charAt(0) !== '#') {
          var sec = fileToSection(href);
          if (sec) {
            ev.preventDefault();
            ev.stopPropagation();
            navigateToSection(sec);
            return;
          }
        }
        var nav = node.getAttribute && node.getAttribute('data-nav');
        if (nav) {
          ev.preventDefault();
          ev.stopPropagation();
          navigateToSection(nav);
          return;
        }
        node = node.parentElement;
      }
    }, true);
  }

  /** active: 'social' | 'profile' | 'chat' | 'private' | 'game' | 'buy' | 'studio' | 'whitepaper' */
  function renderNav(active, mountSelector) {
    var session = requireAuth();
    if (!session) return;

    if (IS_EMBED) {
      injectEmbedCss();
      wireEmbedLinkInterceptor();
      // Hide mount if present
      var mount = document.querySelector(mountSelector || '#muzzNavMount');
      if (mount) mount.style.display = 'none';
      return session;
    }

    function tr(key, fallback) {
      return (global.MuzzI18n && MuzzI18n.t) ? MuzzI18n.t(key) : fallback;
    }

    var items = [
      { id: 'social', icon: '🌐', key: 'nav.social', label: 'Social' },
      { id: 'profile', icon: '👤', key: 'nav.profile', label: 'Profile' },
      { id: 'chat', icon: '💬', key: 'nav.chat', label: 'Chat' },
      { id: 'private', icon: '🔒', key: 'nav.private', label: 'Private' },
      { id: 'game', icon: '🎮', key: 'nav.game', label: 'MUZZ Galaxy' },
      { id: 'studio', icon: '🎬', key: 'nav.studio', label: 'MuzzStudio' },
      { id: 'buy', icon: '🛒', key: 'nav.buy', label: 'Buy MUZZ' },
      { id: 'whitepaper', icon: '📄', key: 'nav.whitepaper', label: 'Whitepaper' },
      { id: 'muzzid', icon: '🪪', key: 'nav.muzzid', label: 'MuzzID' }
    ];

    var navHtml = items.map(function (it) {
      var cls = 'muzz-nav-btn' + (it.id === active ? ' active' : '');
      var label = tr(it.key, it.label);
      return '<button type="button" class="' + cls + '" data-nav="' + it.id + '">' +
        '<span class="muzz-nav-icon">' + it.icon + '</span><span data-i18n="' + it.key + '">' + label + '</span></button>';
    }).join('');

    navHtml +=
      '<button type="button" class="muzz-nav-btn" data-href="https://t.me/MuzzSnap" data-ext="1">' +
      '<span class="muzz-nav-icon">✈️</span><span data-i18n="nav.telegram">' + tr('nav.telegram', 'Telegram') + '</span></button>' +
      '<button type="button" class="muzz-nav-btn" data-href="https://x.com/MuzzleToken" data-ext="1">' +
      '<span class="muzz-nav-icon">𝕏</span><span>X.com</span></button>';

    var curLang = (global.MuzzI18n && MuzzI18n.getLang) ? MuzzI18n.getLang() : 'en';
    navHtml +=
      '<div class="muzz-lang" title="' + tr('lang.label', 'Language') + '">' +
      '<button type="button" class="muzz-lang-btn' + (curLang === 'es' ? ' active' : '') + '" data-set-lang="es">ES</button>' +
      '<button type="button" class="muzz-lang-btn' + (curLang === 'en' ? ' active' : '') + '" data-set-lang="en">EN</button>' +
      '</div>';

    var tail = String(session.wallet || '').replace(/^0x/i, '').slice(-6).toLowerCase();
    var nftName = '';
    try {
      var rawNft = sessionStorage.getItem('muzz_id_nft');
      if (rawNft) nftName = (JSON.parse(rawNft).name || JSON.parse(rawNft).username || '');
    } catch (e) {}
    if (!nftName) nftName = sessionStorage.getItem('muzz_profile_display') || '';
    var showName = nftName || tail || session.username;
    var isNft = !!sessionStorage.getItem('muzz_id_nft') || sessionStorage.getItem('muzz_profile_is_nft') === '1';

    var profile =
      '<button type="button" class="muzz-profile" id="muzzOpenProfile" data-i18n-title="nav.openProfile" title="' + tr('nav.openProfile', 'Open profile') + '" style="width:100%;cursor:pointer;text-align:left;font:inherit;color:inherit">' +
      '<div class="muzz-avatar">' + String(showName).slice(0, 2).toUpperCase() + '</div>' +
      '<div class="muzz-profile-meta">' +
      '<div class="muzz-profile-name">' + escapeHtml(showName) +
      (isNft ? ' <span title="MuzzID" style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:7px;background:linear-gradient(145deg,#ff3d3d,#7a0c0c);font-size:12px;vertical-align:middle;box-shadow:0 0 10px rgba(255,43,43,.35)">👻</span>' : '') +
      '</div>' +
      '<div class="muzz-profile-sub">' + escapeHtml(shortAddr(session.wallet)) +
      (session.balance ? (' · ' + Math.floor(session.balance).toLocaleString() + ' MUZZ') : '') + '</div>' +
      '</div></button>' +
      '<button type="button" class="muzz-disconnect" id="muzzDisconnect" data-i18n="nav.disconnect">' + tr('nav.disconnect', 'Disconnect') + '</button>';

    var root = document.querySelector(mountSelector || '#muzzNavMount');
    if (!root) {
      root = document.createElement('aside');
      root.id = 'muzzNavMount';
      root.className = 'muzz-sidebar';
      document.body.insertBefore(root, document.body.firstChild);
    }

    root.innerHTML =
      '<div class="muzz-brand"><div class="muzz-badge">👻</div><h1>MUZZ<span>SNAP</span></h1></div>' +
      '<nav class="muzz-nav">' + navHtml + '</nav>' +
      profile;

    root.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigateToSection(btn.getAttribute('data-nav'));
      });
    });
    root.querySelectorAll('[data-href]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var href = btn.getAttribute('data-href');
        if (btn.getAttribute('data-ext')) {
          window.open(href, '_blank');
          return;
        }
        location.href = href;
      });
    });
    root.querySelectorAll('[data-set-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var L = btn.getAttribute('data-set-lang');
        if (global.MuzzI18n) MuzzI18n.setLang(L);
        renderNav(active, mountSelector);
        if (global.MuzzI18n) MuzzI18n.apply(document);
      });
    });
    var d = document.getElementById('muzzDisconnect');
    if (d) d.addEventListener('click', disconnect);
    var op = document.getElementById('muzzOpenProfile');
    if (op) op.addEventListener('click', function () { navigateToSection('profile'); });

    if (global.MuzzI18n) MuzzI18n.apply(root);

    injectShellCss();
    return session;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
  }

  function injectShellCss() {
    if (document.getElementById('muzz-shell-css')) return;
    var css = document.createElement('style');
    css.id = 'muzz-shell-css';
    css.textContent =
      '.muzz-sidebar{display:flex;flex-direction:column;gap:10px;padding:14px 12px;min-height:0;height:100%;overflow:auto;box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none}' +
      '.muzz-sidebar::-webkit-scrollbar{width:0;height:0;display:none}' +
      '.muzz-brand{display:flex;align-items:center;gap:12px;padding:4px 4px 12px}' +
      '.muzz-badge{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,#ff3b3b,#9d1111);font-size:18px;box-shadow:0 0 24px rgba(255,43,43,.25)}' +
      '.muzz-brand h1{margin:0;font-size:20px;font-weight:900;font-style:italic;letter-spacing:-.04em;color:inherit}' +
      '.muzz-brand h1 span{color:#ff2b2b}' +
      '.muzz-nav{display:flex;flex-direction:column;gap:4px;flex:1}' +
      '.muzz-nav-btn{border:none;background:transparent;color:inherit;display:flex;align-items:center;gap:12px;padding:12px 12px;border-radius:999px;cursor:pointer;text-align:left;width:100%;font:inherit;opacity:.92}' +
      '.muzz-nav-btn:hover,.muzz-nav-btn.active{background:rgba(255,43,43,.14);color:#fff}' +
      '.muzz-lang{display:flex;gap:6px;padding:10px 8px 4px;margin-top:6px}' +
      '.muzz-lang-btn{flex:1;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#93a0b3;border-radius:10px;padding:8px;font-weight:800;font-size:11px;letter-spacing:.08em;cursor:pointer}' +
      '.muzz-lang-btn.active{background:rgba(255,43,43,.18);border-color:rgba(255,43,43,.4);color:#fff}' +
      '.muzz-lang-btn:hover{color:#fff}' +
      '.muzz-nav-btn.disabled,.muzz-nav-btn:disabled{opacity:.45;cursor:not-allowed;pointer-events:none}' +
      '.muzz-soon{font-size:9px;letter-spacing:.1em;color:#fbbf24;margin-left:6px;border:1px solid rgba(251,191,36,.35);padding:1px 6px;border-radius:999px}' +
      '.muzz-nav-icon{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.05);flex-shrink:0}' +
      '.muzz-profile{margin-top:auto;display:flex;align-items:center;gap:10px;padding:12px;border-radius:999px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)}' +
      '.muzz-avatar{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#3a4552,#19202a);font-weight:800;flex-shrink:0}' +
      '.muzz-profile-name{font-weight:800;font-size:13px}.muzz-profile-sub{font-size:11px;opacity:.65;overflow:hidden;text-overflow:ellipsis}' +
      '.muzz-disconnect{margin-top:8px;width:100%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:inherit;padding:10px;border-radius:999px;cursor:pointer;font:inherit;font-size:12px;font-weight:700}' +
      '@media(min-width:981px){.muzz-sidebar{min-height:100dvh}}';
    document.head.appendChild(css);
  }

  // Auto-embed if loaded inside shell
  if (IS_EMBED) {
    injectEmbedCss();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wireEmbedLinkInterceptor);
    } else {
      wireEmbedLinkInterceptor();
    }
  }

  global.MuzzShell = {
    PATHS: PATHS,
    BASE: BASE,
    IS_EMBED: IS_EMBED,
    requireAuth: requireAuth,
    renderNav: renderNav,
    disconnect: disconnect,
    shortAddr: shortAddr,
    getWallet: getWallet,
    navigateToSection: navigateToSection
  };
})(window);
