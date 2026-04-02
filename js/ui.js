'use strict';
import { AV_COLORS, EMOJIS } from './config.js';
import { LS_THEME }          from './constants.js';
import { S } from './state.js';

/* ═══════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════ */
let _toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ═══════════════════════════════════════════════════════════
   OVERLAY
═══════════════════════════════════════════════════════════ */
export function showOverlay(txt) {
  const el = document.getElementById('ov-txt');
  if (el) el.textContent = txt || 'Please wait…';
  document.getElementById('overlay')?.classList.add('show');
}
export function hideOverlay() {
  document.getElementById('overlay')?.classList.remove('show');
}

/* ═══════════════════════════════════════════════════════════
   SCREEN SWITCHER
═══════════════════════════════════════════════════════════ */
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + name)?.classList.add('active');
}

/* ═══════════════════════════════════════════════════════════
   DECRYPT PROGRESS BAR
═══════════════════════════════════════════════════════════ */
export function showDecryptProg(on, lbl, pct) {
  const el = document.getElementById('decrypt-prog');
  if (!el) return;
  el.classList.toggle('show', on);
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

/* ═══════════════════════════════════════════════════════════
   BUTTON HELPERS
═══════════════════════════════════════════════════════════ */
export function btnLoad(btn, on, label) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  const lbl = btn.querySelector('.btn-lbl');
  if (lbl) lbl.textContent = on ? '…' : label;
}

/* ═══════════════════════════════════════════════════════════
   TEXTAREA AUTO-RESIZE
═══════════════════════════════════════════════════════════ */
export function resizeTA(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 110) + 'px';
}

/* ═══════════════════════════════════════════════════════════
   SCROLL TO BOTTOM
═══════════════════════════════════════════════════════════ */
export function scrollBottom(onlyIfNear = false) {
  const a = document.getElementById('msgs');
  if (!a) return;
  requestAnimationFrame(() => {
    if (onlyIfNear) {
      const dist = a.scrollHeight - a.scrollTop - a.clientHeight;
      if (dist > 120) return;
    }
    a.scrollTop = a.scrollHeight;
  });
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
      const icon = S.theme === 'light' ? '☀️' : '🌙';
      document.querySelectorAll('#theme-btn, #chat-theme-btn').forEach(b => { b.textContent = icon; });
    }
  } catch (_) { /* ignore cross-origin localStorage errors if any */ }
}

export function toggleTheme() {
  S.theme = S.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = S.theme === 'light' ? 'light' : '';
  const icon = S.theme === 'light' ? '☀️' : '🌙';
  document.querySelectorAll('#theme-btn, #chat-theme-btn').forEach(b => { b.textContent = icon; });
  try { localStorage.setItem(LS_THEME, S.theme); } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════
   PASSWORD VISIBILITY TOGGLE
═══════════════════════════════════════════════════════════ */
export function tpwd(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

/* ═══════════════════════════════════════════════════════════
   AVATAR ROW
═══════════════════════════════════════════════════════════ */
export function buildAvRow() {
  const row = document.getElementById('av-row');
  if (!row) return;
  AV_COLORS.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'av-dot' + (i === 0 ? ' on' : '');
    d.style.background = c;
    d.addEventListener('click', () => {
      row.querySelectorAll('.av-dot').forEach(x => x.classList.remove('on'));
      d.classList.add('on');
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
  EMOJIS.forEach(e => {
    const s = document.createElement('span');
    s.className = 'ep-e';
    s.textContent = e;
    s.addEventListener('click', () => { insertEmoji(e); toggleEmoji(true); });
    p.appendChild(s);
  });
}
export function toggleEmoji(close) {
  const p = document.getElementById('em-pick');
  if (!p) return;
  p.classList.toggle('show', close ? false : !p.classList.contains('show'));
}
export function insertEmoji(e) {
  const inp = document.getElementById('msg-inp');
  if (!inp) return;
  inp.value += e;
  inp.focus();
  inp.dispatchEvent(new Event('input')); // keep send-button state in sync
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
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
export function fmtExportDate(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}
export function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
