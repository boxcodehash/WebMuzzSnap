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
      'html.muzz-embed .muzz-tabbar,' +
      'html.muzz-embed .muzz-sheet,' +
      'html.muzz-embed .muzz-sheet-backdrop,' +
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

  function shellTr(key, fallback) {
    return (global.MuzzI18n && MuzzI18n.t) ? MuzzI18n.t(key) : fallback;
  }

  function icon(name) {
    var paths = {
      social: '<path d="M4 10.5 12 3.5l8 7V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
      profile: '<circle cx="12" cy="8" r="3.25"/><path d="M5.5 19.25a6.5 6.5 0 0 1 13 0"/>',
      chat: '<path d="M5 6.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9.2L5 19.2V7.5a1 1 0 0 1 1-1z"/>',
      private: '<rect x="6" y="11" width="12" height="8.5" rx="1.5"/><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/>',
      game: '<path d="M7 9.5h10a3 3 0 0 1 3 3v1.2a3 3 0 0 1-3 3h-1.4L14 18.2h-4L8.4 16.7H7a3 3 0 0 1-3-3v-1.2a3 3 0 0 1 3-3z"/><path d="M8.2 13.2v2.2M7.1 14.3h2.2M15.6 13.4h.01M17.3 15.1h.01"/>',
      studio: '<rect x="3.5" y="7" width="11" height="10" rx="1.5"/><path d="M14.5 10.5 20 8v8l-5.5-2.5z"/>',
      buy: '<path d="M6.5 8h11l-.8 11.2a1.5 1.5 0 0 1-1.5 1.3H8.8a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
      whitepaper: '<path d="M7 3.5h7.2L19 8.2V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.8V8.5h4.6M8.5 12.5h7M8.5 16h5"/>',
      muzzid: '<rect x="3.5" y="6.5" width="17" height="11" rx="2"/><circle cx="8.5" cy="12" r="1.6"/><path d="M12 10.5h5.5M12 13.5h3.5"/>',
      telegram: '<path d="M20.5 5.2 3.8 11.4l5.2 1.7 1.8 5.5 2.6-3.4 4.6 3.4z"/><path d="m9 13.1 7.2-5.2"/>',
      x: '<path d="M5 5.5 19 18.5M19 5.5 5 18.5"/>',
      more: '<circle cx="6" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.15" fill="currentColor" stroke="none"/>',
      close: '<path d="M7 7l10 10M17 7 7 17"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (paths[name] || paths.more) + '</svg>';
  }

  var NAV_ITEMS = [
    { id: 'social', icon: 'social', key: 'nav.social', label: 'Social' },
    { id: 'profile', icon: 'profile', key: 'nav.profile', label: 'Profile' },
    { id: 'chat', icon: 'chat', key: 'nav.chat', label: 'Chat' },
    { id: 'private', icon: 'private', key: 'nav.private', label: 'Private' },
    { id: 'game', icon: 'game', key: 'nav.game', label: 'MUZZ Galaxy' },
    { id: 'studio', icon: 'studio', key: 'nav.studio', label: 'MuzzStudio' },
    { id: 'buy', icon: 'buy', key: 'nav.buy', label: 'Buy MUZZ' },
    { id: 'whitepaper', icon: 'whitepaper', key: 'nav.whitepaper', label: 'Whitepaper' },
    { id: 'muzzid', icon: 'muzzid', key: 'nav.muzzid', label: 'MuzzID' }
  ];

  var TAB_ITEMS = [
    { id: 'social', icon: 'social', key: 'nav.social', label: 'Social' },
    { id: 'chat', icon: 'chat', key: 'nav.chat', label: 'Chat' },
    { id: 'private', icon: 'private', key: 'nav.private', label: 'Private' },
    { id: 'profile', icon: 'profile', key: 'nav.profile', label: 'Profile' }
  ];

  function navButton(it, active) {
    var cls = 'muzz-nav-btn' + (it.id === active ? ' active' : '');
    var current = it.id === active ? ' aria-current="page"' : '';
    return '<button type="button" class="' + cls + '" data-nav="' + it.id + '"' + current + '>' +
      '<span class="muzz-nav-icon">' + icon(it.icon) + '</span>' +
      '<span class="muzz-nav-label" data-i18n="' + it.key + '">' + shellTr(it.key, it.label) + '</span></button>';
  }

  function closeMore() {
    var sheet = document.getElementById('muzzMoreSheet');
    var bd = document.getElementById('muzzSheetBackdrop');
    if (sheet) sheet.classList.remove('open');
    if (bd) bd.classList.remove('open');
    try { document.body.classList.remove('muzz-sheet-open'); } catch (_) {}
  }

  function openMore() {
    ensureMoreSheet();
    var sheet = document.getElementById('muzzMoreSheet');
    var bd = document.getElementById('muzzSheetBackdrop');
    if (sheet) sheet.classList.add('open');
    if (bd) bd.classList.add('open');
    try { document.body.classList.add('muzz-sheet-open'); } catch (_) {}
  }

  function ensureMoreSheet(active) {
    var bd = document.getElementById('muzzSheetBackdrop');
    if (!bd) {
      bd = document.createElement('div');
      bd.id = 'muzzSheetBackdrop';
      bd.className = 'muzz-sheet-backdrop';
      bd.addEventListener('click', closeMore);
      document.body.appendChild(bd);
    }
    var sheet = document.getElementById('muzzMoreSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'muzzMoreSheet';
      sheet.className = 'muzz-sheet';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      document.body.appendChild(sheet);
    }
    var extras = [
      { id: 'game', icon: 'game', key: 'nav.game', label: 'MUZZ Galaxy' },
      { id: 'studio', icon: 'studio', key: 'nav.studio', label: 'MuzzStudio' },
      { id: 'buy', icon: 'buy', key: 'nav.buy', label: 'Buy MUZZ' },
      { id: 'muzzid', icon: 'muzzid', key: 'nav.muzzid', label: 'MuzzID' },
      { id: 'whitepaper', icon: 'whitepaper', key: 'nav.whitepaper', label: 'Whitepaper' },
      { id: 'profile', icon: 'profile', key: 'nav.profile', label: 'Profile' }
    ];
    var curLang = (global.MuzzI18n && MuzzI18n.getLang) ? MuzzI18n.getLang() : 'en';
    var grid = extras.map(function (it) {
      var on = it.id === active ? ' active' : '';
      return '<button type="button" class="muzz-sheet-item' + on + '" data-nav="' + it.id + '">' +
        '<span class="muzz-nav-icon">' + icon(it.icon) + '</span>' +
        '<span data-i18n="' + it.key + '">' + shellTr(it.key, it.label) + '</span></button>';
    }).join('');
    grid +=
      '<button type="button" class="muzz-sheet-item" data-href="https://t.me/MuzzSnap" data-ext="1">' +
      '<span class="muzz-nav-icon">' + icon('telegram') + '</span><span data-i18n="nav.telegram">' + shellTr('nav.telegram', 'Telegram') + '</span></button>' +
      '<button type="button" class="muzz-sheet-item" data-href="https://x.com/MuzzleToken" data-ext="1">' +
      '<span class="muzz-nav-icon">' + icon('x') + '</span><span>X.com</span></button>';

    sheet.innerHTML =
      '<div class="muzz-sheet-handle" aria-hidden="true"></div>' +
      '<div class="muzz-sheet-head"><strong data-i18n="nav.more">' + shellTr('nav.more', 'More') + '</strong>' +
      '<button type="button" class="muzz-sheet-close" id="muzzSheetClose" data-i18n-aria="nav.close" aria-label="' + shellTr('nav.close', 'Close') + '">' + icon('close') + '</button></div>' +
      '<div class="muzz-sheet-grid">' + grid + '</div>' +
      '<div class="muzz-lang" title="' + shellTr('lang.label', 'Language') + '">' +
      '<button type="button" class="muzz-lang-btn' + (curLang === 'es' ? ' active' : '') + '" data-set-lang="es">ES</button>' +
      '<button type="button" class="muzz-lang-btn' + (curLang === 'en' ? ' active' : '') + '" data-set-lang="en">EN</button>' +
      '</div>' +
      '<button type="button" class="muzz-disconnect" id="muzzSheetDisconnect" data-i18n="nav.disconnect">' + shellTr('nav.disconnect', 'Disconnect') + '</button>';

    sheet.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeMore();
        navigateToSection(btn.getAttribute('data-nav'));
      });
    });
    sheet.querySelectorAll('[data-href]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var href = btn.getAttribute('data-href');
        if (btn.getAttribute('data-ext')) window.open(href, '_blank');
        else location.href = href;
      });
    });
    sheet.querySelectorAll('[data-set-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var L = btn.getAttribute('data-set-lang');
        if (global.MuzzI18n) MuzzI18n.setLang(L);
        if (global.MuzzI18n) MuzzI18n.apply(document);
        ensureMoreSheet(active);
      });
    });
    var c = document.getElementById('muzzSheetClose');
    if (c) c.addEventListener('click', closeMore);
    var d = document.getElementById('muzzSheetDisconnect');
    if (d) d.addEventListener('click', function () { closeMore(); disconnect(); });
    if (global.MuzzI18n) MuzzI18n.apply(sheet);
  }

  function renderTabBar(active) {
    var primaryIds = { social: 1, chat: 1, private: 1, profile: 1 };
    var bar = document.getElementById('muzzTabBar');
    if (!bar) {
      bar = document.createElement('nav');
      bar.id = 'muzzTabBar';
      bar.className = 'muzz-tabbar';
      bar.setAttribute('aria-label', 'MuzzSnap');
      document.body.appendChild(bar);
    }
    var html = TAB_ITEMS.map(function (it) {
      var on = it.id === active ? ' active' : '';
      var current = it.id === active ? ' aria-current="page"' : '';
      return '<button type="button" class="muzz-tab' + on + '" data-nav="' + it.id + '"' + current + '>' +
        icon(it.icon) +
        '<span data-i18n="' + it.key + '">' + shellTr(it.key, it.label) + '</span></button>';
    }).join('');
    var moreOn = !primaryIds[active] ? ' active' : '';
    html += '<button type="button" class="muzz-tab' + moreOn + '" data-more="1">' +
      icon('more') + '<span data-i18n="nav.more">' + shellTr('nav.more', 'More') + '</span></button>';
    bar.innerHTML = html;
    bar.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigateToSection(btn.getAttribute('data-nav'));
      });
    });
    var more = bar.querySelector('[data-more]');
    if (more) more.addEventListener('click', openMore);
    if (global.MuzzI18n) MuzzI18n.apply(bar);
  }

  function ensureMobileChrome(active) {
    if (!document.body || IS_EMBED) return;
    try { document.body.dataset.muzzPage = active || ''; } catch (_) {}
    ensureMoreSheet(active);
    var own = document.querySelector('.mobile-bottom');
    if (own) {
      document.body.classList.remove('muzz-has-tabbar');
      var existing = document.getElementById('muzzTabBar');
      if (existing) existing.remove();
      var moreBtn = document.getElementById('mobMore');
      if (moreBtn && !moreBtn.dataset.bound) {
        moreBtn.dataset.bound = '1';
        moreBtn.addEventListener('click', openMore);
      }
      return;
    }
    document.body.classList.add('muzz-has-tabbar');
    renderTabBar(active);
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
      return shellTr(key, fallback);
    }

    var navHtml = NAV_ITEMS.map(function (it) { return navButton(it, active); }).join('');

    navHtml +=
      '<div class="muzz-nav-sep" aria-hidden="true"></div>' +
      '<button type="button" class="muzz-nav-btn muzz-nav-quiet" data-href="https://t.me/MuzzSnap" data-ext="1">' +
      '<span class="muzz-nav-icon">' + icon('telegram') + '</span><span data-i18n="nav.telegram">' + tr('nav.telegram', 'Telegram') + '</span></button>' +
      '<button type="button" class="muzz-nav-btn muzz-nav-quiet" data-href="https://x.com/MuzzleToken" data-ext="1">' +
      '<span class="muzz-nav-icon">' + icon('x') + '</span><span>X.com</span></button>';

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
    try { root.classList.add('muzz-sidebar'); } catch (_) {}

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
    ensureMobileChrome(active);
    return session;
  }

  function mountChrome(active) {
    var session = requireAuth({ allowPublic: false });
    if (!session || IS_EMBED) return session;
    injectShellCss();
    ensureMobileChrome(active || 'profile');
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
      '.muzz-sidebar{display:flex;flex-direction:column;gap:2px;padding:14px 12px 12px;min-height:0;box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none;font-family:Inter,system-ui,sans-serif}' +
      'aside.side.muzz-sidebar,aside#muzzNavMount.muzz-sidebar{height:100%;overflow:auto}' +
      '.sidebar.card>#muzzNavMount.muzz-sidebar{flex:1;min-height:0;overflow:auto}' +
      '.muzz-sidebar::-webkit-scrollbar{width:0;height:0;display:none}' +
      '.muzz-brand{display:flex;align-items:center;gap:10px;padding:4px 8px 14px}' +
      '.muzz-badge{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(145deg,#ff3b3b,#9d1111);font-size:18px;box-shadow:0 8px 20px rgba(255,31,31,.22);flex-shrink:0}' +
      '.muzz-brand h1{margin:0;font-family:Orbitron,sans-serif;font-size:15px;font-weight:700;font-style:normal;letter-spacing:.06em;color:#fff}' +
      '.muzz-brand h1 span{color:#ff1f1f}' +
      '.muzz-nav{display:flex;flex-direction:column;gap:2px}' +
      '.muzz-nav-btn{border:none;background:transparent;color:#c5ceda;display:flex;align-items:center;gap:12px;min-height:44px;padding:0 12px;border-radius:12px;cursor:pointer;text-align:left;width:100%;font-family:Inter,system-ui,sans-serif;font-size:15px;font-weight:500;letter-spacing:0;text-transform:none;line-height:1.2;transition:background .16s ease,color .16s ease}' +
      '.muzz-nav-btn:hover{background:rgba(255,255,255,.05);color:#fff}' +
      '.muzz-nav-btn.active{background:rgba(255,31,31,.12);color:#fff;font-weight:600;box-shadow:inset 3px 0 0 #ff1f1f}' +
      '.muzz-nav-quiet{color:#8b95a7}' +
      '.muzz-nav-sep{height:1px;margin:8px 12px;background:rgba(255,255,255,.08)}' +
      '.muzz-nav-icon{width:22px;height:22px;display:grid;place-items:center;flex-shrink:0;color:inherit;background:none;border-radius:0}' +
      '.muzz-nav-icon svg,.muzz-tab svg,.muzz-sheet-item svg,.muzz-sheet-close svg{width:22px;height:22px;display:block;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}' +
      '.muzz-nav-btn.active .muzz-nav-icon{color:#ff1f1f}' +
      '.muzz-nav-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.muzz-lang{display:flex;gap:6px;padding:8px 4px 2px}' +
      '.muzz-lang-btn{flex:1;min-height:36px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#8b95a7;border-radius:10px;padding:8px;font-family:Inter,system-ui,sans-serif;font-weight:600;font-size:13px;letter-spacing:0;cursor:pointer}' +
      '.muzz-lang-btn.active{background:rgba(255,31,31,.16);border-color:rgba(255,31,31,.45);color:#fff}' +
      '.muzz-lang-btn:hover{color:#fff}' +
      '.muzz-nav-btn.disabled,.muzz-nav-btn:disabled{opacity:.45;cursor:not-allowed;pointer-events:none}' +
      '.muzz-soon{font-size:10px;letter-spacing:.04em;color:#fbbf24;margin-left:6px;border:1px solid rgba(251,191,36,.35);padding:1px 6px;border-radius:999px}' +
      '.muzz-profile{margin-top:8px;display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 10px;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);transition:background .16s ease}' +
      '.muzz-profile:hover{background:rgba(255,255,255,.06)}' +
      'aside.side .muzz-profile,aside#muzzNavMount .muzz-profile{margin-top:auto}' +
      '.muzz-avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#3a4552,#19202a);font-weight:600;font-size:12px;flex-shrink:0}' +
      '.muzz-profile-meta{min-width:0}' +
      '.muzz-profile-name{font-weight:600;font-size:14px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.muzz-profile-sub{font-size:12px;color:#8b95a7;opacity:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.muzz-disconnect{margin-top:6px;width:100%;min-height:40px;border:none;background:transparent;color:#8b95a7;padding:8px 12px;border-radius:10px;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none}' +
      '.muzz-disconnect:hover{color:#fff;background:rgba(255,255,255,.04)}' +
      '.muzz-tabbar{display:none}' +
      '.muzz-sheet-backdrop{display:none;position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.55)}' +
      '.muzz-sheet-backdrop.open{display:block}' +
      '.muzz-sheet{position:fixed;left:0;right:0;bottom:0;z-index:71;background:#14181f;color:#eef2f7;border-radius:18px 18px 0 0;border-top:1px solid rgba(255,255,255,.08);padding:8px 14px calc(14px + env(safe-area-inset-bottom,0px));transform:translateY(110%);transition:transform .22s ease;box-shadow:0 -16px 50px rgba(0,0,0,.45);font-family:Inter,system-ui,sans-serif}' +
      '.muzz-sheet.open{transform:translateY(0)}' +
      '.muzz-sheet-handle{width:36px;height:4px;border-radius:999px;background:rgba(255,255,255,.18);margin:4px auto 8px}' +
      '.muzz-sheet-head{display:flex;align-items:center;justify-content:space-between;min-height:44px;margin-bottom:6px}' +
      '.muzz-sheet-head strong{font-size:16px;font-weight:650;font-weight:600}' +
      '.muzz-sheet-close{width:44px;height:44px;border:none;border-radius:12px;background:transparent;color:#c5ceda;display:grid;place-items:center;cursor:pointer}' +
      '.muzz-sheet-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}' +
      '.muzz-sheet-item{min-height:76px;border:none;border-radius:14px;background:rgba(255,255,255,.04);color:#d5dbe6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 4px;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:600;line-height:1.2;text-align:center}' +
      '.muzz-sheet-item.active,.muzz-sheet-item:hover{background:rgba(255,31,31,.14);color:#fff}' +
      '.muzz-sheet .muzz-lang{padding:10px 0 0}' +
      'body.muzz-sheet-open{overflow:hidden}' +
      '@media(max-width:980px){body.muzz-has-tabbar .muzz-tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;height:calc(56px + env(safe-area-inset-bottom,0px));padding:4px 6px env(safe-area-inset-bottom,0px);box-sizing:border-box;background:rgba(12,14,18,.96);border-top:1px solid rgba(255,255,255,.08);backdrop-filter:blur(16px);justify-content:space-around;align-items:stretch}body.muzz-has-tabbar .muzz-tab{flex:1;min-width:0;min-height:44px;border:none;background:transparent;color:#8b95a7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:10px;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:500;letter-spacing:0;padding:2px}body.muzz-has-tabbar .muzz-tab.active{color:#fff;font-weight:600}body.muzz-has-tabbar .muzz-tab.active svg{color:#ff1f1f}body.muzz-has-tabbar .layout.muzz-desktop-app,body.muzz-has-tabbar .app.muzz-desktop-app{height:calc(100dvh - 56px - env(safe-area-inset-bottom,0px))!important;min-height:0!important;max-height:calc(100dvh - 56px - env(safe-area-inset-bottom,0px))!important}body.muzz-has-tabbar .layout>.side{display:none!important}body.muzz-has-tabbar .layout{grid-template-columns:minmax(0,1fr)!important}}' +
      '@media(max-width:1100px){body.muzz-has-tabbar[data-muzz-page="studio"] .muzz-tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;height:calc(56px + env(safe-area-inset-bottom,0px));padding:4px 6px env(safe-area-inset-bottom,0px);box-sizing:border-box;background:rgba(12,14,18,.96);border-top:1px solid rgba(255,255,255,.08);justify-content:space-around}body.muzz-has-tabbar[data-muzz-page="studio"] .layout{grid-template-columns:minmax(0,1fr)!important;height:calc(100dvh - 56px - env(safe-area-inset-bottom,0px))!important}}';
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
    navigateToSection: navigateToSection,
    mountChrome: mountChrome,
    openMore: openMore,
    closeMore: closeMore
  };
})(window);
