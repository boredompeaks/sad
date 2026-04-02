'use strict';
import { PRESENCE_HEARTBEAT, PRESENCE_LEAVE_DEBOUNCE } from './config.js';
import { S }                  from './state.js';
import { toast, timeAgo }     from './ui.js';

let _presenceCh = null;

/* ═══════════════════════════════════════════════════════════
   SUBSCRIBE
═══════════════════════════════════════════════════════════ */
export function subPresence() {
  if (_presenceCh) { try { _presenceCh.unsubscribe(); } catch (_) { } }

  const me = 'slot_' + S.me.slot;
  _presenceCh = S.sb.channel('presence', { config: { presence: { key: me } } });

  _presenceCh
    .on('presence', { event: 'sync' }, () => {
      const state = _presenceCh.presenceState();
      S.presenceMap = {};
      Object.entries(state).forEach(([key, presences]) => {
        const p = presences[0] || {};
        const slot = parseInt(key.split('_')[1], 10);
        S.presenceMap[slot] = { _status: p.status || 'online', _lastSeen: p.lastSeen || null };
      });
      renderContacts();
      if (window.updateChatStatus) window.updateChatStatus();
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const slot = parseInt(key.split('_')[1], 10);
      const p = newPresences[0] || {};
      if (S.presenceLeaveT[slot]) { clearTimeout(S.presenceLeaveT[slot]); delete S.presenceLeaveT[slot]; }
      S.presenceMap[slot] = { _status: p.status || 'online', _lastSeen: null };
      renderContacts();
      if (window.updateChatStatus) window.updateChatStatus();
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      const slot = parseInt(key.split('_')[1], 10);
      S.presenceLeaveT[slot] = setTimeout(() => {
        if (S.presenceMap[slot]) S.presenceMap[slot]._status = 'offline';
        delete S.presenceLeaveT[slot];
        renderContacts();
        if (window.updateChatStatus) window.updateChatStatus();
      }, PRESENCE_LEAVE_DEBOUNCE);
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') await _trackPresence();
    });

  // Heartbeat — update lastSeen and re-broadcast
  clearInterval(S.presenceHB);
  S.presenceHB = setInterval(() => _trackPresence(), PRESENCE_HEARTBEAT);
}

async function _trackPresence() {
  if (!_presenceCh || !S.me) return;
  try {
    await _presenceCh.track({
      status:   document.hidden ? 'away' : 'online',
      lastSeen: Date.now(),
    });
  } catch (e) { console.warn('[presence] track failed:', e); }
}

/** Called by doLogout via injected callback */
export function clearPresenceCh() {
  if (_presenceCh) { try { _presenceCh.unsubscribe(); } catch (_) { } _presenceCh = null; }
  clearInterval(S.presenceHB);
}

/* ═══════════════════════════════════════════════════════════
   CONTACTS RENDER
═══════════════════════════════════════════════════════════ */
export async function renderContacts() {
  const el = document.getElementById('contacts');
  if (!el || !S.me) return;

  // Use cached peer record to avoid a DB hit on every presence event
  let dbUser = S.peerCache;
  if (!dbUser) {
    try {
      const otherSlot = S.me.slot === 1 ? 2 : 1;
      const { data, error } = await S.sb.from('cipher_users')
        .select('slot,display_name,color')
        .eq('slot', otherSlot)
        .single();
      if (!error && data) { S.peerCache = data; dbUser = data; }
    } catch (e) { console.warn('[renderContacts] fetch failed:', e); }
  }

  if (!dbUser) {
    el.innerHTML = '';
    const d  = document.createElement('div'); d.className = 'empty-c';
    const ei = document.createElement('div'); ei.className = 'ei'; ei.textContent = '📡';
    const p  = document.createElement('p');   p.textContent = 'Waiting for the other user to register…';
    d.appendChild(ei); d.appendChild(p); el.appendChild(d);
    return;
  }

  const ps     = S.presenceMap[dbUser.slot];
  const status = ps ? ps._status : 'offline';
  const lastSeen = ps?._lastSeen;

  el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'c-row' + (S.peer?.slot === dbUser.slot ? ' active' : '');

  const avW = document.createElement('div'); avW.className = 'c-av';
  const av  = document.createElement('div');
  av.className = 'av av38';
  av.style.background = dbUser.color || '#c9963a';
  av.textContent = (dbUser.display_name || '?')[0].toUpperCase();
  const pip = document.createElement('div');
  pip.className = 'ppip ' + (status === 'online' ? 'online' : status === 'away' ? 'away' : '');
  avW.appendChild(av); avW.appendChild(pip);

  const inf = document.createElement('div'); inf.className = 'c-inf';
  const cn  = document.createElement('div'); cn.className = 'c-n';
  cn.textContent = dbUser.display_name; // textContent — XSS safe
  const cs  = document.createElement('div'); cs.className = 'c-s';
  cs.textContent =
    status === 'online' ? '🟢 Active now' :
    status === 'away'   ? '🌙 Away' :
    lastSeen            ? '⚫ Last seen ' + timeAgo(lastSeen) : '⚫ Offline';
  inf.appendChild(cn); inf.appendChild(cs);
  row.appendChild(avW); row.appendChild(inf);

  // openChat is exposed as window.openChat by app.js to avoid circular import
  row.addEventListener('click', () => {
    window.Capacitor?.Plugins?.Haptics?.impact({ style: 'LIGHT' }).catch(()=>{});
    window.openChat?.({ slot: dbUser.slot, name: dbUser.display_name, color: dbUser.color });
  });
  el.appendChild(row);
}

/* ═══════════════════════════════════════════════════════════
   PRESENCE STATUS IN CHAT HEADER
═══════════════════════════════════════════════════════════ */
export function updateChatStatus() {
  if (!S.peer) return;
  const p      = S.presenceMap[S.peer.slot];
  const el     = document.getElementById('ct-status-el');
  const pip    = document.getElementById('ct-pip');
  const status = document.hidden ? 'away' : (p ? p._status : 'offline');
  if (status === 'online') {
    if (el)  { el.textContent = 'Active now'; el.className = 'ct-s online'; }
    if (pip) pip.className = 'ppip online';
  } else if (status === 'away') {
    if (el)  { el.textContent = 'Away'; el.className = 'ct-s away'; }
    if (pip) pip.className = 'ppip away';
  } else {
    const ls = p?._lastSeen;
    if (el)  { el.textContent = ls ? 'Last seen ' + timeAgo(ls) : 'Offline'; el.className = 'ct-s'; }
    if (pip) pip.className = 'ppip';
  }
}

/* ═══════════════════════════════════════════════════════════
   VISIBILITY / ONLINE / OFFLINE HANDLERS
═══════════════════════════════════════════════════════════ */
export function onVisibility() { if (S.me) _trackPresence(); }
export function onOnline() {
  document.getElementById('offline-bar')?.classList.remove('show');
  if (S.me) subPresence();
  if (window.flushOfflineQueue) window.flushOfflineQueue();
}
export function onOffline() {
  document.getElementById('offline-bar')?.classList.add('show');
}

/* ═══════════════════════════════════════════════════════════
   MOBILE BACK
═══════════════════════════════════════════════════════════ */
export function closeMobile() {
  if (window.bcastTyping) window.bcastTyping(false);
  document.getElementById('s-app')?.classList.remove('mobile-chat-active');
}
