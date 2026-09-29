/**
 * MuzzSnap i18n — Español / English
 * Uso:
 *   MuzzI18n.t('key')
 *   data-i18n="key"  data-i18n-placeholder="key"  data-i18n-title="key"
 *   MuzzI18n.setLang('en'|'es'); MuzzI18n.apply(document);
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'muzz_lang';

  var DICT = {
    es: {
      // Shell / nav
      'nav.social': 'Social',
      'nav.profile': 'Perfil',
      'nav.chat': 'Chat',
      'nav.private': 'Private',
      'nav.game': 'MUZZ Galaxy',
      'nav.studio': 'MuzzStudio',
      'nav.buy': 'Comprar MUZZ',
      'nav.whitepaper': 'Whitepaper',
      'nav.muzzid': 'MuzzID',
      'nav.telegram': 'Telegram',
      'nav.disconnect': 'Desconectar',
      'nav.openProfile': 'Abrir perfil',
      'lang.es': 'ES',
      'lang.en': 'EN',
      'lang.label': 'Idioma',

      // Login
      'login.status.ready': 'Listo · Conectar wallet',
      'login.status.connecting': 'Conectando…',
      'login.status.detected': 'Wallet detectada · Conectar (≥ 2M MUZZ)',
      'login.title.access': 'Único acceso · MuzzleToken',
      'login.min': 'Login con wallet crypto. Mínimo: 2,000,000 MUZZ',
      'login.gate': 'Sin guest gratis. Toda la red (Social, Chat, Private, Studio, Galaxy) usa el mismo gate.',
      'login.connect': 'Conectar wallet · ≥ 2M MUZZ',
      'login.muzzid.title': 'MuzzID',
      'login.muzzid.desc': 'Crea tu username NFT con MUZZ. Identidad on-chain para Social. Pago 100% a wallet de quema.',
      'login.muzzid.cta': 'Crear MuzzID · Username NFT',
      'login.hint': 'Tras conectar con ≥ 2M MUZZ entras a Social. Antes puedes crear tu MuzzID.',

      // Social
      'social.title': 'Social',
      'social.tab.global': 'Global',
      'social.tab.following': 'Siguiendo',
      'social.post': 'Publicar algo',
      'social.composer.placeholder': '¿Qué está pasando en el mundo MUZZ?',
      'social.web': 'WEB',
      'social.notifications': 'Notificaciones',
      'social.markAll': 'Marcar todo leído',
      'social.noNotifs': 'Sin notificaciones aún',
      'social.empty': 'Sin publicaciones aún',

      // MuzzID panel
      'muzzid.title': 'MuzzID',
      'muzzid.hero': 'Tu username NFT on-chain. Solo tú ves tu listado privado. El pago MUZZ va 100% a dead wallet.',
      'muzzid.identity': 'Tu identidad',
      'muzzid.none': 'Sin MuzzID',
      'muzzid.refresh': 'Actualizar NFT',
      'muzzid.back': '← Volver al feed',
      'muzzid.create': 'Crear MuzzID (mint)',
      'muzzid.placeholder': '@TuNick o 🔥Nick',
      'muzzid.faucet': 'Faucet MUZZ',
      'muzzid.mint': 'Mintear NFT',
      'muzzid.hint': 'Básico ≈ $2 · Premium emoji ≈ $4 · 1 confirmación',
      'muzzid.private': 'Mis nicks NFT · privado',
      'muzzid.private.sub': 'Solo visible para el dueño de esta wallet',
      'muzzid.loading': 'Cargando nicks privados…',
      'muzzid.empty': 'Aún no tienes nicks NFT en esta wallet. Crea uno abajo.',
      'muzzid.created': 'Creado',
      'muzzid.hardhatOff': 'Hardhat apagado. Ejecuta ARREGLAR-Y-ABRIR-MUZZID.bat',

      // Chat
      'chat.title': 'MuzzSnap · Chat',
      'chat.placeholder': 'Escribe en el chat público…',
      'chat.send': 'Enviar',
      'chat.loading': 'Cargando Global…',
      'chat.empty': 'Sin mensajes en Global.\nSé el primero en escribir.',
      'chat.online': 'en línea',
      'chat.global': 'Global',

      // Private
      'private.title': 'Private',
      'private.placeholder': 'Mensaje privado…',
      'private.send': 'Enviar',

      // Common
      'common.loading': 'Cargando…',
      'common.error': 'Error',
      'common.save': 'Guardar',
      'common.cancel': 'Cancelar',
      'common.back': 'Volver',
      'buy.title': 'Comprar MUZZ',
      'profile.title': 'Perfil',
      'muzzid.page.title': 'MuzzID | Crear Username NFT',
      'muzzid.page.status': 'Crea tu username NFT on-chain',
      'muzzid.page.what': 'Qué es MuzzID',
      'muzzid.page.what.desc': 'Tu nick como NFT. Pagas con MUZZ. El 100% del pago va a la wallet dead de quema. Ese NFT es tu identidad en Muzzocial.',
      'muzzid.page.wallet': '1 · Wallet',
      'muzzid.page.username': '2 · Elige username',
      'muzzid.page.connect': 'Conectar MetaMask · Firmar',
      'muzzid.page.burn': 'Destino de quema',
    },

    en: {
      'nav.social': 'Social',
      'nav.profile': 'Profile',
      'nav.chat': 'Chat',
      'nav.private': 'Private',
      'nav.game': 'MUZZ Galaxy',
      'nav.studio': 'MuzzStudio',
      'nav.buy': 'Buy MUZZ',
      'nav.whitepaper': 'Whitepaper',
      'nav.muzzid': 'MuzzID',
      'nav.telegram': 'Telegram',
      'nav.disconnect': 'Disconnect',
      'nav.openProfile': 'Open profile',
      'lang.es': 'ES',
      'lang.en': 'EN',
      'lang.label': 'Language',

      'login.status.ready': 'Ready · Connect Wallet',
      'login.status.connecting': 'Connecting…',
      'login.status.detected': 'Wallet detected · Connect (≥ 2M MUZZ)',
      'login.title.access': 'Only access · MuzzleToken',
      'login.min': 'Crypto wallet login. Minimum: 2,000,000 MUZZ',
      'login.gate': 'No free guest. The whole network (Social, Chat, Private, Studio, Galaxy) uses the same gate.',
      'login.connect': 'Connect Wallet · ≥ 2M MUZZ',
      'login.muzzid.title': 'MuzzID',
      'login.muzzid.desc': 'Create your username NFT with MUZZ. On-chain identity for Social. 100% payment to burn wallet.',
      'login.muzzid.cta': 'Create MuzzID · Username NFT',
      'login.hint': 'After connecting with ≥ 2M MUZZ you enter Social. You can create your MuzzID first.',

      'social.title': 'Social',
      'social.tab.global': 'Global',
      'social.tab.following': 'Following',
      'social.post': 'Post something',
      'social.composer.placeholder': "What's happening in the MUZZ world?",
      'social.web': 'WEB',
      'social.notifications': 'Notifications',
      'social.markAll': 'Mark all read',
      'social.noNotifs': 'No notifications yet',
      'social.empty': 'No posts yet',

      'muzzid.title': 'MuzzID',
      'muzzid.hero': 'Your on-chain username NFT. Only you see your private list. MUZZ payment goes 100% to the dead wallet.',
      'muzzid.identity': 'Your identity',
      'muzzid.none': 'No MuzzID',
      'muzzid.refresh': 'Refresh NFT',
      'muzzid.back': '← Back to feed',
      'muzzid.create': 'Create MuzzID (mint)',
      'muzzid.placeholder': '@YourName or 🔥Name',
      'muzzid.faucet': 'Faucet MUZZ',
      'muzzid.mint': 'Mint NFT',
      'muzzid.hint': 'Basic ≈ $2 · Premium emoji ≈ $4 · 1 confirmation',
      'muzzid.private': 'My NFT nicks · private',
      'muzzid.private.sub': 'Only visible to this wallet owner',
      'muzzid.loading': 'Loading private nicks…',
      'muzzid.empty': 'You have no NFT nicks on this wallet yet. Create one below.',
      'muzzid.created': 'Created',
      'muzzid.hardhatOff': 'Hardhat is off. Run ARREGLAR-Y-ABRIR-MUZZID.bat',

      'chat.title': 'MuzzSnap · Chat',
      'chat.placeholder': 'Write in the public chat…',
      'chat.send': 'Send',
      'chat.loading': 'Loading Global…',
      'chat.empty': 'No messages in Global yet.\nBe the first to write.',
      'chat.online': 'online',
      'chat.global': 'Global',

      'private.title': 'Private',
      'private.placeholder': 'Private message…',
      'private.send': 'Send',

      'common.loading': 'Loading…',
      'common.error': 'Error',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.back': 'Back',
      'buy.title': 'Buy MUZZ',
      'profile.title': 'Profile',
      'muzzid.page.title': 'MuzzID | Create Username NFT',
      'muzzid.page.status': 'Create your on-chain username NFT',
      'muzzid.page.what': 'What is MuzzID',
      'muzzid.page.what.desc': 'Your nick as an NFT. Pay with MUZZ. 100% of payment goes to the burn dead wallet. That NFT is your identity in Muzzocial.',
      'muzzid.page.wallet': '1 · Wallet',
      'muzzid.page.username': '2 · Choose username',
      'muzzid.page.connect': 'Connect MetaMask · Sign',
      'muzzid.page.burn': 'Burn destination',
    }
  };

  var listeners = [];

  function detect() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'es' || saved === 'en') return saved;
    } catch (_) {}
    var nav = (navigator.language || 'en').toLowerCase();
    return nav.indexOf('es') === 0 ? 'es' : 'en';
  }

  var lang = detect();

  function t(key, vars) {
    var table = DICT[lang] || DICT.en;
    var s = table[key] || (DICT.en[key]) || key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (k) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
      });
    }
    return s;
  }

  function setLang(next) {
    if (next !== 'es' && next !== 'en') return;
    lang = next;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    try { document.documentElement.lang = lang; } catch (_) {}
    apply(document);
    listeners.forEach(function (fn) {
      try { fn(lang); } catch (_) {}
    });
  }

  function getLang() { return lang; }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      var val = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        // ignore value; use placeholder attr separately
      } else {
        el.textContent = val;
      }
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    // sync lang toggle buttons
    root.querySelectorAll('[data-set-lang]').forEach(function (btn) {
      var L = btn.getAttribute('data-set-lang');
      btn.classList.toggle('active', L === lang);
    });
  }

  // init
  try { document.documentElement.lang = lang; } catch (_) {}

  global.MuzzI18n = {
    t: t,
    setLang: setLang,
    getLang: getLang,
    apply: apply,
    onChange: onChange,
    DICT: DICT
  };
})(window);
