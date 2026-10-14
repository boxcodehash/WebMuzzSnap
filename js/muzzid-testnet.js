/**
 * "Crear MuzzID" (testnet) from the chat menu. Only opens the external MuzzID testnet site;
 * nothing is signed or sent from MuzzSnap. Texts in ONE object (Spanish on request; swap here for English).
 * Same look as the private translate warning (.muzz-confirm-* in css/ios-pwa.css).
 */
(function (global) {
  'use strict';

  var MUZZID_TEXT = {
    button: 'Crear MuzzID',
    buttonHint: 'Testnet · Sepolia',
    title: 'Crear MuzzID (testnet)',
    warning: 'Esto es TESTNET en la red Sepolia. Necesitas Sepolia ETH de prueba para pagar el gas. No tiene valor real.',
    faucetsTitle: 'Consigue Sepolia ETH de prueba:',
    faucetGoogle: 'Faucet de Google Cloud (Sepolia)',
    faucetPk910: 'Faucet pk910 (Sepolia PoW)',
    contractLabel: 'Contrato MuzzID en Sepolia',
    copy: 'Copiar',
    copied: 'Copiado',
    cancel: 'Cancelar',
    continue: 'Continuar'
  };

  var MUZZID_LINKS = {
    app: 'https://muzzid-testnet.vercel.app',
    faucets: [
      { url: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia', key: 'faucetGoogle' },
      { url: 'https://sepolia-faucet.pk910.de', key: 'faucetPk910' }
    ],
    contract: '0x80A70E660D0cE2Dba4a7547F3B905403f2A18af8'
  };

  /**
   * New tab on the web. In the APK (Capacitor) the WebView hands a non-app host to the system
   * browser; the project has no Browser plugin, so window.open is the external-link path there too.
   */
  function openExternal(url) {
    var win = global.open(url, '_blank', 'noopener,noreferrer');
    if (win) { try { win.opener = null; } catch (err) { /* cross-origin */ } }
    return win;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function close() {
    var box = document.getElementById('muzzIdDialog');
    if (box && typeof box.__close === 'function') box.__close();
  }

  /** Opens the dialog. returnFocus gets the focus back on close. */
  function open(returnFocus) {
    close();
    var T = MUZZID_TEXT;
    var backdrop = el('div', 'muzz-confirm-backdrop muzzid-backdrop');
    backdrop.id = 'muzzIdDialog';
    var box = el('div', 'muzz-confirm muzzid-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'muzzIdTitle');
    box.setAttribute('aria-describedby', 'muzzIdWarning');

    var title = el('h2', 'muzzid-title', T.title);
    title.id = 'muzzIdTitle';
    var warning = el('p', 'muzz-confirm-text muzzid-warning', T.warning);
    warning.id = 'muzzIdWarning';

    var faucets = el('div', 'muzzid-faucets');
    faucets.appendChild(el('p', 'muzzid-label', T.faucetsTitle));
    MUZZID_LINKS.faucets.forEach(function (f) {
      var a = el('a', 'muzzid-link', T[f.key]);
      a.href = f.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      faucets.appendChild(a);
    });

    var contract = el('div', 'muzzid-contract');
    contract.appendChild(el('p', 'muzzid-label', T.contractLabel));
    var row = el('div', 'muzzid-contract-row');
    var addr = el('code', 'muzzid-address', MUZZID_LINKS.contract);
    addr.id = 'muzzIdContract';
    var copy = el('button', 'muzzid-copy', T.copy);
    copy.type = 'button';
    copy.addEventListener('click', function () {
      var done = function () { copy.textContent = T.copied; };
      try {
        if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(MUZZID_LINKS.contract).then(done, function () { selectAddress(); });
        } else selectAddress();
      } catch (err) { selectAddress(); }
    });
    function selectAddress() {
      try { var r = document.createRange(); r.selectNodeContents(addr); var s = global.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (err) { /* manual copy */ }
    }
    row.appendChild(addr);
    row.appendChild(copy);
    contract.appendChild(row);

    var actions = el('div', 'muzz-confirm-actions');
    var cancel = el('button', 'btn ghost muzz-confirm-cancel', T.cancel);
    cancel.type = 'button';
    cancel.setAttribute('data-act', 'cancel');
    var ok = el('button', 'btn muzz-confirm-ok', T.continue);
    ok.type = 'button';
    ok.setAttribute('data-act', 'continue');
    actions.appendChild(cancel);
    actions.appendChild(ok);

    box.appendChild(title);
    box.appendChild(warning);
    box.appendChild(faucets);
    box.appendChild(contract);
    box.appendChild(actions);
    backdrop.appendChild(box);

    var closed = false;
    function shut() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (returnFocus && typeof returnFocus.focus === 'function') {
        try { returnFocus.focus(); } catch (err) { /* gone */ }
      }
    }
    backdrop.__close = shut;
    backdrop.addEventListener('click', function (event) { if (event.target === backdrop) shut(); });
    cancel.addEventListener('click', shut);
    ok.addEventListener('click', function () {
      shut();
      openExternal(MUZZID_LINKS.app);
    });
    function onKey(event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        event.stopPropagation();
        shut();
        return;
      }
      if (event.key === 'Tab') {
        var items = Array.prototype.slice.call(box.querySelectorAll('a[href], button'));
        var i = items.indexOf(document.activeElement);
        event.preventDefault();
        var next = event.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i === items.length - 1 ? 0 : i + 1);
        items[next].focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    (document.body || document.documentElement).appendChild(backdrop);
    /* Cancel takes the first focus, like the translate warning. */
    cancel.focus();
    return backdrop;
  }

  global.MuzzIdTestnet = { TEXT: MUZZID_TEXT, LINKS: MUZZID_LINKS, open: open, close: close, openExternal: openExternal };
})(window);
