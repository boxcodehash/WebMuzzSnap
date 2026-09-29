/**
 * MuzzSnap shared emoji picker
 * Usage:
 *   <button type="button" class="emoji-btn" data-emoji-for="inputId">😀</button>
 *   <div id="emojiPop" class="emoji-pop">...</div>  OR auto-created
 *   MuzzEmoji.init();
 */
(function (global) {
  'use strict';

  var EMOJIS = [
    '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😗',
    '😜','🤪','😎','🤩','🥳','😏','😒','🙄','😬','😮','😯','😲','😳','🥺','😢','😭',
    '😤','😠','🤬','😈','👿','💀','👻','👽','🤖','🎃','😺','😸','😹','😻','👍','👎',
    '👏','🙌','🤝','✌️','🤞','🤟','🤘','👌','🤌','👈','👉','👆','👇','✋','🤚','👋',
    '💪','🔥','✨','⭐','🌟','💫','💥','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔',
    '💯','✅','❌','⚡','🌙','☀️','🌈','☁️','🌊','🍕','🍔','🍟','🌮','🍣','🍩','☕',
    '🍺','🎮','🎧','🎬','📱','💻','🚀','💎','🪙','💰','🏆','🎯','🛡️','⚔️','🔑','🔓'
  ];

  var targetId = null;
  var pop = null;

  function ensurePop() {
    pop = document.getElementById('emojiPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'emojiPop';
      pop.className = 'emoji-pop';
      pop.setAttribute('role', 'dialog');
      pop.innerHTML = '<div class="emoji-title">Emojis</div><div class="emoji-grid" id="emojiGrid"></div>';
      document.body.appendChild(pop);
    }
    var grid = pop.querySelector('#emojiGrid') || pop.querySelector('.emoji-grid');
    if (grid && !grid.childElementCount) {
      grid.innerHTML = EMOJIS.map(function (e) {
        return '<button type="button" data-emoji="' + e + '">' + e + '</button>';
      }).join('');
    }
    ensureCss();
    return pop;
  }

  function ensureCss() {
    if (document.getElementById('muzz-emoji-css')) return;
    var css = document.createElement('style');
    css.id = 'muzz-emoji-css';
    css.textContent =
      '.emoji-btn{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit;width:44px;height:44px;border-radius:12px;cursor:pointer;font-size:20px;display:grid;place-items:center;flex-shrink:0;font-family:Inter,system-ui,sans-serif}' +
      '.emoji-btn:hover{background:rgba(255,43,43,.12);border-color:rgba(255,43,43,.3)}' +
      '.emoji-btn:disabled{opacity:.4;cursor:not-allowed}' +
      '.emoji-pop{position:fixed;z-index:200;width:min(340px,92vw);max-height:280px;overflow:auto;background:rgba(18,23,29,.98);border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:10px;display:none;scrollbar-width:none}' +
      '.emoji-pop::-webkit-scrollbar{display:none}' +
      '.emoji-pop.open{display:block}' +
      '.emoji-pop .emoji-title{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#93a0b3;font-weight:800;margin:4px 6px 8px}' +
      '.emoji-pop .emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}' +
      '.emoji-pop button{border:none;background:transparent;font-size:22px;padding:6px;border-radius:10px;cursor:pointer;line-height:1}' +
      '.emoji-pop button:hover{background:rgba(255,255,255,.08)}';
    document.head.appendChild(css);
  }

  function insertAtCursor(el, text) {
    if (!el) return;
    el.focus();
    var start = el.selectionStart != null ? el.selectionStart : (el.value || '').length;
    var end = el.selectionEnd != null ? el.selectionEnd : (el.value || '').length;
    var v = el.value || '';
    el.value = v.slice(0, start) + text + v.slice(end);
    var pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch (e) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openPicker(anchor, tid) {
    ensurePop();
    targetId = tid;
    var rect = anchor.getBoundingClientRect();
    var popW = Math.min(340, window.innerWidth - 16);
    var left = rect.left;
    var top = rect.bottom + 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (top + 280 > window.innerHeight - 8) top = Math.max(8, rect.top - 288);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = top + 'px';
    pop.classList.add('open');
  }

  function closePicker() {
    if (pop) pop.classList.remove('open');
    targetId = null;
  }

  function init() {
    ensurePop();
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-emoji-for]');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;
        var tid = btn.getAttribute('data-emoji-for');
        if (pop.classList.contains('open') && targetId === tid) {
          closePicker();
          return;
        }
        openPicker(btn, tid);
        return;
      }
      if (e.target.closest('#emojiPop')) {
        var eb = e.target.closest('[data-emoji]');
        if (eb && targetId) {
          insertAtCursor(document.getElementById(targetId), eb.getAttribute('data-emoji'));
        }
        return;
      }
      if (pop && pop.classList.contains('open')) closePicker();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePicker();
    });
  }

  global.MuzzEmoji = { init: init, close: closePicker, EMOJIS: EMOJIS };
})(window);
