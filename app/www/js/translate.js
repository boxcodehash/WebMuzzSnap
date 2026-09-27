/**
 * Composer translate. POST {text, target} to /api/translate.
 * The message is not written to the console.
 */
(function (global) {
  var LANGS = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Español' },
    { id: 'zh-CN', label: '中文' },
    { id: 'ja', label: '日本語' }
  ];
  var MEMORY_KEY = 'muzz.translate.lang';
  var ERRORS = {
    empty: 'Type a message to translate.',
    too_long: 'That message is too long to translate.',
    bad_target: "Couldn't translate. Try again.",
    rate_limited: 'Too many translations. Try again in a minute.',
    translate_failed: "Couldn't translate. Try again.",
    method: "Couldn't translate. Try again."
  };
  var toastTimer = 0;

  function endpoint() {
    try {
      if (location.hostname === 'muzzsnap-app.vercel.app') return '/api/translate';
      if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port) {
        return '/api/translate';
      }
    } catch (err) { /* capacitor or file origin */ }
    return 'https://muzzsnap-app.vercel.app/api/translate';
  }

  function lastTarget() {
    try {
      var saved = localStorage.getItem(MEMORY_KEY) || '';
      return LANGS.some(function (lang) { return lang.id === saved; }) ? saved : '';
    } catch (err) {
      return '';
    }
  }

  function remember(id) {
    try { localStorage.setItem(MEMORY_KEY, id); } catch (err) { /* private mode */ }
  }

  function showError(message) {
    var text = message || ERRORS.translate_failed;
    var existing = document.getElementById('muzzTranslateError');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (toastTimer) clearTimeout(toastTimer);
    var el = document.createElement('div');
    el.id = 'muzzTranslateError';
    el.setAttribute('role', 'status');
    el.textContent = text;
    (document.body || document.documentElement).appendChild(el);
    function dismiss() {
      el.hidden = true;
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    el.addEventListener('click', dismiss);
    toastTimer = setTimeout(dismiss, 3500);
  }

  function translate(text, target) {
    var value = String(text || '').trim();
    if (!value) return Promise.reject(new Error(ERRORS.empty));
    if (value.length > 1000) return Promise.reject(new Error(ERRORS.too_long));
    remember(target);
    return fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: value, target: target })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !data.text) {
          throw new Error(ERRORS[data && data.error] || ERRORS.translate_failed);
        }
        return String(data.text);
      });
    }).catch(function (err) {
      if (err && ERRORS && err.message && Object.values) {
        var known = false;
        for (var key in ERRORS) if (ERRORS[key] === err.message) known = true;
        if (known) throw err;
      }
      throw new Error(ERRORS.translate_failed);
    });
  }

  function bindPrivate() {
    var input = document.getElementById('messageInput');
    var toggle = document.getElementById('translateBtn');
    var picker = document.getElementById('translatePicker');
    var undo = document.getElementById('translateUndo');
    if (!input || !toggle || !picker || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';
    var original = null;
    var busy = false;

    function paint() {
      var saved = lastTarget();
      var buttons = picker.querySelectorAll('[data-lang]');
      for (var i = 0; i < buttons.length; i += 1) {
        buttons[i].classList.toggle('is-on', buttons[i].getAttribute('data-lang') === saved);
      }
    }

    toggle.addEventListener('click', function () {
      picker.hidden = !picker.hidden;
      if (!picker.hidden) paint();
    });

    picker.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-lang]');
      if (!button || busy) return;
      var target = button.getAttribute('data-lang');
      var source = input.value;
      busy = true;
      toggle.disabled = true;
      translate(source, target).then(function (out) {
        if (original == null) original = source;
        input.value = out;
        input.dispatchEvent(new Event('input'));
        if (undo) undo.hidden = false;
        picker.hidden = true;
        paint();
      }).catch(function (err) {
        showError(err && err.message);
      }).then(function () {
        busy = false;
        toggle.disabled = false;
      });
    });

    if (undo) {
      undo.addEventListener('click', function () {
        if (original == null) return;
        input.value = original;
        input.dispatchEvent(new Event('input'));
        original = null;
        undo.hidden = true;
      });
    }

    global.MuzzTranslate.forgetDraft = function () {
      original = null;
      if (undo) undo.hidden = true;
    };
  }

  global.MuzzTranslate = {
    langs: LANGS,
    lastTarget: lastTarget,
    remember: remember,
    translate: translate,
    showError: showError,
    forgetDraft: function () {}
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPrivate);
  else bindPrivate();
})(window);
