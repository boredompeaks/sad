'use strict';
import { createClient }                          from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SB_URL, SB_KEY, PBKDF2_ITER, RL_GRACE, RL_SCHED } from './config.js';
import { SALT_PREFIX }                              from './constants.js';
import { S }                                      from './state.js';
import { wCall, initWorker }                      from './crypto.js';
import { toast, showOverlay, hideOverlay,
         showScreen, btnLoad,
         buildAvRow, buildEmojiPicker, delay }    from './ui.js';
import { clearCache }                             from './db.js';

/* ═══════════════════════════════════════════════════════════
   SANITIZE / VALIDATE
═══════════════════════════════════════════════════════════ */
export const sanitizeName = s =>
  String(s).replace(/[<>"'`\\;{}()[\]\x00-\x1f]/g, '').trim().slice(0, 24);
export const sanitizePass = s =>
  String(s).replace(/[^\x20-\x7e]/g, '').slice(0, 128);
export const validateName = n => {
  if (!n || n.length < 2) return 'Name must be at least 2 characters';
  if (!/^[a-zA-Z0-9 '_\-.]+$/.test(n)) return 'Name contains invalid characters';
  return null;
};
export const validatePass   = p => (!p || p.length < 8)  ? 'Password must be at least 8 characters'   : null;
export const validatePhrase = p => (!p || p.length < 6)  ? 'Passphrase must be at least 6 characters' : null;

/* ═══════════════════════════════════════════════════════════
   FIELD ERROR HELPERS
═══════════════════════════════════════════════════════════ */
export function fe(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
  const inp = el.closest('.fl')?.querySelector('input');
  if (inp) inp.classList.toggle('err', !!msg);
}
export function clearFE(...ids) { ids.forEach(i => fe(i, '')); }

/* ═══════════════════════════════════════════════════════════
   RATE LIMITER
═══════════════════════════════════════════════════════════ */
export function rlCheck() {
  if (S.rl.locked && Date.now() < S.rl.until) return false;
  if (S.rl.locked) { S.rl.locked = false; document.getElementById('rl-msg')?.classList.remove('show'); }
  return true;
}
export function rlFail() {
  S.rl.attempts++;
  if (S.rl.attempts <= RL_GRACE) return;
  const idx = Math.min(S.rl.attempts - RL_GRACE - 1, RL_SCHED.length - 1);
  S.rl.locked = true;
  S.rl.until  = Date.now() + RL_SCHED[idx];
  _rlTick();
}
function _rlTick() {
  const el  = document.getElementById('rl-msg');
  const btn = document.getElementById('btn-in');
  clearInterval(S.rl.timer);
  if (btn) btn.disabled = true;
  S.rl.timer = setInterval(() => {
    const rem = Math.ceil((S.rl.until - Date.now()) / 1000);
    if (rem <= 0) {
      el?.classList.remove('show');
      if (btn) btn.disabled = false;
      clearInterval(S.rl.timer);
      return;
    }
    el?.classList.add('show');
    if (el) el.textContent = `Too many attempts — wait ${rem}s`;
  }, 1000);
}
export function rlReset() {
  S.rl.attempts = 0; S.rl.locked = false;
  clearInterval(S.rl.timer);
  document.getElementById('rl-msg')?.classList.remove('show');
  const btn = document.getElementById('btn-in');
  if (btn) btn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
export async function getSlotCount() {
  const { data, error } = await S.sb.from('cipher_users').select('slot');
  if (error) throw error;
  return (data || []).length;
}
export function updateAuthUI(count) {
  document.getElementById('ac-slots')?.setAttribute('data-slots', count);
  const badge = document.getElementById('ac-slots');
  if (badge) badge.textContent = count + '/2 registered';
  const tabUp   = document.getElementById('tab-up');
  const regFull = document.getElementById('reg-full');
  if (count >= 2) {
    if (tabUp)   tabUp.style.display   = 'none';
    if (regFull) regFull.style.display = 'block';
    switchTab('in');
  } else {
    if (tabUp)   tabUp.style.display   = '';
    if (regFull) regFull.style.display = 'none';
  }
}
export function switchTab(t) {
  document.getElementById('f-in')?.setAttribute('style', t === 'in' ? '' : 'display:none');
  document.getElementById('f-up')?.setAttribute('style', t === 'up' ? '' : 'display:none');
  document.getElementById('tab-in')?.classList.toggle('on', t === 'in');
  document.getElementById('tab-up')?.classList.toggle('on', t === 'up');
}

/* ═══════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════ */
export async function boot() {
  initWorker();
  _setBootProg(20, 'connecting…');
  try {
    S.sb = createClient(SB_URL, SB_KEY);
    _setBootProg(55, 'checking accounts…');
    const count = await getSlotCount();
    _setBootProg(100, 'ready');
    await delay(300);
    buildAvRow();
    buildEmojiPicker();
    updateAuthUI(count);
    showScreen('auth');
  } catch (e) {
    _setBootProg(100, 'connection failed');
    toast('Could not connect — check your config');
    console.error('[boot]', e);
  }
}
function _setBootProg(p, lbl) {
  const b = document.getElementById('boot-prog');
  const l = document.getElementById('boot-lbl');
  if (b) b.style.width = p + '%';
  if (l) l.textContent = lbl;
}

/* ═══════════════════════════════════════════════════════════
   INIT APP (after login/register)
   presenceSubFn is injected by app.js at startup to break
   the auth ↔ presence circular dependency.
═══════════════════════════════════════════════════════════ */
let _presenceSubFn = null;
export function setPresenceSubFn(fn) { _presenceSubFn = fn; }

export async function initApp() {
  const myAv = document.getElementById('my-av');
  if (myAv) {
    myAv.textContent = S.me.name[0].toUpperCase();
    myAv.style.background = S.me.color;
  }
  const mn = document.getElementById('my-name-el');
  if (mn) mn.textContent = S.me.name; // textContent — XSS safe
  showScreen('app');
  if (_presenceSubFn) _presenceSubFn();
}

/* ═══════════════════════════════════════════════════════════
   REGISTRATION
═══════════════════════════════════════════════════════════ */
export async function doRegister() {
  clearFE('e-rn', 'e-rp', 'e-rph');
  const name   = sanitizeName(document.getElementById('rn').value);
  const pass   = sanitizePass(document.getElementById('rp').value);
  const phrase = sanitizePass(document.getElementById('rph').value);
  const nameErr   = validateName(name);
  const passErr   = validatePass(pass);
  const phraseErr = validatePhrase(phrase);
  if (nameErr)   { fe('e-rn',  nameErr);   return; }
  if (passErr)   { fe('e-rp',  passErr);   return; }
  if (phraseErr) { fe('e-rph', phraseErr); return; }

  const btn = document.getElementById('btn-up');
  btnLoad(btn, true, 'Creating…');
  showOverlay('Creating your account…');
  try {
    const { data: ex, error: exErr } = await S.sb.from('cipher_users').select('slot');
    if (exErr) throw exErr;
    const used = (ex || []).map(r => r.slot);
    if (used.length >= 2) { toast('Registration is full'); updateAuthUI(2); return; }
    const slot = used.includes(1) ? 2 : 1;

    const { result: pHash } = await wCall({ type: 'HASH_PW', password: pass, iters: PBKDF2_ITER });
    if (!pHash) throw new Error('Password hashing failed');

    // Fetch or create shared passphrase salt
    let passphraseSalt = null;
    try {
      const { data: cfg } = await S.sb
        .from('cipher_config').select('passphrase_salt').eq('id', 1).single();
      passphraseSalt = cfg?.passphrase_salt || null;
    } catch (_) { /* table missing or no row yet */ }

    if (!passphraseSalt) {
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      passphraseSalt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const { error: cfgErr } = await S.sb
        .from('cipher_config').upsert({ id: 1, passphrase_salt: passphraseSalt });
      if (cfgErr) {
        console.error('cipher_config upsert failed:', cfgErr);
        toast('⚠️ Could not save encryption config — registration aborted');
        return; // ABORT: proceeding without a persisted salt creates an unusable account
      }
    }

    const { error: ie } = await S.sb.from('cipher_users').insert({
      slot, display_name: name, password_hash: pHash, color: S.selectedColor,
    });
    if (ie) {
      if (ie.code === '23505') { toast('Slot taken — please try again'); return; }
      throw ie;
    }

    showOverlay('Securing your session…');
    const keyResp = await wCall({ type: 'DERIVE_KEY', passphrase: phrase, salt: SALT_PREFIX + passphraseSalt, iters: PBKDF2_ITER });
    if (!keyResp) throw new Error('Key derivation returned empty response');
    S.me = { slot, name, color: S.selectedColor };
    S.isDecoy = false;
    updateAuthUI(used.length + 1);
    toast(`Welcome, ${name}!`);
    await initApp();
  } catch (e) {
    toast('Registration failed — please try again');
    console.error('[doRegister]', e);
  } finally { btnLoad(btn, false, 'Create Account →'); hideOverlay(); }
}

/* ═══════════════════════════════════════════════════════════
   LOGIN
═══════════════════════════════════════════════════════════ */
export async function doLogin() {
  clearFE('e-lp', 'e-lph');
  if (!rlCheck()) return;
  const pass   = sanitizePass(document.getElementById('lp').value);
  const phrase = sanitizePass(document.getElementById('lph').value);
  if (!pass)   { fe('e-lp',  'Password is required');   return; }
  if (!phrase) { fe('e-lph', 'Passphrase is required'); return; }

  const btn = document.getElementById('btn-in');
  btnLoad(btn, true, 'Signing in…');
  showOverlay('Verifying your credentials…');
  try {
    const { data: users, error } = await S.sb
      .from('cipher_users').select('slot,display_name,color,password_hash');
    if (error) throw error;
    if (!users?.length) { fe('e-lp', 'No accounts registered yet'); rlFail(); return; }

    let matched = null;
    for (const u of users) {
      if (!u.password_hash) continue;
      const { ok } = await wCall({ type: 'VERIFY_PW', password: pass, stored: u.password_hash });
      if (ok) { matched = u; break; }
    }
    if (!matched) { fe('e-lp', 'Incorrect password — please check and try again'); rlFail(); return; }

    rlReset();
    showOverlay('Securing your session…');

    // Fetch shared passphrase salt — MUST match the salt stored during registration
    let passphraseSalt = null;
    try {
      const { data: cfg } = await S.sb
        .from('cipher_config').select('passphrase_salt').eq('id', 1).single();
      passphraseSalt = cfg?.passphrase_salt || null;
    } catch (_) { }

    if (!passphraseSalt) {
      fe('e-lph', 'Encryption config not found — the other user must register first');
      rlFail();
      return;
    }

    const keyResp = await wCall({ type: 'DERIVE_KEY', passphrase: phrase, salt: SALT_PREFIX + passphraseSalt, iters: PBKDF2_ITER });
    if (!keyResp) throw new Error('Key derivation returned empty response');
    S.me = { slot: matched.slot, name: matched.display_name, color: matched.color };
    S.isDecoy = false;
    await initApp();
  } catch (e) {
    toast('Sign in failed — please try again');
    console.error('[doLogin]', e);
  } finally { btnLoad(btn, false, 'Sign In →'); hideOverlay(); }
}

/* ═══════════════════════════════════════════════════════════
   LOGOUT
═══════════════════════════════════════════════════════════ */
let _presenceClearFn = null;
let _msgClearFn      = null;
export function setChannelClearFns(presenceFn, msgFn) {
  _presenceClearFn = presenceFn;
  _msgClearFn      = msgFn;
}

export function doLogout() {
  // Guard — prevent accidental data loss
  if (!window.confirm('Sign out? Your local message cache will be cleared.')) return;

  // 1 — Cancel timers
  clearTimeout(S.typingTimer);
  clearTimeout(S.typingAutoHide);
  clearInterval(S.presenceHB);
  clearInterval(S.rl.timer);

  // 2 — Erase AES key from worker first
  try { wCall({ type: 'CLEAR_KEY' }).catch(e => console.warn('[logout] CLEAR_KEY:', e)); } catch (_) { }

  // 3 — Unsubscribe channels (fns injected by presence.js / messages.js)
  if (_presenceClearFn) try { _presenceClearFn(); } catch (_) { }
  if (_msgClearFn)      try { _msgClearFn();      } catch (_) { }

  // 4 — Reset state (preserve theme + rl)
  const savedTheme = S.theme;
  S.me = null; S.peer = null; S.peerCache = null;
  S.isDecoy = false;
  S.presenceMap = {};
  S.renderedIds = new Set();
  S.messages = [];
  S.pendingTexts = new Map();
  S.oldestCursor = null; S.hasMore = false;
  S.msgQueue = []; S.historyLoading = false;
  S.isTyping = false; S.typingTimer = null;
  S.typingThrottle = null; S.typingAutoHide = null;
  S.replyTo = null;
  S.presenceHB = null; S.presenceLeaveT = {};
  S.chatToken = 0; S.sendInflight = false;
  S.offlineQueue = [];
  S.theme = savedTheme;
  // S.rl intentionally kept (lock persists across sessions)

  // 5 — Clear IndexedDB cache
  clearCache().catch(() => {});

  // 6 — Clear inputs
  ['rn', 'rp', 'rph', 'lp', 'lph'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  clearFE('e-rn', 'e-rp', 'e-rph', 'e-lp', 'e-lph');

  // 7 — Back to auth screen
  getSlotCount()
    .then(c => { updateAuthUI(c); showScreen('auth'); })
    .catch(() => showScreen('auth'));
}
