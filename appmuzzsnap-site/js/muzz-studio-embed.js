/**
 * MuzzSnap-only studio skin.
 * Injects CSS/JS into the MuzzStudio-LIVE iframe without editing that folder.
 */
(function (global) {
  'use strict';

  var EMBED_CSS = `
/* Injected by MuzzSnap — do not edit LIVE folder */
html.embed-muzzsnap .wallet-gate,
body.embed-muzzsnap .wallet-gate { display:none!important; }

html.embed-muzzsnap.wallet-locked main.layout,
body.embed-muzzsnap.wallet-locked main.layout,
html.embed-muzzsnap.wallet-locked .header,
body.embed-muzzsnap.wallet-locked .header {
  filter:none!important; pointer-events:auto!important; opacity:1!important; user-select:auto!important;
}

/* No recording */
html.embed-muzzsnap #btnStartRecord,
html.embed-muzzsnap #btnStopRecord,
body.embed-muzzsnap #btnStartRecord,
body.embed-muzzsnap #btnStopRecord { display:none!important; }

/* Hide entire left SOURCES panel — button moved under PROGRAM */
html.embed-muzzsnap .panel.left,
body.embed-muzzsnap .panel.left { display:none!important; }

/* Only PROGRAM monitor (hide PREVIEW) */
html.embed-muzzsnap #monitorPreview,
body.embed-muzzsnap #monitorPreview { display:none!important; }
html.embed-muzzsnap #btnMonDual,
body.embed-muzzsnap #btnMonDual { display:none!important; }
/* PROGRAM only — larger (uses space freed under screen) */
html.embed-muzzsnap #previewWrap,
body.embed-muzzsnap #previewWrap {
  display:grid!important;
  grid-template-columns:1fr!important;
  max-height:58vh!important;
  overflow:hidden!important;
  justify-items:center!important;
  align-content:start!important;
  width:100%!important;
}
html.embed-muzzsnap #monitorLive,
body.embed-muzzsnap #monitorLive {
  width:100%!important;
  max-width:920px!important;
  margin:0 auto!important;
}
html.embed-muzzsnap #monitorLive .preview-frame,
body.embed-muzzsnap #monitorLive .preview-frame {
  max-height:52vh!important;
  width:min(100%,920px)!important;
  margin:0 auto!important;
}
html.embed-muzzsnap #liveCanvas,
body.embed-muzzsnap #liveCanvas {
  max-height:52vh!important;
  width:100%!important;
  height:auto!important;
  object-fit:contain!important;
}

/* Bottom strip: LEFT audio | RIGHT sources */
html.embed-muzzsnap #bottomTools,
body.embed-muzzsnap #bottomTools {
  display:grid!important;
  grid-template-columns:1fr 1fr!important;
  gap:8px!important;
  align-items:stretch!important;
  max-height:168px!important;
  min-height:140px!important;
  overflow:hidden!important;
}
html.embed-muzzsnap #captionsPanel,
body.embed-muzzsnap #captionsPanel { display:none!important; }

html.embed-muzzsnap #mixerPanel,
body.embed-muzzsnap #mixerPanel,
html.embed-muzzsnap .mixer-panel,
body.embed-muzzsnap .mixer-panel {
  max-height:160px!important;
  min-height:0!important;
  overflow:hidden!important;
  border:1px solid rgba(255,255,255,.08)!important;
  border-radius:12px!important;
}
html.embed-muzzsnap .mixer,
body.embed-muzzsnap .mixer,
html.embed-muzzsnap #audioChannels,
body.embed-muzzsnap #audioChannels {
  height:110px!important;
  min-height:96px!important;
  max-height:110px!important;
  padding:4px 8px 6px!important;
  align-items:flex-end!important;
}
/* Show audio channel names */
html.embed-muzzsnap .mixer .ch,
body.embed-muzzsnap .mixer .ch {
  min-width:70px!important;
  max-width:86px!important;
}
html.embed-muzzsnap .mixer .ch .name,
body.embed-muzzsnap .mixer .ch .name {
  display:block!important;
  visibility:visible!important;
  opacity:1!important;
  color:#e8eef8!important;
  font-size:10px!important;
  font-weight:700!important;
  line-height:1.15!important;
  max-width:78px!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  white-space:nowrap!important;
  text-align:center!important;
  margin:2px 0!important;
}
html.embed-muzzsnap .mixer .ch .ch-type,
body.embed-muzzsnap .mixer .ch .ch-type {
  display:block!important;
  text-align:center!important;
  font-size:14px!important;
}

/* Sources panel (right half of bottom tools) — RESTORED */
html.embed-muzzsnap #bottomTools,
body.embed-muzzsnap #bottomTools {
  display:grid!important;
  grid-template-columns:1fr 1fr!important;
  gap:8px!important;
}
html.embed-muzzsnap #muzzsnapSrcPanel,
body.embed-muzzsnap #muzzsnapSrcPanel {
  display:flex!important;
  visibility:visible!important;
  opacity:1!important;
  flex-direction:column!important;
  min-width:0!important;
  border:1px solid rgba(255,60,60,.28)!important;
  border-radius:12px!important;
  background:linear-gradient(180deg,rgba(60,0,20,.35),rgba(8,10,16,.9))!important;
  overflow:hidden!important;
  max-height:160px!important;
}
html.embed-muzzsnap .muzzsnap-src-h,
body.embed-muzzsnap .muzzsnap-src-h {
  display:flex!important;
  align-items:center!important;
  justify-content:space-between!important;
  padding:6px 10px 4px!important;
  font-size:11px!important;
  font-weight:800!important;
  letter-spacing:1.2px!important;
  text-transform:uppercase!important;
  color:#fff!important;
  flex-shrink:0!important;
}
html.embed-muzzsnap #muzzsnapSrcList,
body.embed-muzzsnap #muzzsnapSrcList {
  flex:1!important;
  overflow:auto!important;
  padding:4px 8px 8px!important;
  display:flex!important;
  flex-direction:column!important;
  gap:4px!important;
}
html.embed-muzzsnap .muzzsnap-src-row,
body.embed-muzzsnap .muzzsnap-src-row {
  display:flex!important;
  align-items:center!important;
  gap:8px!important;
  padding:7px 8px!important;
  border-radius:10px!important;
  border:1px solid rgba(255,255,255,.06)!important;
  background:rgba(0,0,0,.28)!important;
  cursor:pointer!important;
  font-size:12px!important;
}
html.embed-muzzsnap .muzzsnap-src-row:hover,
body.embed-muzzsnap .muzzsnap-src-row:hover {
  border-color:rgba(255,60,60,.35)!important;
}
html.embed-muzzsnap .muzzsnap-src-row.active,
body.embed-muzzsnap .muzzsnap-src-row.active {
  border-color:rgba(255,60,60,.55)!important;
  background:rgba(255,40,40,.14)!important;
}
html.embed-muzzsnap .muzzsnap-src-row .nm,
body.embed-muzzsnap .muzzsnap-src-row .nm {
  flex:1!important;
  min-width:0!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  white-space:nowrap!important;
  font-weight:700!important;
  color:#fff!important;
}
html.embed-muzzsnap .muzzsnap-src-row .meta,
body.embed-muzzsnap .muzzsnap-src-row .meta {
  font-size:10px!important;
  color:#93a0b3!important;
}
html.embed-muzzsnap .muzzsnap-src-row .rm,
body.embed-muzzsnap .muzzsnap-src-row .rm {
  border:0!important;
  background:rgba(255,255,255,.06)!important;
  color:#f87171!important;
  width:26px!important;
  height:26px!important;
  border-radius:8px!important;
  cursor:pointer!important;
  font-weight:800!important;
  flex-shrink:0!important;
}
html.embed-muzzsnap .muzzsnap-src-empty,
body.embed-muzzsnap .muzzsnap-src-empty {
  color:#6b7280!important;
  font-size:11px!important;
  padding:12px 8px!important;
  text-align:center!important;
}
html.embed-muzzsnap #muzzsnapSourceBar,
body.embed-muzzsnap #muzzsnapSourceBar { display:none!important; }

/* Hide captions / themes / settings / disconnect */
html.embed-muzzsnap #captionsPanel,
html.embed-muzzsnap #btnTheme,
html.embed-muzzsnap .theme-wrap,
html.embed-muzzsnap #btnSettings,
html.embed-muzzsnap #btnWalletDisconnect,
body.embed-muzzsnap #captionsPanel,
body.embed-muzzsnap #btnTheme,
body.embed-muzzsnap .theme-wrap,
body.embed-muzzsnap #btnSettings,
body.embed-muzzsnap #btnWalletDisconnect { display:none!important; }

/* Keep YouTube + TikTok only */
html.embed-muzzsnap .plat-card.fb,
html.embed-muzzsnap .plat-card.kick,
html.embed-muzzsnap .plat-card.x,
html.embed-muzzsnap .pill.fb,
html.embed-muzzsnap .pill.kick,
html.embed-muzzsnap .pill.x,
body.embed-muzzsnap .plat-card.fb,
body.embed-muzzsnap .plat-card.kick,
body.embed-muzzsnap .plat-card.x,
body.embed-muzzsnap .pill.fb,
body.embed-muzzsnap .pill.kick,
body.embed-muzzsnap .pill.x { display:none!important; }

/* Source types: display / window / camera only */
html.embed-muzzsnap .src-card[data-type="wifi_camera"],
html.embed-muzzsnap .src-card[data-type="image"],
html.embed-muzzsnap .src-card[data-type="text"],
html.embed-muzzsnap .src-card[data-type="color"],
html.embed-muzzsnap .src-card[data-type="media"],
body.embed-muzzsnap .src-card[data-type="wifi_camera"],
body.embed-muzzsnap .src-card[data-type="image"],
body.embed-muzzsnap .src-card[data-type="text"],
body.embed-muzzsnap .src-card[data-type="color"],
body.embed-muzzsnap .src-card[data-type="media"] { display:none!important; }

/* Audio: desktop + mic/camera only */
html.embed-muzzsnap .src-card[data-audio="window"],
html.embed-muzzsnap .src-card[data-audio="music"],
body.embed-muzzsnap .src-card[data-audio="window"],
body.embed-muzzsnap .src-card[data-audio="music"] { display:none!important; }

/* SHOW chat wider (override LIVE default hide) */
html.embed-muzzsnap .studio-chat,
body.embed-muzzsnap .studio-chat,
html.embed-muzzsnap #studioChat,
body.embed-muzzsnap #studioChat {
  display:flex!important; flex:1; min-height:220px;
}
html.embed-muzzsnap .panel.right,
body.embed-muzzsnap .panel.right {
  display:flex!important; flex-direction:column;
  min-width:340px!important; max-width:420px!important; width:380px!important;
}

html.embed-muzzsnap #recordPath,
html.embed-muzzsnap #btnBrowseRecord,
body.embed-muzzsnap #recordPath,
body.embed-muzzsnap #btnBrowseRecord { display:none!important; }
`;

  function inject(frame) {
    try {
      var doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      if (!doc || !doc.documentElement) return false;

      doc.documentElement.classList.add('embed-muzzsnap');
      if (doc.body) {
        doc.body.classList.add('embed-muzzsnap');
        doc.body.classList.remove('wallet-locked');
      }

      var style = doc.getElementById('muzzsnap-embed-skin');
      if (!style) {
        style = doc.createElement('style');
        style.id = 'muzzsnap-embed-skin';
        (doc.head || doc.documentElement).appendChild(style);
      }
      style.textContent = EMBED_CSS;

      // Label mic as camera audio (DOM only, no LIVE file edit)
      var micCard = doc.querySelector('.src-card[data-audio="mic"]');
      if (micCard && !micCard.dataset.muzzRelabel) {
        micCard.dataset.muzzRelabel = '1';
        micCard.innerHTML = '<div class="ic">🎤</div>Camera / mic audio';
      }

      // Force LIVE/PROGRAM only (click studio's own button if present)
      try {
        var liveOnly = doc.getElementById('btnMonLive');
        if (liveOnly && !liveOnly.classList.contains('active')) liveOnly.click();
        var wrap = doc.getElementById('previewWrap');
        if (wrap) wrap.classList.remove('dual');
      } catch (_) {}

      // Bottom: audio | sources split + source button in SOURCES header
      ensureAudioSourcesSplit(doc, frame.contentWindow);

      // Sources land on PREVIEW in LIVE app — we only show PROGRAM, so auto-TAKE
      hookAutoTakeToProgram(doc, frame.contentWindow);

      // Unlock from MuzzSnap session (same origin)
      tryUnlockStudio(doc, frame.contentWindow);

      // Enable chat input if session ok
      tryEnableChat(doc);

      return true;
    } catch (e) {
      console.warn('[MuzzStudio embed inject]', e);
      return false;
    }
  }

  function tryUnlockStudio(doc, win) {
    try {
      var addr = String(sessionStorage.getItem('muzz_wallet_address') || '').toLowerCase();
      var gate = sessionStorage.getItem('muzz_social_gate') || '';
      if (!addr || gate !== 'ok') return;
      if (!win) return;

      var balHuman = String(sessionStorage.getItem('muzz_token_balance') || '1');
      var contract = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';

      // Patch MuzzWallet so studio-chat getHolderAddress() succeeds
      patchMuzzWallet(win, addr, balHuman, contract);

      // Hide gate UI
      var gateEl = doc.getElementById('walletGate');
      if (gateEl) gateEl.style.display = 'none';
      if (doc.body) doc.body.classList.remove('wallet-locked');

      // Fire unlock for chat listeners (after patch)
      win.dispatchEvent(
        new win.CustomEvent('muzz-wallet-unlocked', {
          detail: {
            address: addr,
            balance: balHuman,
            contract: contract,
            holder: true,
            fromMuzzSnap: true,
          },
        })
      );

      // Enable compose UI immediately
      var input = doc.getElementById('chatInput');
      var send = doc.getElementById('chatSend');
      if (input) {
        input.disabled = false;
        input.placeholder = 'Message…';
      }
      if (send) send.disabled = false;
      var box = doc.getElementById('chatMessages');
      if (box && /Unlock with MUZZ|Connect wallet/i.test(box.textContent || '')) {
        box.innerHTML = '<div class="chat-empty">Connected via MuzzSnap · ' + addr.slice(0, 6) + '…</div>';
      }
    } catch (e) {
      console.warn('[MuzzStudio unlock]', e);
    }
  }

  function patchMuzzWallet(win, addr, balHuman, contract) {
    try {
      var bal = '1';
      try {
        var n = Math.floor(Number(balHuman) || 1);
        if (n > 0) bal = String(n);
      } catch (_) {}

      if (!win.MuzzWallet) win.MuzzWallet = {};
      var W = win.MuzzWallet;
      W.MUZZ_TOKEN = contract;
      W.isUnlocked = function () { return true; };
      W.isHolder = function () { return true; };
      W.getVerifiedAddress = function () { return addr; };
      W.getState = function () {
        return {
          address: addr,
          unlocked: true,
          balance: bal,
          contract: contract,
          holder: true,
          fromMuzzSnap: true,
        };
      };
      // Keep token contract in session for chat checks
      try {
        sessionStorage.setItem('muzz_token_contract', contract);
      } catch (_) {}
    } catch (e) {
      console.warn('[MuzzStudio patch wallet]', e);
    }
  }

  function tryEnableChat(doc) {
    try {
      var gate = sessionStorage.getItem('muzz_social_gate') || '';
      var addr = sessionStorage.getItem('muzz_wallet_address') || '';
      if (gate !== 'ok' || !addr) return;
      var input = doc.getElementById('chatInput');
      var send = doc.getElementById('chatSend');
      if (input) {
        input.disabled = false;
        input.placeholder = 'Message…';
      }
      if (send) send.disabled = false;
    } catch (_) {}
  }

  function hookAutoTakeToProgram(doc, win) {
    try {
      if (!win || !win.app || win.app.__muzzAutoTake) return;
      var app = win.app;
      app.__muzzAutoTake = true;

      // In MuzzSnap we only show PROGRAM: keep it live-linked to PREVIEW (no frozen clone)
      if (typeof app.takePreviewToProgram === 'function') {
        app.takePreviewToProgram = function () {
          if (!this.previewScene) return null;
          this.programScene = this.previewScene;
          this.currentScene = this.previewScene;
          return this.programScene;
        };
      }

      function syncLive() {
        try {
          if (!app.previewScene) return;
          app.programScene = app.previewScene;
          app.currentScene = app.previewScene;
          if (typeof app.updateMonitorLabels === 'function') app.updateMonitorLabels();
          if (typeof app.renderSources === 'function') app.renderSources();
        } catch (e) {
          console.warn('[MuzzStudio syncLive]', e);
        }
      }

      if (typeof app.confirmSource === 'function') {
        var origConfirm = app.confirmSource.bind(app);
        app.confirmSource = async function () {
          await origConfirm();
          syncLive();
          setTimeout(syncLive, 100);
          setTimeout(syncLive, 400);
        };
      }

      // When source list changes, re-sync
      var list = doc.getElementById('sourceList');
      if (list && !list.__muzzObs) {
        list.__muzzObs = true;
        var obs = new win.MutationObserver(function () {
          setTimeout(syncLive, 80);
        });
        obs.observe(list, { childList: true, subtree: true });
      }

      // Keep LIVE bus = PREVIEW bus continuously in embed
      if (!win.__muzzSyncTimer) {
        win.__muzzSyncTimer = win.setInterval(syncLive, 500);
      }

      // Initial sync
      syncLive();
    } catch (e) {
      console.warn('[MuzzStudio hookAutoTake]', e);
    }
  }

  function ensureAudioSourcesSplit(doc, win) {
    try {
      var bottom = doc.getElementById('bottomTools');
      var mixer = doc.getElementById('mixerPanel');
      if (!bottom || !mixer) return;

      var panel = doc.getElementById('muzzsnapSrcPanel');
      if (!panel) {
        panel = doc.createElement('div');
        panel.id = 'muzzsnapSrcPanel';
        panel.innerHTML =
          '<div class="muzzsnap-src-h">' +
          '<span>SOURCES</span>' +
          '<div class="muzzsnap-src-actions"></div>' +
          '</div>' +
          '<div id="muzzsnapSrcList" class="muzzsnap-src-list"></div>';
        bottom.appendChild(panel);
      }

      // Always force visible (never hide Sources again)
      panel.style.display = 'flex';
      panel.style.visibility = 'visible';
      panel.style.opacity = '1';

      // Put real + Source button into SOURCES header (keeps studio handlers)
      var original = doc.getElementById('btnAddSource');
      var actions = panel.querySelector('.muzzsnap-src-actions');
      if (original && actions && original.parentNode !== actions) {
        original.textContent = '+ Source';
        original.className = 'btn secondary sm';
        original.title = 'Add source (display / window / camera)';
        actions.appendChild(original);
      }

      var oldBar = doc.getElementById('muzzsnapSourceBar');
      if (oldBar) oldBar.remove();

      installSourceBridge(doc, win);
      bindSrcListDelegation(doc, win);
      refreshSrcList(doc, win);
      hookRenderSources(doc, win);

      // Light poll — only rebuilds when source ids actually change (no click-kill)
      if (!win.__muzzSrcPoll) {
        win.__muzzSrcPoll = setInterval(function () {
          try {
            installSourceBridge(doc, win);
            refreshSrcList(doc, win);
          } catch (_) {}
        }, 1200);
      }
    } catch (e) {
      console.warn('[MuzzStudio split]', e);
    }
  }

  function bindSrcListDelegation(doc, win) {
    var list = doc.getElementById('muzzsnapSrcList');
    if (!list || list.__muzzDelegated) return;
    list.__muzzDelegated = true;

    list.addEventListener(
      'click',
      function (e) {
        var t = e.target;
        if (!t) return;
        var rm = t.closest ? t.closest('button.rm') : null;
        var row = t.closest ? t.closest('.muzzsnap-src-row') : null;
        if (!row) return;
        var id = row.getAttribute('data-id');
        if (!id) return;

        e.preventDefault();
        e.stopPropagation();

        if (rm) {
          console.log('[MuzzSnap] ✕ remove', id);
          if (win.__muzzHardRemove) win.__muzzHardRemove(id);
          else hardRemoveSource(doc, win, id);
          // force UI update after remove
          setTimeout(function () { refreshSrcList(doc, win, true); }, 40);
          setTimeout(function () { refreshSrcList(doc, win, true); }, 300);
          return;
        }

        console.log('[MuzzSnap] focus source', id);
        if (win.__muzzFocusSource) win.__muzzFocusSource(id);
        else focusSourceOnProgram(doc, win, id);
        setTimeout(function () { refreshSrcList(doc, win, true); }, 40);
      },
      true
    );
  }

  function hookRenderSources(doc, win) {
    try {
      if (!win || !win.app || win.app.__muzzSrcListHook) return;
      win.app.__muzzSrcListHook = true;
      if (typeof win.app.renderSources === 'function') {
        var orig = win.app.renderSources.bind(win.app);
        win.app.renderSources = function () {
          orig();
          refreshSrcList(doc, win);
        };
      }
      if (typeof win.app.renderMixer === 'function') {
        var origMix = win.app.renderMixer.bind(win.app);
        win.app.renderMixer = function () {
          origMix();
          // names already in DOM; CSS forces visibility
        };
      }
    } catch (e) {
      console.warn('[MuzzStudio hook render]', e);
    }
  }

  function stopSourceMedia(app, id) {
    try {
      var vid = app.sourceVideos && app.sourceVideos.get(id);
      if (vid) {
        try { vid.pause && vid.pause(); } catch (_) {}
        try {
          if (vid.srcObject && vid.srcObject.getTracks) {
            vid.srcObject.getTracks().forEach(function (t) { t.stop(); });
          }
        } catch (_) {}
      }
      var st = app.sourceStreams && app.sourceStreams.get(id);
      if (st && st.getTracks) st.getTracks().forEach(function (t) { t.stop(); });
      if (app.sourceVideos) app.sourceVideos.delete(id);
      if (app.sourceImages) app.sourceImages.delete(id);
      if (app.sourceStreams) app.sourceStreams.delete(id);
    } catch (_) {}
  }

  function installSourceBridge(doc, win) {
    if (!win || !win.app || win.__muzzBridgeInstalled) return;
    win.__muzzBridgeInstalled = true;

    win.__muzzHardRemove = function (sourceId) {
      try {
        hardRemoveSource(doc, win, sourceId);
        return true;
      } catch (e) {
        console.error('[__muzzHardRemove]', e);
        return false;
      }
    };
    win.__muzzFocusSource = function (sourceId) {
      try {
        focusSourceOnProgram(doc, win, sourceId);
        return true;
      } catch (e) {
        console.error('[__muzzFocusSource]', e);
        return false;
      }
    };
  }

  function hardRemoveSource(doc, win, sourceId) {
    try {
      var app = win && win.app;
      if (!app || !sourceId) return;
      console.log('[hardRemoveSource]', sourceId);

      // 1) Stop camera / screen tracks immediately (always — even if still on program)
      stopSourceMedia(app, sourceId);

      // 2) Remove from every scene object the app might hold
      function strip(sc) {
        if (!sc || !Array.isArray(sc.sources)) return;
        sc.sources = sc.sources.filter(function (s) { return s.id !== sourceId; });
      }
      strip(app.previewScene);
      strip(app.programScene);
      strip(app.currentScene);
      if (Array.isArray(app.scenes)) app.scenes.forEach(strip);

      // 3) Polyfill backend — all known scene ids
      try {
        if (win.muzz && win.muzz.removeSource) {
          var ids = {};
          function mark(sc) { if (sc && sc.id) ids[sc.id] = true; }
          mark(app.previewScene);
          mark(app.programScene);
          mark(app.currentScene);
          if (Array.isArray(app.scenes)) app.scenes.forEach(mark);
          Object.keys(ids).forEach(function (sid) {
            try { win.muzz.removeSource(sid, sourceId); } catch (_) {}
          });
        }
      } catch (_) {}

      // 4) Native studio remove (async) — after our strip so stillOnAir is false
      try {
        if (typeof app.removeSource === 'function') {
          Promise.resolve(app.removeSource(sourceId)).catch(function () {});
        }
      } catch (_) {}

      if (app.selectedSourceId === sourceId) app.selectedSourceId = null;

      // 5) Keep PROGRAM linked to PREVIEW (embed mode)
      if (app.previewScene) {
        app.programScene = app.previewScene;
        app.currentScene = app.previewScene;
      }

      try { if (typeof app.renderSources === 'function') app.renderSources(); } catch (_) {}
      try { if (typeof app.updateFitBar === 'function') app.updateFitBar(); } catch (_) {}
      try { app.toast && app.toast('Source closed ✕', 'warn'); } catch (_) {}
      refreshSrcList(doc, win, true);
    } catch (err) {
      console.warn('[hardRemoveSource]', err);
    }
  }

  function focusSourceOnProgram(doc, win, sourceId) {
    try {
      var app = win && win.app;
      if (!app || !sourceId) return;
      var sc = (typeof app.editScene === 'function' && app.editScene()) || app.previewScene;
      if (!sc || !sc.sources) return;

      var idx = -1;
      for (var i = 0; i < sc.sources.length; i++) {
        if (sc.sources[i].id === sourceId) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return;

      var item = sc.sources.splice(idx, 1)[0];
      item.visible = true;
      item.selected = true;
      var rw = (app.resolution && app.resolution.w) || 1920;
      var rh = (app.resolution && app.resolution.h) || 1080;
      item.transform = { x: 0, y: 0, w: rw, h: rh };
      item.properties = Object.assign({}, item.properties || {}, { fitMode: 'cover' });
      sc.sources.forEach(function (s) {
        s.selected = false;
      });
      sc.sources.push(item);

      try {
        if (win.muzz && win.muzz.updateSource) {
          win.muzz.updateSource(sc.id, item.id, {
            transform: item.transform,
            properties: item.properties,
            visible: true,
          });
        }
      } catch (_) {}

      app.selectedSourceId = sourceId;
      app.previewScene = sc;
      app.programScene = sc;
      app.currentScene = sc;

      var fit = doc.getElementById('sourceFitBar');
      if (fit) {
        fit.style.display = 'flex';
        fit.style.visibility = 'visible';
        fit.style.opacity = '1';
      }
      try {
        if (typeof app.selectSource === 'function') app.selectSource(sourceId);
      } catch (_) {}
      try { if (typeof app.renderSources === 'function') app.renderSources(); } catch (_) {}
      try { if (typeof app.updateFitBar === 'function') app.updateFitBar(); } catch (_) {}
      try { app.toast && app.toast('Live → ' + (item.name || item.type), 'ok'); } catch (_) {}
      refreshSrcList(doc, win);
    } catch (err) {
      console.warn('[focusSourceOnProgram]', err);
    }
  }

  function sourcesSignature(sources, selectedId) {
    return (sources || [])
      .map(function (s) {
        return [
          s.id,
          s.name || '',
          s.type || '',
          s.visible === false ? '0' : '1',
          s.id === selectedId || s.selected ? '1' : '0',
        ].join(':');
      })
      .join('|');
  }

  function refreshSrcList(doc, win, force) {
    try {
      var list = doc.getElementById('muzzsnapSrcList');
      if (!list) return;
      bindSrcListDelegation(doc, win);

      var app = win && win.app;
      if (!app) {
        list.innerHTML = '<div class="muzzsnap-src-empty">Loading…</div>';
        list.__muzzSig = '';
        return;
      }
      var scene =
        (typeof app.editScene === 'function' && app.editScene()) ||
        app.previewScene ||
        app.programScene;
      var sources = (scene && scene.sources) || [];
      var sig = sourcesSignature(sources, app.selectedSourceId);
      if (!force && list.__muzzSig === sig) return;
      list.__muzzSig = sig;

      if (!sources.length) {
        list.innerHTML = '<div class="muzzsnap-src-empty">No sources yet. Press + Source</div>';
        return;
      }
      var icons = {
        display: '🖥️',
        window: '🗔',
        webcam: '📷',
        wifi_camera: '📶',
        image: '🖼️',
        text: 'Aa',
        color: '🎨',
        media: '🎬',
        addon: '🧩',
      };
      list.innerHTML = '';
      sources
        .slice()
        .reverse()
        .forEach(function (src) {
          var row = doc.createElement('div');
          var sel = src.id === app.selectedSourceId || src.selected;
          row.className = 'muzzsnap-src-row' + (sel ? ' active' : '');
          row.setAttribute('data-id', src.id);
          row.innerHTML =
            '<span class="ic">' +
            (icons[src.type] || '●') +
            '</span>' +
            '<div style="flex:1;min-width:0">' +
            '<div class="nm"></div>' +
            '<div class="meta"></div>' +
            '</div>' +
            '<button type="button" class="rm" title="Close / remove">✕</button>';
          row.querySelector('.nm').textContent = src.name || src.type || 'Source';
          row.querySelector('.meta').textContent =
            (src.type || '') + (src.visible === false ? ' · hidden' : '');
          list.appendChild(row);
        });
    } catch (e) {
      console.warn('[MuzzStudio src list]', e);
    }
  }

  function bind(frame) {
    if (!frame) return;
    var apply = function () {
      inject(frame);
      // retries — studio DOM/wallet init can lag
      setTimeout(function () { inject(frame); }, 600);
      setTimeout(function () { inject(frame); }, 1500);
      setTimeout(function () { inject(frame); }, 3000);
    };
    frame.addEventListener('load', apply);
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete') apply();
  }

  global.MuzzStudioEmbed = { bind: bind, inject: inject };
})(window);
