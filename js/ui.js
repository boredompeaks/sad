'use strict';
import { AV_COLORS, EMOJIS } from './config.js';
import { LS_THEME }          from './constants.js';
import { S } from './state.js';

/* ═══════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════ */
let _toastTimer;
export function toast(msg, durationMs = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  el.style.cssText = 'position:fixed; bottom:calc(32px + var(--sab)); left:50%; transform:translateX(-50%); background:rgba(10,15,30,0.92); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); border:1px solid rgba(255,255,255,0.08); color:var(--t0); padding:14px 28px; border-radius:50px; font-size:14px; font-weight:600; opacity:0; transition:all .4s var(--spring); z-index:9999; box-shadow:var(--shadow);';
  
  requestAnimationFrame(() => el.style.opacity = '1');
  
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.classList.remove('show'), 400);
  }, durationMs);
}

/* ═══════════════════════════════════════════════════════════
   BOTTOM-SHEET CONTEXT MENU
═══════════════════════════════════════════════════════════ */
let _ctxBackdropHandler = null;

export function showContextMenu(items) {
  dismissContextMenu();

  const backdrop = document.createElement('div');
  backdrop.id = 'ctx-backdrop';
  backdrop.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.65); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); z-index:2000; opacity:0; transition:opacity 0.4s var(--ease);';

  const sheet = document.createElement('div');
  sheet.id = 'ctx-sheet';
  sheet.style.cssText = 'position:fixed; bottom:0; left:0; right:0; background:rgba(10,15,30,0.96); backdrop-filter:blur(32px); -webkit-backdrop-filter:blur(32px); border-top:1px solid rgba(255,255,255,0.06); border-radius:28px 28px 0 0; padding:16px 20px calc(28px + var(--sab)); z-index:2001; transform:translateY(100%); transition:transform 0.5s var(--spring); box-shadow:0 -12px 48px rgba(0,0,0,0.5);';

  const handle = document.createElement('div');
  handle.style.cssText = 'width:36px; height:4px; background:rgba(255,255,255,0.1); border-radius:3px; margin:0 auto 20px;';
  sheet.appendChild(handle);

  items.forEach(item => {
    if (!item) return;
    const btn = document.createElement('button');
    btn.style.cssText = 'width:100%; padding:15px 20px; display:flex; align-items:center; gap:14px; font-size:15px; font-weight:600; border-radius:16px; margin-bottom:4px; transition:all 0.2s var(--ease); color:' + (item.danger ? 'var(--red)' : 'var(--t1)') + '; background:rgba(255,255,255,0.02);';
    
    if (item.icon) {
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', item.icon);
      icon.style.width = '22px';
      btn.appendChild(icon);
    }
    const lbl = document.createElement('span');
    lbl.textContent = item.label || '';
    btn.appendChild(lbl);
    
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.color = 'var(--t0)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.02)'; btn.style.color = item.danger ? 'var(--red)' : 'var(--t1)'; });
    
    btn.addEventListener('click', () => {
      dismissContextMenu();
      try { item.action?.(); } catch (e) { console.error('[ctx-menu] error:', e); }
    });
    sheet.appendChild(btn);
  });

  _ctxBackdropHandler = () => dismissContextMenu();
  backdrop.addEventListener('click', _ctxBackdropHandler);

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  if (window.lucide) window.lucide.createIcons({ node: sheet });

  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  });
}

export function dismissContextMenu() {
  const backdrop = document.getElementById('ctx-backdrop');
  const sheet    = document.getElementById('ctx-sheet');
  if (backdrop) {
    backdrop.style.opacity = '0';
    setTimeout(() => backdrop.remove(), 400);
  }
  if (sheet) {
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => sheet.remove(), 500);
  }
  _ctxBackdropHandler = null;
}

/* ═══════════════════════════════════════════════════════════
   REACTION PICKER
═══════════════════════════════════════════════════════════ */
const REACTION_EMOJIS = ['❤️','😂','😮','😢','😡','👍','👎','🔥','💀','🫡'];

export function showReactionPicker(anchorEl, onPick) {
  dismissReactionPicker();

  const wrap = document.createElement('div');
  wrap.id = 'reaction-pick';
  wrap.style.cssText = 'position:fixed; display:flex; gap:6px; padding:8px 10px; background:rgba(10,15,30,0.90); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.08); border-radius:40px; box-shadow:var(--shadow); z-index:1500; opacity:0; transform:scale(0.8) translateY(10px); transition:all 0.3s var(--spring);';

  REACTION_EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.textContent = e;
    btn.style.cssText = 'font-size:22px; width:38px; height:38px; border-radius:50%; transition:all 0.2s var(--ease); display:flex; align-items:center; justify-content:center;';
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.4) translateY(-4px)'; btn.style.background = 'rgba(255,255,255,0.1)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; btn.style.background = 'transparent'; });
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      dismissReactionPicker();
      try { onPick(e); } catch (err) { console.error('[reaction-pick]', err); }
    });
    wrap.appendChild(btn);
  });

  document.body.appendChild(wrap);
  try {
    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    let left = rect.left;
    if (left + 360 > vw) left = vw - 370;
    if (left < 10) left = 10;
    const top = Math.max(rect.top - 60, 10);
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
  } catch (_) {}

  requestAnimationFrame(() => {
    wrap.style.opacity = '1';
    wrap.style.transform = 'scale(1) translateY(0)';
  });

  const outside = e => {
    if (!wrap.contains(e.target)) {
      dismissReactionPicker();
      document.removeEventListener('click', outside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', outside, true), 10);
}

export function dismissReactionPicker() {
  const el = document.getElementById('reaction-pick');
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'scale(0.8) translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }
}

/* ═══════════════════════════════════════════════════════════
   JUMP-TO-BOTTOM FAB
═══════════════════════════════════════════════════════════ */
export function showJumpToBottom(visible) {
  const el = document.getElementById('jump-btn');
  if (!el) return;
  el.style.display = visible ? 'flex' : 'none';
  if (visible) {
    el.style.animation = 'msgSlide 0.4s var(--spring) both';
  }
}

/* ═══════════════════════════════════════════════════════════
   SCREEN SWITCHER
═══════════════════════════════════════════════════════════ */
export function showScreen(name) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(s => {
      s.classList.remove('active');
      s.style.pointerEvents = 'none';
  });
  const next = document.getElementById('s-' + name);
  if (next) {
    next.classList.add('active');
    next.style.pointerEvents = 'all';
    if (window.lucide) window.lucide.createIcons();
  }
}

/* ═══════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════ */
export function btnLoad(btn, on, label) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  const lbl = btn.querySelector('.btn-lbl');
  if (lbl) lbl.textContent = on ? 'STABILIZING…' : label;
}

export function resizeTA(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

export function scrollBottom(onlyIfNear = false) {
  const a = document.getElementById('msgs');
  if (!a) return;
  requestAnimationFrame(() => {
    if (onlyIfNear) {
      const dist = a.scrollHeight - a.scrollTop - a.clientHeight;
      if (dist > 150) return;
    }
    a.scrollTo({ top: a.scrollHeight, behavior: 'smooth' });
  });
}

export function haptic(style = 'LIGHT') {
  window.Capacitor?.Plugins?.Haptics?.impact({ style }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════
   THEME TOGGLE
═══════════════════════════════════════════════════════════ */
export function initTheme() {
  try {
    const saved = localStorage.getItem(LS_THEME);
    if (saved === 'light' || saved === 'dark') {
      S.theme = saved;
      document.documentElement.dataset.theme = S.theme === 'light' ? 'light' : '';
      updateThemeIcons();
    }
  } catch (_) {}
}

export function toggleTheme() {
  haptic('MEDIUM');
  S.theme = S.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = S.theme === 'light' ? 'light' : '';
  updateThemeIcons();
  try { localStorage.setItem(LS_THEME, S.theme); } catch (_) {}
}

function updateThemeIcons() {
    const isLight = S.theme === 'light';
    const iconName = isLight ? 'sun' : 'moon';
    document.querySelectorAll('#theme-btn, #chat-theme-btn').forEach(b => {
        b.innerHTML = `<i data-lucide="${iconName}" style="width:18px;"></i>`;
    });
    if (window.lucide) window.lucide.createIcons();
}

/* ═══════════════════════════════════════════════════════════
   PASSWORD VISIBILITY TOGGLE
═══════════════════════════════════════════════════════════ */
export function tpwd(inputId, btn) {
  haptic('LIGHT');
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  btn.innerHTML = `<i data-lucide="${isHidden ? 'eye-off' : 'eye'}" style="width:18px;"></i>`;
  if (window.lucide) window.lucide.createIcons();
}

/* ═══════════════════════════════════════════════════════════
   AVATAR ROW
═══════════════════════════════════════════════════════════ */
export function buildAvRow() {
  const row = document.getElementById('av-row');
  if (!row) return;
  row.innerHTML = '';
  AV_COLORS.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'av-dot' + (i === 0 ? ' on' : '');
    d.style.cssText = `width:36px; height:36px; border-radius:12px; cursor:pointer; border:2px solid transparent; transition:all 0.3s var(--ease); background:${c}; box-shadow:0 4px 12px rgba(0,0,0,0.2);`;
    if (i === 0) { d.style.borderColor = 'var(--a)'; d.style.transform = 'scale(1.1)'; }
    d.addEventListener('click', () => {
      haptic('LIGHT');
      row.querySelectorAll('.av-dot').forEach(x => {
          x.classList.remove('on');
          x.style.borderColor = 'transparent';
          x.style.transform = 'scale(1)';
      });
      d.classList.add('on');
      d.style.borderColor = 'var(--a)';
      d.style.transform = 'scale(1.2)';
      S.selectedColor = c;
    });
    row.appendChild(d);
  });
}

/* ═══════════════════════════════════════════════════════════
   EMOJI PICKER
═══════════════════════════════════════════════════════════ */
export function buildEmojiPicker() {
  const p = document.getElementById('em-pick');
  if (!p) return;
  p.innerHTML = '';
  EMOJIS.forEach(e => {
    const s = document.createElement('span');
    s.textContent = e;
    s.style.cssText = 'font-size:24px; padding:8px; border-radius:12px; cursor:pointer; transition:all 0.1s var(--ease);';
    s.addEventListener('mouseenter', () => { s.style.background = 'rgba(255,255,255,0.1)'; s.style.transform = 'scale(1.2)'; });
    s.addEventListener('mouseleave', () => { s.style.background = 'transparent'; s.style.transform = 'scale(1)'; });
    s.addEventListener('click', () => { haptic('LIGHT'); insertEmoji(e); toggleEmoji(true); });
    p.appendChild(s);
  });
}
export function toggleEmoji(close) {
  const p = document.getElementById('em-pick');
  if (!p) return;
  const isShown = p.style.display === 'flex';
  if (!close && !isShown) haptic('LIGHT');
  p.style.display = close || isShown ? 'none' : 'flex';
}
export function insertEmoji(e) {
  const inp = document.getElementById('msg-inp');
  if (!inp) return;
  inp.value += e;
  inp.focus();
  inp.dispatchEvent(new Event('input'));
}

/* ═══════════════════════════════════════════════════════════
   DATE / TIME HELPERS
═══════════════════════════════════════════════════════════ */
export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}
export function fmtDate(iso) {
  const d = new Date(iso), n = new Date();
  const diff = Math.floor((n - d) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
export function timeAgo(ts) {
  if (!ts) return '';
  const now = new Date();
  const date = new Date(ts);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  const isToday = now.toDateString() === date.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  if (isToday) return `today at ${timeStr}`;
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
export function fmtExportDate(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}
export function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════════════════════
   MISC UI HELPERS
═══════════════════════════════════════════════════════════ */
export function updateConnectionBadge(status) {}
export function updateUnreadBadge(count) {
  const badge = document.getElementById('unread-badge');
  if (badge) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
  try {
    document.title = count > 0 ? `(${count}) Cipher` : 'Cipher';
  } catch (_) {}
}
export function showOverlay(txt) {
  const el = document.getElementById('ov-txt');
  if (el) el.textContent = txt || 'Please wait…';
  document.getElementById('overlay')?.classList.add('show');
}
export function hideOverlay() {
  document.getElementById('overlay')?.classList.remove('show');
}
export function showDecryptProg(on, lbl, pct) {
  const el = document.getElementById('decrypt-prog');
  if (!el) return;
  el.style.display = on ? 'block' : 'none';
  if (on) {
    const lblEl = document.getElementById('dp-lbl');
    if (lblEl) lblEl.textContent = lbl || 'Decrypting…';
    setDecryptProg(pct || 0, '');
  }
}
export function setDecryptProg(pct, lbl) {
  const fill  = document.getElementById('dp-fill');
  const label = document.getElementById('dp-lbl');
  if (fill) fill.style.width = pct + '%';
  if (lbl && label) label.textContent = lbl;
}
export function showBootError(message) {
  const lbl = document.getElementById('boot-lbl');
  if (lbl) lbl.textContent = message || 'Connection failed';
  const retryBtn = document.getElementById('boot-retry-btn');
  if (retryBtn) retryBtn.style.display = 'flex';
  const prog = document.getElementById('boot-prog');
  if (prog) { prog.style.width = '100%'; prog.style.background = 'var(--red)'; }
}
export function hideBootError() {
  document.getElementById('boot-retry-btn')?.style.removeProperty('display');
  const prog = document.getElementById('boot-prog');
  if (prog) prog.style.removeProperty('background');
}
