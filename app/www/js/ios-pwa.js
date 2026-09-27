/**
 * Home-screen behavior for iPhone Safari and installed standalone mode.
 * Splash links are injected before Add to Home Screen reads the document.
 */
(function (global) {
  var DISMISS_KEY = 'muzz.install.dismissed';
  var MIN_KEY = 'muzz.install.minimized';
  var SPLASH = [
    [320, 568, 2],
    [375, 667, 2],
    [375, 812, 3],
    [390, 844, 3],
    [393, 852, 3],
    [402, 874, 3],
    [414, 896, 2],
    [414, 896, 3],
    [428, 926, 3],
    [430, 932, 3],
    [440, 956, 3]
  ];

  function isIos() {
    var ua = (navigator.userAgent || '');
    var native = global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform();
    if (native) return false;
    return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isIosSafari() {
    if (!isIos()) return false;
    return /Safari/i.test(navigator.userAgent || '') && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent || '');
  }

  function isStandalone() {
    return navigator.standalone === true || (global.matchMedia && matchMedia('(display-mode: standalone)').matches);
  }

  function nativeApp() {
    return !!(global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform());
  }

  function shotMode() {
    var host = location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return '';
    return new URLSearchParams(location.search).get('shot') || '';
  }

  function onLoginPage() {
    return /(?:^|\/)login\.html$/i.test(location.pathname);
  }

  function loggedIn() {
    try {
      return !!(sessionStorage.getItem('muzz_wallet_address') || sessionStorage.getItem('muzz_login_sig'));
    } catch (err) {
      return false;
    }
  }

  function stored(key) {
    try { return localStorage.getItem(key) === '1'; } catch (err) { return false; }
  }

  function store(key, on) {
    try {
      if (on) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch (err) { /* private mode */ }
  }

  function bindPress(el, fn) {
    var stamp = 0;
    function go(event) {
      var now = Date.now();
      if (now - stamp < 450) {
        event.preventDefault();
        return;
      }
      stamp = now;
      event.preventDefault();
      fn();
    }
    el.addEventListener('click', go);
    el.addEventListener('touchend', go, { passive: false });
  }

  function injectSplash() {
    if (!document.head || document.head.dataset.muzzSplash === '1') return;
    document.head.dataset.muzzSplash = '1';
    SPLASH.forEach(function (item) {
      var link = document.createElement('link');
      link.rel = 'apple-touch-startup-image';
      link.href = 'splash/iphone-' + item[0] + 'x' + item[1] + '@' + item[2] + '.png';
      link.media = 'screen and (device-width: ' + item[0] + 'px) and (device-height: ' + item[1]
        + 'px) and (-webkit-device-pixel-ratio: ' + item[2] + ') and (orientation: portrait)';
      document.head.appendChild(link);
    });
  }

  function applyViewport() {
    var vv = global.visualViewport;
    var height = vv ? vv.height : global.innerHeight;
    var top = vv ? vv.offsetTop : 0;
    document.documentElement.style.setProperty('--app-h', Math.round(height) + 'px');
    document.documentElement.style.setProperty('--app-top', Math.round(top) + 'px');
  }

  function markShell() {
    var shot = shotMode();
    var standalone = isStandalone() || shot === 'standalone';
    document.documentElement.classList.toggle('muzz-standalone', standalone);
    if (shot === 'standalone') {
      document.documentElement.classList.add('muzz-shot');
      document.documentElement.style.setProperty('--safe-t', '47px');
      document.documentElement.style.setProperty('--safe-b', '34px');
      document.documentElement.style.setProperty('--safe-top', '47px');
      document.documentElement.style.setProperty('--safe-bottom', '34px');
      document.documentElement.style.setProperty('--muzz-sat', '47px');
      document.documentElement.style.setProperty('--muzz-sab', '34px');
    }
  }

  function removeLegacyHint() {
    var old = document.getElementById('muzzIosHint');
    if (old) old.remove();
  }

  function shareIcon() {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0 4 4m-4-4-4 4M6 14v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5"/></svg>';
  }

  function renderInstall(mode) {
    var existing = document.getElementById('muzzInstall');
    if (existing) existing.remove();
    var root = document.createElement('div');
    root.id = 'muzzInstall';
    root.className = mode === 'pill' ? 'muzz-install is-pill' : 'muzz-install';
    root.innerHTML = ''
      + '<div class="muzz-install-card" role="dialog" aria-label="Install MuzzSnap for full screen">'
      + '<p class="kicker">iPhone</p>'
      + '<h2>Install MuzzSnap for full screen</h2>'
      + '<ol>'
      + '<li>' + shareIcon() + '<span>Tap the <strong>Share</strong> icon</span></li>'
      + '<li><span class="step-num">2</span><span>Then tap <strong>Add to Home Screen</strong></span></li>'
      + '</ol>'
      + '<div class="actions">'
      + '<button type="button" data-act="min">Minimize</button>'
      + '<button type="button" data-act="close">Close</button>'
      + '</div></div>'
      + '<div class="muzz-install-arrow" aria-hidden="true"></div>'
      + '<button type="button" class="muzz-install-pill" data-act="open">Install</button>';
    document.body.appendChild(root);
    bindPress(root.querySelector('[data-act="min"]'), function () {
      store(MIN_KEY, true);
      root.classList.add('is-pill');
    });
    bindPress(root.querySelector('[data-act="close"]'), function () {
      store(DISMISS_KEY, true);
      store(MIN_KEY, false);
      root.remove();
    });
    bindPress(root.querySelector('[data-act="open"]'), function () {
      store(MIN_KEY, false);
      root.classList.remove('is-pill');
    });
  }

  function maybeInstall() {
    removeLegacyHint();
    var shot = shotMode();
    if (shot === 'install') return renderInstall('card');
    if (shot === 'min') return renderInstall('pill');
    if (shot === '1' || shot === 'standalone') return;
    if (stored(DISMISS_KEY) || isStandalone() || !isIosSafari()) return;
    if (onLoginPage() || !loggedIn()) return;
    renderInstall(stored(MIN_KEY) ? 'pill' : 'card');
  }

  function canFullscreen() {
    if (nativeApp()) return false;
    var el = document.documentElement;
    return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
  }

  function toggleFullscreen() {
    var el = document.documentElement;
    var active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(el)).catch(function () {});
  }

  function armFullscreen() {
    if (!canFullscreen()) return;
    document.documentElement.classList.add('muzz-fs-on');
    document.querySelectorAll('.muzz-fs').forEach(function (btn) {
      if (btn.dataset.muzzFs === '1') return;
      btn.dataset.muzzFs = '1';
      btn.hidden = false;
      bindPress(btn, toggleFullscreen);
    });
  }

  function tabBar() {
    var shot = shotMode();
    var standalone = isStandalone() || shot === 'standalone';
    if (!standalone || onLoginPage()) {
      var gone = document.getElementById('muzzTabbar');
      if (gone) gone.remove();
      return;
    }
    if (document.getElementById('muzzTabbar')) return;
    var nav = document.createElement('nav');
    nav.id = 'muzzTabbar';
    nav.className = 'muzz-tabbar';
    nav.setAttribute('aria-label', 'Main');
    var here = /private\.html$/i.test(location.pathname) ? 'private' : 'chat';
    nav.innerHTML = ''
      + '<a href="chat.html"' + (here === 'chat' ? ' aria-current="page"' : '') + '>Chat</a>'
      + '<a href="private.html"' + (here === 'private' ? ' aria-current="page"' : '') + '>Private</a>';
    document.body.appendChild(nav);
  }

  injectSplash();
  markShell();
  applyViewport();
  if (global.visualViewport) {
    visualViewport.addEventListener('resize', applyViewport);
    visualViewport.addEventListener('scroll', applyViewport);
  }
  global.addEventListener('orientationchange', applyViewport);

  function boot() {
    markShell();
    removeLegacyHint();
    maybeInstall();
    armFullscreen();
    tabBar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  global.addEventListener('pageshow', boot);
  var chromeQueued = false;
  function scheduleChrome() {
    if (chromeQueued) return;
    chromeQueued = true;
    setTimeout(function () {
      chromeQueued = false;
      armFullscreen();
      tabBar();
    }, 60);
  }
  if (document.documentElement) {
    new MutationObserver(scheduleChrome).observe(document.documentElement, { childList: true, subtree: true });
  }

  if ('serviceWorker' in navigator && !nativeApp()) {
    var hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadWorker) {
        hadWorker = true;
        return;
      }
      showWebUpdateBar();
    });
    navigator.serviceWorker.addEventListener('message', function (event) {
      var data = event.data || {};
      if (data.type === 'muzz-sw-update' && hadWorker) showWebUpdateBar();
    });
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  function showWebUpdateBar() {
    if (nativeApp() || document.getElementById('muzzUpdateBar')) return;
    var bar = document.createElement('div');
    bar.id = 'muzzUpdateBar';
    bar.setAttribute('role', 'status');
    var reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'New version, tap to reload';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '\u00d7';
    function dismiss(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      bar.hidden = true;
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    }
    close.addEventListener('click', dismiss);
    reload.addEventListener('click', function () { location.reload(); });
    bar.appendChild(reload);
    bar.appendChild(close);
    (document.body || document.documentElement).appendChild(bar);
  }

  global.MuzzIos = {
    isIos: isIos,
    isIosSafari: isIosSafari,
    isStandalone: isStandalone,
    canFullscreen: canFullscreen,
    promptInstall: function () { if (!stored(DISMISS_KEY)) renderInstall(stored(MIN_KEY) ? 'pill' : 'card'); }
  };
})(window);
