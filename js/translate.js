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
    timeout: 'Translation timed out. Try again.',
    offline: "You're offline. Check your connection and try again.",
    wrong_language: 'That translation came back in the wrong language. Nothing was changed.',
    translate_failed: "Couldn't translate. Try again.",
    method: "Couldn't translate. Try again.",
    unauthorized: 'Sign in again to translate.'
  };
  var toastTimer = 0;

  function endpoint() {
    try {
      if (location.hostname === 'muzzsnap-app.vercel.app' || location.hostname === 'app.muzzsnap.com') return '/api/translate';
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

  function knownError(err) {
    if (!err || !err.message) return false;
    for (var key in ERRORS) if (ERRORS[key] === err.message) return true;
    return false;
  }

  function translate(text, target) {
    var value = String(text || '').trim();
    if (!value) return Promise.reject(new Error(ERRORS.empty));
    if (value.length > 1000) return Promise.reject(new Error(ERRORS.too_long));
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return Promise.reject(new Error(ERRORS.offline));
      }
    } catch (err) { /* navigator unavailable */ }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : 0;
    var headers = { 'Content-Type': 'application/json' };
    var user = null;
    try { user = global.firebase && firebase.auth && firebase.auth().currentUser; } catch (err) { user = null; }
    var tokenWait = user && typeof user.getIdToken === 'function' ? user.getIdToken() : Promise.resolve('');
    return tokenWait.then(function (bearer) {
      if (bearer) headers.Authorization = 'Bearer ' + bearer;
      return sendTranslate(value, target, headers, ctrl, timer);
    });
  }

  function sendTranslate(value, target, headers, ctrl, timer) {
    var opts = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ text: value, target: target })
    };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(endpoint(), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !data.text) {
          throw new Error(ERRORS[data && data.error] || ERRORS.translate_failed);
        }
        remember(target);
        return String(data.text);
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') throw new Error(ERRORS.timeout);
      if (knownError(err)) throw err;
      if (err && (err.name === 'TypeError' || /failed to fetch|network|offline/i.test(String(err.message || '')))) {
        throw new Error(ERRORS.offline);
      }
      throw new Error(ERRORS.translate_failed);
    }).then(function (out) {
      if (timer) clearTimeout(timer);
      return out;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  var CONFIRM_TEXT = 'This message will be sent to a translation service and will not be end-to-end encrypted. Translate?';

  /**
   * Private only. Resolves true on Translate, false on Cancel, Escape, or a tap outside.
   * Nothing is sent to /api/translate until this resolves true.
   */
  function confirmPrivateTranslate(returnFocus) {
    return new Promise(function (resolve) {
      var old = document.getElementById('muzzTranslateConfirm');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var backdrop = document.createElement('div');
      backdrop.id = 'muzzTranslateConfirm';
      backdrop.className = 'muzz-confirm-backdrop';
      var box = document.createElement('div');
      box.className = 'muzz-confirm';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', 'muzzTranslateConfirmText');
      var text = document.createElement('p');
      text.id = 'muzzTranslateConfirmText';
      text.className = 'muzz-confirm-text';
      text.textContent = CONFIRM_TEXT;
      var actions = document.createElement('div');
      actions.className = 'muzz-confirm-actions';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost muzz-confirm-cancel';
      cancel.setAttribute('data-act', 'cancel');
      cancel.textContent = 'Cancel';
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn muzz-confirm-ok';
      ok.setAttribute('data-act', 'translate');
      ok.textContent = 'Translate';
      actions.appendChild(cancel);
      actions.appendChild(ok);
      box.appendChild(text);
      box.appendChild(actions);
      backdrop.appendChild(box);
      var done = false;
      function close(answer) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (returnFocus && typeof returnFocus.focus === 'function') {
          try { returnFocus.focus(); } catch (err) { /* element gone */ }
        }
        resolve(answer);
      }
      backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) close(false);
      });
      cancel.addEventListener('click', function () { close(false); });
      ok.addEventListener('click', function () { close(true); });
      function onKey(event) {
        if (event.key === 'Escape' || event.key === 'Esc') {
          if (event.preventDefault) event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          close(false);
          return;
        }
        if (event.key === 'Tab') {
          /* Keep focus on the two buttons while the dialog is open. */
          if (event.preventDefault) event.preventDefault();
          (document.activeElement === cancel ? ok : cancel).focus();
        }
      }
      document.addEventListener('keydown', onKey, true);
      (document.body || document.documentElement).appendChild(backdrop);
      /* Cancel takes the first focus: Enter on an unread warning must not send the text out. */
      cancel.focus();
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
      var trimmed = String(source || '').trim();
      if (!trimmed || trimmed.length > 1000) {
        /* Rejected locally, nothing would be sent, so no warning is needed. */
        showError(trimmed ? ERRORS.too_long : ERRORS.empty);
        return;
      }
      busy = true;
      toggle.disabled = true;
      confirmPrivateTranslate(button).then(function (accepted) {
        if (!accepted) return null;
        return translate(source, target).then(function (out) {
          if (original == null) original = source;
          input.value = out;
          input.dispatchEvent(new Event('input'));
          if (undo) undo.hidden = false;
          picker.hidden = true;
          paint();
        });
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
    confirmText: CONFIRM_TEXT,
    forgetDraft: function () {}
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPrivate);
  else bindPrivate();
})(window);
