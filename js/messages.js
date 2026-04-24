'use strict';
import { PAGE_SIZE, MAX_MSG, TYPING_THROTTLE, TYPING_TIMEOUT, DECOY } from './config.js';
import { SLOT_PREFIX, OPTIMISTIC_PREFIX, CHAT_CHANNEL_PREFIX,
         CHANNEL_SEPARATOR, EVT_TYPING }          from './constants.js';
import { S }                        from './state.js';
import { wCall, wCallProgress }     from './crypto.js';
import { toast, scrollBottom, resizeTA, showDecryptProg,
         setDecryptProg, fmtTime, fmtDate, btnLoad,
         showContextMenu, showReactionPicker,
         showJumpToBottom, updateUnreadBadge,
         updateConnectionBadge, haptic }           from './ui.js';
import { renderContacts }           from './presence.js';
import { putMessages, getMessages, markCachedRead } from './db.js';
import { withTimeout, withRetry, isRetryable }     from './utils.js';

let _msgCh = null;
const _pendingReadIds = new Set();
const RECONNECT_BASE_DELAY = 2_000;
const RECONNECT_CAP        = 60_000;
const RECONNECT_MAX        = 8;

function encodeContent(text, replyToId) {
  if (!replyToId) return JSON.stringify({ t: text });
  return JSON.stringify({ t: text, r: replyToId });
}

function decodeContent(plain) {
  if (!plain) return { text: '', replyTo: null };
  try {
    const obj = JSON.parse(plain);
    if (typeof obj === 'object' && obj !== null && typeof obj.t === 'string') {
      return { text: obj.t, replyTo: obj.r || null };
    }
  } catch (_) {}
  return { text: plain, replyTo: null };
}

export async function openChat(peer) {
  if (!peer?.slot || !peer?.name) return;
  if (S.peer && _msgCh) bcastTyping(false);
  clearTimeout(S.typingTimer);
  clearTimeout(S.typingAutoHide);
  clearTimeout(S.reconnectTimer);
  S.isTyping = false;
  S.isReconnecting = false;
  S.reconnectAttempts = 0;
  S.unreadCount = 0;
  updateUnreadBadge(0);
  _pendingReadIds.clear();

  const myToken = ++S.chatToken;
  S.peer = peer;
  S.isDecoy = false;
  S.renderedIds.clear();
  S.messages = [];
  S.msgQueue = [];
  S.pendingTexts.clear();
  S.historyLoading = true;
  S.oldestCursor = null;
  S.hasMore = false;
  clearReply();

  const ctAv = document.getElementById('ct-av-el');
  if (ctAv) { ctAv.textContent = (peer.name || '?')[0].toUpperCase(); ctAv.style.background = peer.color || 'var(--a)'; }
  const ctName = document.getElementById('ct-name-el');
  if (ctName) ctName.textContent = peer.name;
  const typAv = document.getElementById('typing-av');
  if (typAv) { typAv.textContent = (peer.name || '?')[0].toUpperCase(); typAv.style.background = peer.color || 'var(--a)'; }

  if (window.updateChatStatus) window.updateChatStatus();
  document.getElementById('chat-empty')?.style.setProperty('display', 'none');
  document.getElementById('chat-ui')?.style.setProperty('display', 'flex');
  document.getElementById('decoy-bar')?.style.setProperty('display', 'none');
  document.getElementById('decrypt-prog')?.style.setProperty('display', 'none');
  document.getElementById('s-app')?.classList.add('mobile-chat-active');
  showJumpToBottom(false);

  const area = document.getElementById('msgs');
  if (!area) return;
  area.innerHTML = '';
  
  let cachedRows = [];
  try { cachedRows = await getMessages(S.me.slot, peer.slot); } catch (e) {}

  if (cachedRows.length > 0 && myToken === S.chatToken) {
    cachedRows.forEach(row => renderMsg(row));
    scrollBottom();
    S.oldestCursor = cachedRows[0].time;
  } else {
    _showSkeleton(area);
  }

  _subMessages(myToken);
  await loadHistory(myToken, false);
  if (myToken !== S.chatToken) return;
  S.historyLoading = false;
  for (const row of S.msgQueue) {
    if (myToken !== S.chatToken) return;
    await _handleIncoming(row, myToken);
  }
  S.msgQueue = [];
  renderContacts();
}

function _showSkeleton(area) {
  const wrap = document.createElement('div'); wrap.className = 'skel-wrap'; wrap.id = 'skel';
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:12px; padding:20px;';
  for(let i=0; i<4; i++) {
    const r = document.createElement('div'); r.className = 'skel-row ' + (i%2===0?'l':'r');
    r.style.cssText = `display:flex; justify-content:${i%2===0?'flex-start':'flex-end'};`;
    const b = document.createElement('div'); b.className = 'skel-bubble glass shimmer';
    b.style.cssText = `width:${100+Math.random()*100}px; height:40px; border-radius:18px; opacity:0.1;`;
    r.appendChild(b); wrap.appendChild(r);
  }
  area.appendChild(wrap);
}
function _removeSkeleton() { document.getElementById('skel')?.remove(); }

export async function loadHistory(token, prepend = false) {
  const me = SLOT_PREFIX + S.me.slot;
  const peer = SLOT_PREFIX + S.peer.slot;
  if (!prepend) showDecryptProg(true, 'Loading…', 0);
  let data = null, error = null;
  try {
    const res = await withRetry(() => {
        let q = S.sb.from('messages').select('id,sender_id,content,created_at,read_at').or(`and(sender_id.eq.${me},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${me})`).order('created_at', { ascending: false }).limit(PAGE_SIZE);
        if (prepend && S.oldestCursor) q = q.lt('created_at', S.oldestCursor);
        return withTimeout(q, 12000, 'loadHistory');
    }, { maxAttempts: 3, operationName: 'loadHistory', shouldRetry: isRetryable });
    data = res.data; error = res.error;
  } catch (e) { error = e; }
  if (token !== S.chatToken) return;
  if (error) { toast('Failed to load messages'); _removeSkeleton(); showDecryptProg(false); return; }
  const rows = (data || []).reverse();
  S.hasMore = (data || []).length === PAGE_SIZE;
  if (rows.length > 0) S.oldestCursor = rows[0].created_at;
  if (rows.length > 0) showDecryptProg(true, 'Loading…', 0);
  let results;
  try {
    const resp = await wCallProgress({ type: 'DECRYPT_BATCH', messages: rows.map(r => ({ id: r.id, content: r.content })) }, (done, total) => {
        if (token !== S.chatToken) return;
        setDecryptProg(Math.round(done / total * 100), `Loading ${done}/${total}`);
    });
    results = resp.results;
  } catch (e) { toast('Error loading messages'); _removeSkeleton(); showDecryptProg(false); return; }
  if (token !== S.chatToken) return;
  showDecryptProg(false);
  const anyFailed = results.some(r => r.plain === null);
  _removeSkeleton();
  if (anyFailed) { _activateDecoy(); return; }
  const decoded = {};
  results.forEach(r => { decoded[r.id] = decodeContent(r.plain); });
  const area = document.getElementById('msgs');
  if (!area) return;
  const cacheEntries = [];
  if (prepend) {
    const frag = document.createDocumentFragment();
    const insertBefore = area.querySelector('.dsep,.msg-r');
    let lastDateInFrag = null;
    rows.forEach(row => {
      if (S.renderedIds.has(row.id)) return;
      const d = decoded[row.id], from = row.sender_id === me ? 'me' : 'them', dStr = new Date(row.created_at).toDateString();
      if (lastDateInFrag !== dStr) {
        const sep = document.createElement('div'); sep.className = 'dsep';
        const lbl = document.createElement('span'); lbl.className = 'dsep-lbl'; lbl.textContent = fmtDate(row.created_at);
        sep.appendChild(lbl); frag.appendChild(sep); lastDateInFrag = dStr;
      }
      _appendMsgToFrag(frag, { id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
      cacheEntries.push({ id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
    });
    area.insertBefore(frag, insertBefore || null);
    _recalculateGrouping();
  } else {
    rows.forEach(row => {
      if (S.renderedIds.has(row.id)) return;
      const d = decoded[row.id], from = row.sender_id === me ? 'me' : 'them';
      renderMsg({ id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
      cacheEntries.push({ id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
    });
    scrollBottom();
  }
  if (cacheEntries.length > 0) putMessages(S.me.slot, S.peer.slot, cacheEntries).catch(() => {});
  const unread = rows.filter(r => r.sender_id === peer && !r.read_at).map(r => r.id);
  if (unread.length) _markRead(unread);
  _updatePageBtn();
}

function _updatePageBtn() { document.getElementById('page-loader')?.classList.toggle('show', S.hasMore && !S.historyLoading); }

export function resubMessages() { if (S.peer) _subMessages(S.chatToken); }

function _subMessages(token) {
  if (_msgCh) { try { _msgCh.unsubscribe(); } catch (_) { } _msgCh = null; }
  const me = SLOT_PREFIX + S.me.slot, peer = SLOT_PREFIX + S.peer.slot, room = [me, peer].sort().join(CHANNEL_SEPARATOR);
  _msgCh = S.sb.channel(CHAT_CHANNEL_PREFIX + room)
    .on('broadcast', { event: EVT_TYPING }, p => { if (token === S.chatToken && p.payload?.from === peer) _receiveTyping(p.payload.on); })
    .on('broadcast', { event: 'reaction' }, p => {
      if (token !== S.chatToken) return;
      const { msgId, emoji, from } = p.payload || {};
      if (msgId && emoji && from !== me) _applyReaction(msgId, emoji);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${me}` }, async p => {
        if (p.new.sender_id !== peer) return;
        if (S.historyLoading) { S.msgQueue.push(p.new); return; }
        if (token === S.chatToken) await _handleIncoming(p.new, token);
      })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, p => {
      if (token === S.chatToken && p.new.sender_id === me && p.new.read_at) {
        updateReceipt(p.new.id, 'read');
        markCachedRead(p.new.id, p.new.read_at).catch(() => {});
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => {
      if (p.old?.id) { document.querySelector(`[data-mid="${p.old.id}"]`)?.remove(); _recalculateGrouping(); }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (S.isReconnecting) { S.isReconnecting = false; S.reconnectAttempts = 0; updateConnectionBadge('connected'); toast('Connected ✓'); }
        else updateConnectionBadge('connected');
      } else if (['CHANNEL_ERROR', 'CLOSED', 'TIMED_OUT'].includes(status)) {
        if (token === S.chatToken && navigator.onLine) _scheduleReconnect(token);
      }
    });
}

function _scheduleReconnect(token) {
  if (S.isReconnecting || token !== S.chatToken) return;
  if (S.reconnectAttempts >= RECONNECT_MAX) { updateConnectionBadge('offline'); return; }
  S.isReconnecting = true;
  const delay = Math.min(RECONNECT_CAP, RECONNECT_BASE_DELAY * 2 ** S.reconnectAttempts + Math.random() * 1000);
  S.reconnectAttempts++;
  updateConnectionBadge('reconnecting');
  clearTimeout(S.reconnectTimer);
  S.reconnectTimer = setTimeout(() => { if (token === S.chatToken && S.peer && navigator.onLine) _subMessages(token); }, delay);
}

async function _handleIncoming(row, token) {
  if (token !== S.chatToken || S.isDecoy || S.renderedIds.has(row.id)) return;
  let results;
  try {
    const resp = await wCall({ type: 'DECRYPT_BATCH', messages: [{ id: row.id, content: row.content }] });
    results = resp.results;
  } catch (e) { return; }
  if (token !== S.chatToken) return;
  const r = results[0];
  if (!r || r.plain === null) { _activateDecoy(); return; }
  const d = decodeContent(r.plain);
  renderMsg({ id: row.id, text: d.text, from: 'them', time: row.created_at, readAt: null, replyTo: d.replyTo });
  const area = document.getElementById('msgs');
  const isAtBottom = area ? (area.scrollHeight - area.scrollTop - area.clientHeight) < 100 : true;
  if (isAtBottom) { scrollBottom(true); _markRead([row.id]); }
  else { _pendingReadIds.add(row.id); S.unreadCount++; updateUnreadBadge(S.unreadCount); }
  _showTyping(false);
  putMessages(S.me.slot, S.peer.slot, [{ id: row.id, text: d.text, from: 'them', time: row.created_at, readAt: null, replyTo: d.replyTo }]).catch(() => {});
}

export function clearMsgCh() {
  clearTimeout(S.reconnectTimer); S.isReconnecting = false; S.reconnectAttempts = 0; _pendingReadIds.clear();
  if (_msgCh) { try { _msgCh.unsubscribe(); } catch (_) {} _msgCh = null; }
}

export function setReply(id, text, fromName) {
  S.replyTo = { id, text, fromName };
  const bar = document.getElementById('reply-bar');
  if (bar) {
    const nameEl = bar.querySelector('.reply-name'), textEl = bar.querySelector('.reply-text');
    if (nameEl) nameEl.textContent = fromName || '';
    if (textEl) textEl.textContent = (text || '').slice(0, 80);
    bar.style.display = 'flex';
  }
  document.getElementById('msg-inp')?.focus();
}
export function clearReply() { S.replyTo = null; const bar = document.getElementById('reply-bar'); if (bar) bar.style.display = 'none'; }

export async function doSend() {
  if (S.isDecoy || S.sendInflight || !S.peer || !S.me) return;
  const inp = document.getElementById('msg-inp');
  if (!inp) return;
  let text = inp.value.trim();
  if (!text) return;
  if (text.length > MAX_MSG) text = text.slice(0, MAX_MSG);
  if (!navigator.onLine) {
    S.offlineQueue.push({ text, replyTo: S.replyTo?.id || null });
    inp.value = ''; resizeTA(inp); clearReply(); toast('Offline — queued'); return;
  }
  S.sendInflight = true;
  const replyToId = S.replyTo?.id || null, replyText = S.replyTo?.text || null, replyFrom = S.replyTo?.fromName || null;
  inp.value = ''; resizeTA(inp); clearReply(); bcastTyping(false);
  const optId = OPTIMISTIC_PREFIX + Date.now();
  S.pendingTexts.set(optId, text);
  renderMsg({ id: optId, text, from: 'me', time: new Date().toISOString(), readAt: null, pending: true, replyTo: replyToId, replyText, replyFrom });
  scrollBottom(true);
  const sendBtn = document.getElementById('send-b');
  sendBtn?.classList.add('pop'); setTimeout(() => sendBtn?.classList.remove('pop'), 300);
  haptic('MEDIUM');
  try {
    const encoded = encodeContent(text, replyToId);
    const encResp = await wCall({ type: 'ENCRYPT', plain: encoded });
    const { data, error } = await withRetry(() => withTimeout(S.sb.from('messages').insert({ sender_id: SLOT_PREFIX+S.me.slot, sender_name: S.me.name, receiver_id: SLOT_PREFIX+S.peer.slot, content: encResp.cipher }).select('id,created_at').single(), 15000, 'doSend'), { maxAttempts: 3, operationName: 'doSend', shouldRetry: isRetryable });
    if (error) throw error;
    _replaceOptimistic(optId, data.id, data.created_at);
    putMessages(S.me.slot, S.peer.slot, [{ id: data.id, text, from: 'me', time: data.created_at, readAt: null, replyTo: replyToId }]).catch(() => {});
  } catch (e) { _removeOptimistic(optId); toast('Failed to send'); inp.value = text; }
  finally { S.sendInflight = false; document.getElementById('send-b').disabled = !inp.value.trim(); }
}

export async function flushOfflineQueue() {
  if (!S.offlineQueue.length || !S.me || !S.peer) return;
  const snapshot = [...S.offlineQueue]; S.offlineQueue = [];
  for (const item of snapshot) {
    try {
      const text = item.text, replyToId = item.replyTo || null, encoded = encodeContent(text, replyToId), encResp = await wCall({ type: 'ENCRYPT', plain: encoded });
      const { data, error } = await withRetry(() => withTimeout(S.sb.from('messages').insert({ sender_id: SLOT_PREFIX+S.me.slot, sender_name: S.me.name, receiver_id: SLOT_PREFIX+S.peer.slot, content: encResp.cipher }).select('id,created_at').single(), 15000, 'flush'), { maxAttempts: 2, operationName: 'flush', shouldRetry: isRetryable });
      if (error) throw error;
      renderMsg({ id: data.id, text, from: 'me', time: data.created_at, readAt: null, replyTo: replyToId });
      putMessages(S.me.slot, S.peer.slot, [{ id: data.id, text, from: 'me', time: data.created_at, readAt: null, replyTo: replyToId }]).catch(() => {});
    } catch (e) { S.offlineQueue.push(item); }
  }
  if (snapshot.length > S.offlineQueue.length) { scrollBottom(true); if (_pendingReadIds.size > 0) { const ids = [..._pendingReadIds]; _pendingReadIds.clear(); _markRead(ids); } }
}

function _appendMsgToFrag(frag, msg) {
  if (S.renderedIds.has(msg.id)) return;
  S.renderedIds.add(msg.id);
  frag.appendChild(_buildMsgRow(msg));
  S.messages.unshift({ id: msg.id, time: msg.time, from: msg.from });
}

export function renderMsg(msg) {
  if (S.renderedIds.has(msg.id)) return;
  S.renderedIds.add(msg.id);
  const area = document.getElementById('msgs');
  if (!area) return;
  const dStr = new Date(msg.time).toDateString(), last = S.messages[S.messages.length - 1];
  if (!last || new Date(last.time).toDateString() !== dStr) {
    const sep = document.createElement('div'); sep.className = 'dsep';
    const lbl = document.createElement('span'); lbl.className = 'dsep-lbl'; lbl.textContent = fmtDate(msg.time);
    sep.appendChild(lbl); area.appendChild(sep);
  }
  area.appendChild(_buildMsgRow(msg));
  S.messages.push({ id: msg.id, time: msg.time, from: msg.from });
  _recalculateGrouping();
}

function _recalculateGrouping() {
  const rows = [...document.querySelectorAll('.msg-r')];
  rows.forEach((row, i) => {
    row.classList.remove('grouped-top', 'grouped-mid', 'grouped-bottom');
    const prev = rows[i-1], next = rows[i+1], from = row.dataset.from;
    const samePrev = prev && prev.dataset.from === from, sameNext = next && next.dataset.from === from;
    if (samePrev && sameNext) row.classList.add('grouped-mid');
    else if (samePrev) row.classList.add('grouped-bottom');
    else if (sameNext) row.classList.add('grouped-top');
  });
}

function _lookupReplyText(id) { const el = document.querySelector(`[data-mid="${id}"] .msg-text`); return el?.textContent || null; }

function _buildMsgRow({ id, text, from, time, readAt, pending, replyTo, replyText, replyFrom }) {
  const row = document.createElement('div'); row.className = 'msg-r ' + from; row.dataset.mid = id; row.dataset.from = from;
  const bub = document.createElement('div'); bub.className = 'bubble' + (pending ? ' pending' : '');
  if (replyTo) {
    const q = document.createElement('div'); q.className = 'reply-quote';
    const n = document.createElement('span'); n.className = 'reply-quote-name'; n.textContent = replyFrom || (from === 'me' ? S.peer?.name : S.me?.name);
    const t = document.createElement('span'); t.className = 'reply-quote-text'; t.textContent = (replyText || _lookupReplyText(replyTo) || '…').slice(0, 80);
    q.appendChild(n); q.appendChild(t);
    q.addEventListener('click', () => { const target = document.querySelector(`[data-mid="${replyTo}"]`); if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('msg-flash'); setTimeout(() => target.classList.remove('msg-flash'), 1200); } });
    bub.appendChild(q);
  }
  const txt = document.createElement('span'); txt.className = 'msg-text'; txt.textContent = text; bub.appendChild(txt);
  const rWrap = document.createElement('div'); rWrap.className = 'msg-reactions'; rWrap.dataset.rcWrap = id; bub.appendChild(rWrap);
  const meta = document.createElement('div'); meta.className = 'msg-meta';
  const ts = document.createElement('span'); ts.className = 'mt'; ts.textContent = fmtTime(time); meta.appendChild(ts);
  if (from === 'me') {
    const rc = document.createElement('span'); rc.className = 'rc ' + (pending ? 'pending' : readAt ? 'read' : 'sent');
    rc.innerHTML = pending ? '<i data-lucide="clock"></i>' : readAt ? '<i data-lucide="check-check"></i>' : '<i data-lucide="check"></i>';
    rc.dataset.rc = id; meta.appendChild(rc);
  }
  row.appendChild(bub); row.appendChild(meta);
  
  let _longT = null;
  row.addEventListener('touchstart', () => { _longT = setTimeout(() => { haptic('LIGHT'); _showMessageMenu(id, text, from, bub); }, 500); }, { passive: true });
  row.addEventListener('touchend', () => clearTimeout(_longT), { passive: true });
  row.addEventListener('contextmenu', e => { e.preventDefault(); _showMessageMenu(id, text, from, bub); });
  row.addEventListener('dblclick', () => setReply(id, text, from === 'me' ? S.me?.name : S.peer?.name));
  
  if (window.lucide) window.lucide.createIcons({ node: row });
  return row;
}

function _showMessageMenu(id, text, from, bubEl) {
  const items = [{ label: 'Reply', icon: 'corner-up-left', action: () => setReply(id, text, from === 'me' ? S.me?.name : S.peer?.name) }];
  if (from === 'them') items.push({ label: 'React', icon: 'smile', action: () => showReactionPicker(bubEl, e => _sendReaction(id, e)) });
  if (from === 'me' && !id.startsWith(OPTIMISTIC_PREFIX)) items.push({ label: 'Delete', icon: 'trash-2', danger: true, action: () => unsendMessage(id) });
  showContextMenu(items);
}

function _sendReaction(msgId, emoji) {
  if (!_msgCh || !S.me || !S.peer) return;
  _applyReaction(msgId, emoji);
  try { _msgCh.send({ type: 'broadcast', event: 'reaction', payload: { msgId, emoji, from: SLOT_PREFIX + S.me.slot } }); } catch (e) {}
  haptic('MEDIUM');
}
function _applyReaction(msgId, emoji) {
  const wrap = document.querySelector(`[data-rc-wrap="${msgId}"]`); if (!wrap) return;
  wrap.innerHTML = ''; const s = document.createElement('span'); s.className = 'reaction-chip'; s.textContent = emoji; wrap.appendChild(s);
}

export async function unsendMessage(id) {
  if (!id || id.startsWith(OPTIMISTIC_PREFIX)) return;
  try {
    const { error } = await withRetry(() => withTimeout(S.sb.from('messages').delete().match({ id, sender_id: SLOT_PREFIX+S.me.slot }), 10000, 'unsend'), { maxAttempts: 2, operationName: 'unsend', shouldRetry: isRetryable });
    if (error) throw error;
    document.querySelector(`[data-mid="${id}"]`)?.remove(); _recalculateGrouping(); haptic('MEDIUM');
  } catch (e) { toast('Failed to delete'); }
}

function _replaceOptimistic(optId, realId, realTime) {
  const txt = S.pendingTexts.get(optId) || ''; S.pendingTexts.delete(optId);
  const el = document.querySelector(`[data-mid="${optId}"]`);
  if (!el) { S.renderedIds.delete(optId); if (txt) renderMsg({ id: realId, text: txt, from: 'me', time: realTime, readAt: null }); return; }
  el.dataset.mid = realId; el.querySelector('.bubble')?.classList.remove('pending');
  const rc = el.querySelector('.rc'); if (rc) { rc.className = 'rc sent'; rc.innerHTML = '<i data-lucide="check"></i>'; rc.dataset.rc = realId; }
  const ts = el.querySelector('.mt'); if (ts) ts.textContent = fmtTime(realTime);
  S.renderedIds.delete(optId); S.renderedIds.add(realId);
  const idx = S.messages.findIndex(m => m.id === optId); if (idx > -1) S.messages[idx] = { id: realId, time: realTime, from: 'me' };
  if (window.lucide) window.lucide.createIcons({ node: el });
}

function _removeOptimistic(optId) { S.pendingTexts.delete(optId); document.querySelector(`[data-mid="${optId}"]`)?.remove(); S.renderedIds.delete(optId); const idx = S.messages.findIndex(m => m.id === optId); if (idx > -1) S.messages.splice(idx, 1); _recalculateGrouping(); }

export function updateReceipt(id, status) {
  const el = document.querySelector(`[data-rc="${id}"]`); if (!el) return;
  el.className = 'rc ' + status; el.innerHTML = status === 'read' ? '<i data-lucide="check-check"></i>' : '<i data-lucide="check"></i>';
  if (window.lucide) window.lucide.createIcons({ node: el });
}

async function _markRead(ids) {
  if (!ids.length) return;
  const toMark = ids.filter(id => id && !id.startsWith(OPTIMISTIC_PREFIX)); if (!toMark.length) return;
  try {
    for (let i = 0; i < toMark.length; i += 50) {
      const batch = toMark.slice(i, i + 50);
      await withRetry(() => withTimeout(S.sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', batch).is('read_at', null), 10000, 'markRead'), { maxAttempts: 2, operationName: 'markRead', shouldRetry: isRetryable });
    }
    const now = new Date().toISOString(); for (const id of toMark) markCachedRead(id, now).catch(() => {});
  } catch (e) {}
}

function _activateDecoy() {
  S.isDecoy = true; const bar = document.getElementById('decoy-bar'); if (bar) bar.style.display = 'block';
  _removeSkeleton(); showDecryptProg(false);
  const area = document.getElementById('msgs'); if (!area) return;
  area.innerHTML = ''; area.style.backgroundImage = 'none';
  const now = Date.now();
  DECOY.forEach((m, i) => {
    const fakeT = new Date(now - (DECOY.length - i) * 4 * 60000).toISOString();
    const row = document.createElement('div'); row.className = 'msg-r ' + (m.s === 1 ? 'me' : 'them');
    const bub = document.createElement('div'); bub.className = 'bubble'; bub.textContent = m.t;
    const meta = document.createElement('div'); meta.className = 'msg-meta';
    const ts = document.createElement('span'); ts.className = 'mt'; ts.textContent = fmtTime(fakeT); meta.appendChild(ts);
    if (m.s === 1) { const rc = document.createElement('span'); rc.className = 'rc read'; rc.innerHTML = '<i data-lucide="check-check"></i>'; meta.appendChild(rc); }
    row.appendChild(bub); row.appendChild(meta); area.appendChild(row);
  });
  if (window.lucide) window.lucide.createIcons({ node: area });
  scrollBottom(false);
}

let _typingLastBcast = 0;
export function onInput() {
  const inp = document.getElementById('msg-inp'); if (!inp) return;
  resizeTA(inp); document.getElementById('send-b').disabled = !inp.value.trim();
  const now = Date.now(); if (!S.isTyping || now - _typingLastBcast > TYPING_THROTTLE) { S.isTyping = true; _typingLastBcast = now; bcastTyping(true); }
  clearTimeout(S.typingTimer); S.typingTimer = setTimeout(() => { S.isTyping = false; bcastTyping(false); }, TYPING_THROTTLE);
}
export function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } }
export function bcastTyping(on) { if (!_msgCh || !S.peer) return; if (!on && !S.isTyping && _typingLastBcast === 0) return; try { _msgCh.send({ type: 'broadcast', event: EVT_TYPING, payload: { from: SLOT_PREFIX + S.me.slot, on } }); } catch (e) {} if (!on) { S.isTyping = false; _typingLastBcast = 0; } }
function _receiveTyping(on) { _showTyping(on); clearTimeout(S.typingAutoHide); if (on) S.typingAutoHide = setTimeout(() => _showTyping(false), TYPING_TIMEOUT); }
function _showTyping(on) { const el = document.getElementById('typing-r'); if (el) el.style.display = on ? 'flex' : 'none'; if (on) scrollBottom(true); }

export function initScrollPagination() {
  const area = document.getElementById('msgs'); if (!area) return;
  area.addEventListener('scroll', async () => {
    const dist = area.scrollHeight - area.scrollTop - area.clientHeight;
    showJumpToBottom(dist > 200);
    if (dist < 60 && (S.unreadCount > 0 || _pendingReadIds.size > 0)) {
      S.unreadCount = 0; updateUnreadBadge(0);
      if (_pendingReadIds.size > 0) { const ids = [..._pendingReadIds]; _pendingReadIds.clear(); _markRead(ids); }
    }
    const threshold = area.scrollHeight * 0.1;
    if (area.scrollTop < threshold && S.hasMore && !S.historyLoading && !S.isDecoy && S.peer) {
      S.historyLoading = true; document.getElementById('page-loader')?.classList.add('show');
      const prevH = area.scrollHeight; await loadHistory(S.chatToken, true);
      S.historyLoading = false; area.scrollTop = area.scrollHeight - prevH; _updatePageBtn();
    }
  });
}
export function jumpToBottom() { const area = document.getElementById('msgs'); if (!area) return; area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' }); S.unreadCount = 0; updateUnreadBadge(0); showJumpToBottom(false); if (_pendingReadIds.size > 0) { const ids = [..._pendingReadIds]; _pendingReadIds.clear(); _markRead(ids); } }
