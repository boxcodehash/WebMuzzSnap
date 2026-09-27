/**
 * Android system Back. The native activity calls muzzConsumeBack and never finishes.
 * "closed" dismisses an open menu, emoji picker, people list, or wallet modal.
 * "back" leaves private.html for the previous in-app page (chat).
 * "minimize" keeps chat and login alive in the background.
 */
(function () {
  function click(el) {
    if (!el || typeof el.click !== 'function') return false;
    el.click();
    return true;
  }

  function walletModalOpen() {
    const modal = document.querySelector('w3m-modal');
    if (!modal) return false;
    if (modal.open === true) return true;
    const attr = modal.getAttribute && modal.getAttribute('open');
    return attr != null && attr !== 'false';
  }

  function closeWalletModal() {
    if (typeof closeWalletList === 'function') {
      closeWalletList();
      return;
    }
    const modal = document.querySelector('w3m-modal');
    if (modal) modal.open = false;
  }

  function closeChatOverlay() {
    const menu = document.querySelector('aside.sidebar.open');
    if (menu) {
      if (click(menu.querySelector('[aria-label="Close menu"]'))) return true;
      if (click(document.querySelector('.drawer-backdrop'))) return true;
    }
    const translatePicker = document.querySelector('.muzz-translate-picker');
    if (translatePicker && !translatePicker.hidden) {
      if (click(document.querySelector('[aria-label="Translate"]'))) return true;
    }
    if (document.querySelector('.emoji-window')) {
      if (click(document.querySelector('[aria-label="Emoji"]'))) return true;
    }
    const composer = document.querySelector('.composer');
    if (!composer) return false;
    const blocks = composer.children;
    for (let i = 0; i < blocks.length; i += 1) {
      const text = blocks[i].textContent || '';
      if (!/PIN MODE|Ban user|Mute user/.test(text)) continue;
      if (click(blocks[i].querySelector('button'))) return true;
    }
    return false;
  }

  function onPrivate() {
    const path = String(location.pathname || '');
    return /\/private\.html$/i.test(path) || /\/private$/i.test(path);
  }

  function privateThreadOpen() {
    const title = document.querySelector('#chatHeader h2');
    if (!title) return false;
    const name = String(title.textContent || '').trim();
    return name.length > 0 && name.toUpperCase() !== 'PRIVATE';
  }

  function closePrivatePicker() {
    if (!onPrivate()) return false;
    const shell = document.getElementById('appShell');
    if (!shell || !shell.classList.contains('picker-open')) return false;
    if (!privateThreadOpen()) return false;
    return click(document.querySelector('.people-btn'));
  }

  window.muzzConsumeBack = function muzzConsumeBack() {
    try {
      if (walletModalOpen()) {
        closeWalletModal();
        return 'closed';
      }
      if (closeChatOverlay()) return 'closed';
      if (closePrivatePicker()) return 'closed';
      if (onPrivate()) return 'back';
      return 'minimize';
    } catch (err) {
      return 'minimize';
    }
  };
})();
