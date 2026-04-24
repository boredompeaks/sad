'use strict';
import { PRESENCE_HEARTBEAT, PRESENCE_LEAVE_DEBOUNCE, PRESENCE_AWAY_TIMEOUT } from './config.js';
import { SLOT_PREFIX, PRESENCE_CHANNEL }               from './constants.js';
import { S }                  from './state.js';
import { timeAgo, updateConnectionBadge } from './ui.js';

let _presenceCh = null;
let _statusRefreshInterval = null;
const STATUS_REFRESH_MS = 30_000;
let _lastActivity = Date.now();
let _inactivityCheck = null;
const INACTIVITY_CHECK_MS = 15_000;

function _startStatusRefresh() {
  clearInterval(_statusRefreshInterval);
  _statusRefreshInterval = setInterval(() => {
    try { _refreshStatusLabelsInPlace(); } catch (_) {}
  }, STATUS_REFRESH_MS);
}

function _refreshStatusLabelsInPlace() {
  if (!S.peerCache) return; 
  const slot     = S.peerCache.slot;
  const ps       = S.presenceMap[slot];
  const status   = ps?._status || 'offline';
  const lastSeen = ps?._lastSeen ?? null;
  const label    = _formatStatus(status, lastSeen);

  const cs = document.querySelector('#contacts .c-s');
  if (cs && cs.textContent !== label) cs.textContent = label;

  if (S.peer?.slot === slot) {
    const el  = document.getElementById('ct-status-el');
    const pip = document.getElementById('ct-pip');
    if (el && el.textContent !== label) { 
      el.textContent = label; 
      el.className = 'ct-s' + (status === 'online' ? ' online' : status === 'away' ? ' away' : ''); 
    }
    if (pip) {
      const pipClass = 'ppip' + (status === 'online' ? ' online' : status === 'away' ? ' away' : '');
      if (pip.className !== pipClass) pip.className = pipClass;
    }
  }
}

function _onActivity() {
  const now = Date.now();
  const wasAway = (now - _lastActivity) > PRESENCE_AWAY_TIMEOUT;
  _lastActivity = now;
  if (wasAway && !document.hidden) _trackPresence();
}

let _activityListenersBound = false;
function _initActivityTracking() {
  if (!_activityListenersBound) {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => document.addEventListener(e, _onActivity, { passive: true }));
    _activityListenersBound = true;
  }
  
  clearInterval(_inactivityCheck);
  _inactivityCheck = setInterval(() => {
    const isAway = (Date.now() - _lastActivity) > PRESENCE_AWAY_TIMEOUT;
    if (isAway && !document.hidden && _presenceCh) {
      const myState = _presenceCh.presenceState()[SLOT_PREFIX + S.me.slot];
      const currentStatus = myState?.[0]?.status;
      if (currentStatus !== 'away') _trackPresence();
    }
  }, INACTIVITY_CHECK_MS);
}

export function subPresence() {
  if (_presenceCh) { try { _presenceCh.unsubscribe(); } catch (_) { } }
  const me = SLOT_PREFIX + S.me.slot;
  _presenceCh = S.sb.channel(PRESENCE_CHANNEL, { config: { presence: { key: me } } });

  _presenceCh
    .on('presence', { event: 'sync' }, () => {
      try {
        const state = _presenceCh.presenceState();
        let changed = false;
        Object.keys(S.presenceMap).forEach(slotKey => {
          const slot = parseInt(slotKey, 10);
          if (slot === S.me.slot) return;
          const key = SLOT_PREFIX + slot;
          if (!state[key]) {
             if (S.presenceMap[slot]._status !== 'offline') {
               S.presenceMap[slot] = { _status: 'offline', _lastSeen: Date.now() };
               changed = true;
             }
          }
        });
        Object.entries(state).forEach(([key, presences]) => {
          if (!key || !key.includes('_')) return;
          const slot = parseInt(key.split('_')[1], 10);
          if (isNaN(slot)) return;
          const p = (presences && Array.isArray(presences)) ? (presences[0] || {}) : {};
          if (S.presenceLeaveT[slot]) { clearTimeout(S.presenceLeaveT[slot]); delete S.presenceLeaveT[slot]; }
          const existing = S.presenceMap[slot];
          const newStatus = p.status || 'online';
          const wasOnline = existing?._status === 'online' || existing?._status === 'away';
          if (!existing || existing._status !== newStatus) changed = true;
          S.presenceMap[slot] = { _status: newStatus, _lastSeen: wasOnline ? (existing?._lastSeen ?? null) : null };
        });
        if (changed) { renderContacts(); renderMyStatus(); if (window.updateChatStatus) window.updateChatStatus(); }
      } catch (e) { console.error('[presence.sync]', e); }
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      try {
        if (!key || !key.includes('_')) return;
        const slot = parseInt(key.split('_')[1], 10);
        if (isNaN(slot)) return;
        const p = (newPresences && Array.isArray(newPresences)) ? (newPresences[0] || {}) : {};
        if (S.presenceLeaveT[slot]) { clearTimeout(S.presenceLeaveT[slot]); delete S.presenceLeaveT[slot]; }
        S.presenceMap[slot] = { _status: p.status || 'online', _lastSeen: null };
        renderContacts(); renderMyStatus(); if (window.updateChatStatus) window.updateChatStatus();
      } catch (e) { console.error('[presence.join]', e); }
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      try {
        if (!key || !key.includes('_')) return;
        const slot = parseInt(key.split('_')[1], 10);
        if (isNaN(slot)) return;
        const offlineAt = Date.now();
        if (S.presenceLeaveT[slot]) clearTimeout(S.presenceLeaveT[slot]);
        S.presenceLeaveT[slot] = setTimeout(() => {
          const current = S.presenceMap[slot];
          if (current?._status !== 'offline') {
            S.presenceMap[slot] = { _status: 'offline', _lastSeen: offlineAt };
            renderContacts(); renderMyStatus(); if (window.updateChatStatus) window.updateChatStatus();
          }
          delete S.presenceLeaveT[slot];
        }, PRESENCE_LEAVE_DEBOUNCE);
      } catch (e) { console.error('[presence.leave]', e); }
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        _lastActivity = Date.now();
        await _trackPresence();
        clearInterval(S.presenceHB);
        S.presenceHB = setInterval(() => _trackPresence(), PRESENCE_HEARTBEAT);
        _startStatusRefresh();
        _initActivityTracking();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { updateConnectionBadge('reconnecting'); }
    });
}

async function _trackPresence(forcedStatus = null) {
  if (!_presenceCh || !S.me) return;
  try {
    const isAway = (Date.now() - _lastActivity) > PRESENCE_AWAY_TIMEOUT;
    let status = forcedStatus;
    if (!status) { status = document.hidden ? 'away' : (isAway ? 'away' : 'online'); }
    const existing = S.presenceMap[S.me.slot];
    S.presenceMap[S.me.slot] = { _status: status, _lastSeen: (existing?._status === 'online' || existing?._status === 'away') ? (existing?._lastSeen ?? null) : null };
    renderMyStatus();
    await _presenceCh.track({ status: status, lastSeen: Date.now() });
  } catch (e) { console.warn('[presence] track failed:', e); }
}

export function clearPresenceCh() {
  if (_presenceCh) { try { _presenceCh.unsubscribe(); } catch (_) { } _presenceCh = null; }
  clearInterval(S.presenceHB);
  clearInterval(_statusRefreshInterval);
  clearInterval(_inactivityCheck);
}

export async function renderContacts() {
  const el = document.getElementById('contacts');
  if (!el || !S.me) return;
  let dbUser = S.peerCache;
  if (!dbUser) {
    try {
      const otherSlot = S.me.slot === 1 ? 2 : 1;
      const { withTimeout } = await import('./utils.js');
      const { data, error } = await withTimeout(
        S.sb.from('cipher_users').select('slot,display_name,color').eq('slot', otherSlot).maybeSingle(),
        10000, 'renderContacts'
      );
      if (data) { S.peerCache = data; dbUser = data; }
    } catch (e) { console.warn('[renderContacts] fetch failed:', e); }
  }

  if (!dbUser) {
    el.innerHTML = '<div style="padding:40px 20px; text-align:center; opacity:0.4;"><i data-lucide="radio" style="width:32px; height:32px; margin-bottom:12px;"></i><p style="font-size:12px; font-weight:600;">SCANNING MESH FOR PEERS…</p></div>';
    if (window.lucide) window.lucide.createIcons({ node: el });
    return;
  }

  const ps = S.presenceMap[dbUser.slot];
  const status = ps?._status || 'offline';
  const label = _formatStatus(status, ps?._lastSeen);

  el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'c-row' + (S.peer?.slot === dbUser.slot ? ' active' : '');
  row.style.cssText = 'display:flex; align-items:center; gap:16px; padding:16px 24px; cursor:pointer; margin:4px 8px; border-radius:18px; position:relative;';

  const avW = document.createElement('div'); avW.style.position = 'relative';
  const av = document.createElement('div');
  av.className = 'av squircle';
  av.style.cssText = `width:48px; height:48px; background:${dbUser.color || 'var(--a)'}; display:flex; align-items:center; justify-content:center; font-weight:800; color:white; font-size:18px; box-shadow:0 8px 16px rgba(0,0,0,0.2);`;
  av.textContent = (dbUser.display_name || '?')[0].toUpperCase();
  
  const pip = document.createElement('div');
  pip.className = 'ppip' + (status === 'online' ? ' online' : status === 'away' ? ' away' : '');
  avW.appendChild(av); avW.appendChild(pip);

  const inf = document.createElement('div'); inf.style.flex = '1'; inf.style.minWidth = '0';
  const cn = document.createElement('div');
  cn.style.cssText = 'font-weight:700; font-size:15px; color:var(--t0); display:flex; align-items:center; justify-content:space-between;';
  cn.textContent = dbUser.display_name;

  if (S.unreadCount > 0) {
    const ub = document.createElement('span');
    ub.style.cssText = 'background:var(--red); color:white; font-size:10px; font-weight:900; padding:2px 8px; border-radius:10px; box-shadow:0 0 10px rgba(239,68,68,0.4);';
    ub.textContent = S.unreadCount > 99 ? '99+' : S.unreadCount;
    cn.appendChild(ub);
  }

  const cs = document.createElement('div');
  cs.className = 'c-s';
  cs.style.cssText = 'font-size:12px; color:var(--t3); font-weight:500; margin-top:2px;';
  cs.textContent = label;

  inf.appendChild(cn); inf.appendChild(cs);
  row.appendChild(avW); row.appendChild(inf);
  row.addEventListener('click', () => { window.openChat?.({ slot: dbUser.slot, name: dbUser.display_name, color: dbUser.color }); });
  el.appendChild(row);
}

export function updateChatStatus() {
  if (!S.peer) return;
  const p = S.presenceMap[S.peer.slot];
  const el = document.getElementById('ct-status-el');
  const pip = document.getElementById('ct-pip');
  const status = p?._status || 'offline';
  const label = _formatStatus(status, p?._lastSeen);
  if (el) { el.textContent = label; el.className = 'ct-s' + (status === 'online' ? ' online' : status === 'away' ? ' away' : ''); }
  if (pip) { pip.className = 'ppip' + (status === 'online' ? ' online' : status === 'away' ? ' away' : ''); }
}

function _formatStatus(status, lastSeen) {
  if (status === 'online') return 'MESH LINKED';
  if (status === 'away')   return 'SIGNAL WEAK';
  if (lastSeen)            return 'LOST ' + timeAgo(lastSeen).toUpperCase();
  return 'DISCONNECTED';
}

export function onVisibility(forcedStatus = null) { _lastActivity = Date.now(); _trackPresence(forcedStatus); }
export function onOnline() {
  document.getElementById('offline-bar')?.style.setProperty('display', 'none');
  updateConnectionBadge('connected');
  if (S.me) { subPresence(); if (window.resubMessages) window.resubMessages(); }
  if (window.flushOfflineQueue) window.flushOfflineQueue();
}
export function onOffline() {
  document.getElementById('offline-bar')?.style.setProperty('display', 'block');
  updateConnectionBadge('offline');
}

export function renderMyStatus() {
  if (!S.me) return;
  const p = S.presenceMap[S.me.slot];
  const status = p?._status || 'online';
  const labelEl = document.querySelector('.my-prof .my-s');
  if (labelEl) labelEl.textContent = status === 'online' ? 'MESH ACTIVE' : (status === 'away' ? 'MESH WEAK' : 'MESH OFFLINE');
  const pip = document.querySelector('.my-prof .pip');
  if (pip) pip.className = 'pip' + (status === 'online' ? ' online' : status === 'away' ? ' away' : '');
}

export function closeMobile() {
  if (window.bcastTyping) window.bcastTyping(false);
  document.getElementById('s-app')?.classList.remove('mobile-chat-active');
}
