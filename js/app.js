/**
 * app.js — Entry point.
 * Imports all modules, wires up event listeners, and exposes the small set of
 * functions that Capacitor / the HTML layer needs on `window`.
 * No business logic lives here — only orchestration.
 */
'use strict';

import { boot, doRegister, doLogin, doLogout,
         switchTab, setPresenceSubFn, setChannelClearFns } from './auth.js';
import { subPresence, clearPresenceCh, renderContacts,
         updateChatStatus, onVisibility,
         onOnline, onOffline, closeMobile }                 from './presence.js';
import { openChat, doSend, flushOfflineQueue, bcastTyping,
         onInput, onKey, clearMsgCh, initScrollPagination,
         clearReply }                                        from './messages.js';
import { doExport }                                         from './export.js';
import { toggleTheme, tpwd, toggleEmoji }                  from './ui.js';

/* ── Break circular deps by injecting callbacks ── */
setPresenceSubFn(subPresence);
setChannelClearFns(clearPresenceCh, clearMsgCh);

/* ── Globals needed by presence.js (calls window.xxx to avoid circular import) ── */
window.openChat        = openChat;
window.updateChatStatus = updateChatStatus;
window.flushOfflineQueue = flushOfflineQueue;
window.bcastTyping     = bcastTyping;

/* ═══════════════════════════════════════════════════════════
   DOM-READY — bind every event listener
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Auth tabs ── */
  document.getElementById('tab-in')?.addEventListener('click', () => switchTab('in'));
  document.getElementById('tab-up')?.addEventListener('click', () => switchTab('up'));

  /* ── Register form ── */
  document.getElementById('btn-up')?.addEventListener('click', doRegister);
  ['rn', 'rp', 'rph'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
  });

  /* ── Login form ── */
  document.getElementById('btn-in')?.addEventListener('click', doLogin);
  ['lp', 'lph'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });

  /* ── Password visibility toggles — use data-target attr ── */
  document.querySelectorAll('.pt[data-target]').forEach(btn => {
    btn.addEventListener('click', () => tpwd(btn.dataset.target, btn));
  });

  /* ── App header ── */
  document.getElementById('theme-btn')?.addEventListener('click', toggleTheme);
  document.getElementById('logout-btn')?.addEventListener('click', doLogout);

  /* ── Chat header ── */
  document.getElementById('back-btn')?.addEventListener('click', closeMobile);
  document.getElementById('export-btn')?.addEventListener('click', doExport);
  document.getElementById('chat-theme-btn')?.addEventListener('click', toggleTheme);

  /* ── Reply bar close ── */
  document.getElementById('reply-close')?.addEventListener('click', clearReply);

  /* ── Message input ── */
  const inp = document.getElementById('msg-inp');
  if (inp) {
    inp.addEventListener('input',   onInput);
    inp.addEventListener('keydown', onKey);
    inp.addEventListener('paste', e => {
      const txt = e.clipboardData?.getData('text') || '';
      const cur = inp.value;
      if (cur.length + txt.length > 4000) {
        e.preventDefault();
        const allowed = 4000 - cur.length;
        if (allowed > 0) inp.value = cur + txt.slice(0, allowed);
        import('./ui.js').then(({ toast }) => toast('Message capped at 4000 characters'));
      }
    });
  }

  /* ── Emoji ── */
  document.getElementById('em-btn')?.addEventListener('click', () => toggleEmoji());
  document.addEventListener('click', e => {
    const p = document.getElementById('em-pick');
    if (p?.classList.contains('show') && !e.target.closest('.em-pick') && !e.target.closest('#em-btn'))
      p.classList.remove('show');
  });

  /* ── Send ── */
  document.getElementById('send-b')?.addEventListener('click', doSend);

  /* ── Scroll pagination ── */
  initScrollPagination();

  /* ── Capacitor / Visual Viewport (keyboard avoidance) ── */
  if (window.Capacitor?.Plugins?.Keyboard) {
    const Keyboard = window.Capacitor.Plugins.Keyboard;
    Keyboard.addListener('keyboardWillShow', info => {
      const sApp = document.getElementById('s-app');
      if (sApp) sApp.style.paddingBottom = info.keyboardHeight + 'px';
      import('./ui.js').then(({ scrollBottom }) => scrollBottom(false));
    });
    Keyboard.addListener('keyboardWillHide', () => {
      const sApp = document.getElementById('s-app');
      if (sApp) sApp.style.paddingBottom = '0px';
    });
  } else if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const chatUI = document.getElementById('chat-ui');
      if (!chatUI || chatUI.style.display === 'none') return;
      const vv     = window.visualViewport;
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      const sApp   = document.getElementById('s-app');
      if (sApp) sApp.style.paddingBottom = offset > 0 ? offset + 'px' : '0';
      import('./ui.js').then(({ scrollBottom }) => scrollBottom(false));
    });
  }

  /* ── Capacitor Native Integrations ── */
  if (window.Capacitor?.Plugins) {
    const { App, StatusBar } = window.Capacitor.Plugins;
    if (App) {
      App.addListener('backButton', ({ canGoBack }) => {
        const sApp = document.getElementById('s-app');
        if (sApp && sApp.classList.contains('mobile-chat-active')) {
          import('./presence.js').then(({ closeMobile }) => closeMobile());
        } else {
          if (canGoBack) window.history.back();
          else App.exitApp();
        }
      });
    }
    if (StatusBar) {
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
    }
  }

  /* ── Network events ── */
  window.addEventListener('online',  onOnline);
  window.addEventListener('offline', onOffline);

  /* ── Visibility (away/online presence) ── */
  document.addEventListener('visibilitychange', onVisibility);

  /* ── Boot the app ── */
  boot();
});
