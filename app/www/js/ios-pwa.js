/**
 * Home-screen behavior for iPhone Safari.
 * Splash links are injected before Add to Home Screen reads the document.
 */
(function (global) {
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

  function showInstallHint() {
    if (!isIosSafari() || isStandalone()) return;
    if (new URLSearchParams(location.search).get('shot') === '1') return;
    if (document.getElementById('muzzIosHint')) return;
    var box = document.createElement('div');
    box.id = 'muzzIosHint';
    box.className = 'muzz-ios-hint';
    box.innerHTML = '<div><strong>Install on iPhone</strong><span>Tap Share, then Add to Home Screen.</span></div><button type="button" aria-label="Dismiss">×</button>';
    box.querySelector('button').addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
  }

  injectSplash();
  applyViewport();
  if (global.visualViewport) {
    visualViewport.addEventListener('resize', applyViewport);
    visualViewport.addEventListener('scroll', applyViewport);
  }
  global.addEventListener('orientationchange', applyViewport);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showInstallHint);
  } else {
    showInstallHint();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  global.MuzzIos = {
    isIos: isIos,
    isIosSafari: isIosSafari,
    isStandalone: isStandalone
  };
})(window);
