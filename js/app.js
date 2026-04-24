/**
 * app.js — Entry point.
 * Imports all modules, wires up event listeners, and exposes the small set of
 * functions that Capacitor / the HTML layer needs on `window`.
 * No business logic lives here — only orchestration.
 */
'use strict';

import {
  boot, doRegister, doLogin, doLogout,
  switchTab, setPresenceSubFn, setChannelClearFns
} from './auth.js';
import {
  subPresence, clearPresenceCh, renderContacts,
  updateChatStatus, onVisibility,
  onOnline, onOffline, closeMobile
} from './presence.js';
import {
  openChat, doSend, flushOfflineQueue, bcastTyping,
  onInput, onKey, clearMsgCh, initScrollPagination,
  clearReply, resubMessages, jumpToBottom
} from './messages.js';
import { doExport } from './export.js';
import { toggleTheme, initTheme, tpwd, toggleEmoji } from './ui.js';

/* ── Break circular deps by injecting callbacks ── */
setPresenceSubFn(subPresence);
setChannelClearFns(clearPresenceCh, clearMsgCh);

/* ── Globals needed by presence.js / app lifecycle ── */
window.openChat          = openChat;
window.updateChatStatus  = updateChatStatus;   // called by presence.js on every presence event
window.flushOfflineQueue = flushOfflineQueue;
window.bcastTyping       = bcastTyping;
window.resubMessages     = resubMessages; // called by presence.onOnline

/* ═══════════════════════════════════════════════════════════
   DOM-READY — bind every event listener
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  initTheme();

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

  /* ── Boot retry button ── */
  document.getElementById('boot-retry-btn')?.addEventListener('click', boot);

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

  /* ── Jump-to-bottom FAB ── */
  document.getElementById('jump-btn')?.addEventListener('click', jumpToBottom);

  /* ── Dropdowns ── */
  const toggleDropdown = (id) => {
    document.querySelectorAll('.dropdown.show').forEach(d => {
      if (d.id !== id) d.classList.remove('show');
    });
    document.getElementById(id)?.classList.toggle('show');
  };
  document.getElementById('sb-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('sb-dropdown');
  });
  document.getElementById('ct-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('ct-dropdown');
  });

  // Close dropdowns on outside click or when clicking a menu item
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown') || e.target.closest('.dropdown-item')) {
      document.querySelectorAll('.dropdown.show').forEach(d => d.classList.remove('show'));
    }
  });

  /* ── Reply bar close ── */
  document.getElementById('reply-close')?.addEventListener('click', clearReply);

  /* ── Message input ── */
  const inp = document.getElementById('msg-inp');
  if (inp) {
    inp.addEventListener('input', onInput);
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

  /* ── Scroll pagination + Jump FAB ── */
  initScrollPagination();

  /* ── Capacitor / Visual Viewport (keyboard avoidance) ── */
  if (window.Capacitor?.Plugins?.Keyboard) {
    const Keyboard = window.Capacitor.Plugins.Keyboard;
    Keyboard.addListener('keyboardWillShow', info => {
      if (window.Capacitor.getPlatform() === 'android') return;
      const pane = document.getElementById('chat-pane');
      if (pane) pane.style.setProperty('--kb-height', info.keyboardHeight + 'px');
      import('./ui.js').then(({ scrollBottom }) => scrollBottom(false));
    });
    Keyboard.addListener('keyboardWillHide', () => {
      if (window.Capacitor.getPlatform() === 'android') return;
      const pane = document.getElementById('chat-pane');
      if (pane) pane.style.removeProperty('--kb-height');
    });
  } else if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const chatPane = document.getElementById('chat-pane');
      if (!chatPane) return;
      const chatUI = document.getElementById('chat-ui');
      if (!chatUI || chatUI.style.display === 'none') {
        chatPane.style.removeProperty('--kb-height');
        return;
      }
      const vv = window.visualViewport;
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      if (offset > 0) {
        chatPane.style.setProperty('--kb-height', offset + 'px');
        import('./ui.js').then(({ scrollBottom }) => scrollBottom(false));
      } else {
        chatPane.style.removeProperty('--kb-height');
      }
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
      App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          // App backgrounded — mark as away immediately
          import('./presence.js').then(p => {
             if (p.onVisibility) p.onVisibility('away');
          });
        } else {
          // App returned to foreground — flush queue + recover channels
          if (window.flushOfflineQueue) window.flushOfflineQueue();
          if (navigator.onLine) {
            import('./presence.js').then(p => p.onVisibility());
            if (window.resubMessages) window.resubMessages();
          }
        }
      });
    }
    if (StatusBar) {
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => { });
      StatusBar.setStyle({ style: 'DARK' }).catch(() => { });
    }
  }

  /* ── Network events ── */
  window.addEventListener('online',  onOnline);
  window.addEventListener('offline', onOffline);

  /* ── Visibility (away/online presence) ── */
  document.addEventListener('visibilitychange', onVisibility);

  /* ── Boot ── */
  boot();
});
