'use strict';
import { PAGE_SIZE, MAX_MSG, PBKDF2_ITER, TYPING_THROTTLE, TYPING_TIMEOUT, DECOY } from './config.js';
import { S }                        from './state.js';
import { wCall, wCallProgress }     from './crypto.js';
import { toast, scrollBottom, resizeTA, showDecryptProg,
         setDecryptProg, fmtTime, fmtDate, btnLoad }  from './ui.js';
import { renderContacts }           from './presence.js';
import { putMessages, getMessages, markCachedRead } from './db.js';

let _msgCh = null;

/* ═══════════════════════════════════════════════════════════
   CONTENT ENCODING — supports plain text and reply metadata.
   Format: JSON  { "t": "message text", "r": "reply-id" }
   If the content doesn't parse as JSON with "t", treat it as
   legacy raw text. This is backward-compatible.
═══════════════════════════════════════════════════════════ */
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
  } catch (_) { /* not JSON — treat as legacy raw text */ }
  return { text: plain, replyTo: null };
}

/* ═══════════════════════════════════════════════════════════
   OPEN CHAT
═══════════════════════════════════════════════════════════ */
export async function openChat(peer) {
  if (!peer?.slot || !peer?.name) return;
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

  // Header
  const ctAv = document.getElementById('ct-av-el');
  if (ctAv) { ctAv.textContent = (peer.name || '?')[0].toUpperCase(); ctAv.style.background = peer.color || '#c9963a'; }
  const ctName = document.getElementById('ct-name-el');
  if (ctName) ctName.textContent = peer.name;
  const typAv = document.getElementById('typing-av');
  if (typAv) { typAv.textContent = (peer.name || '?')[0].toUpperCase(); typAv.style.background = peer.color || '#c9963a'; }

  if (window.updateChatStatus) window.updateChatStatus();

  const ce = document.getElementById('chat-empty'); if(ce) ce.style.display = 'none';
  const cu = document.getElementById('chat-ui');    if(cu) cu.style.display = 'flex';
  document.getElementById('decoy-bar')?.classList.remove('show');
  document.getElementById('decrypt-prog')?.classList.remove('show');
  document.getElementById('s-app')?.classList.add('mobile-chat-active');

  const area = document.getElementById('msgs');
  if (!area) return;
  area.innerHTML = '';
  const badge = document.createElement('div');
  badge.className = 'e2ee-badge'; badge.textContent = '🔐 end-to-end encrypted';
  area.appendChild(badge);

  // ── Serve from IndexedDB cache first (instant feel) ──
  let cachedRows = [];
  try {
    cachedRows = await getMessages(S.me.slot, peer.slot);
  } catch (_) { /* IndexedDB unavailable — continue to network */ }

  if (cachedRows.length > 0 && myToken === S.chatToken) {
    cachedRows.forEach(row => {
      renderMsg({ id: row.id, text: row.text, from: row.from, time: row.time, readAt: row.readAt, replyTo: row.replyTo });
    });
    scrollBottom();
    if (cachedRows.length > 0) {
      S.oldestCursor = cachedRows[0].time;
    }
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
  const skels = [
    { side: 'l', w: 160, h: 40 }, { side: 'r', w: 200, h: 40 },
    { side: 'l', w: 120, h: 36 }, { side: 'r', w: 170, h: 56 },
    { side: 'l', w: 190, h: 40 }, { side: 'r', w: 140, h: 40 },
  ];
  const wrap = document.createElement('div'); wrap.className = 'skel-wrap'; wrap.id = 'skel';
  skels.forEach(({ side, w, h }) => {
    const row = document.createElement('div'); row.className = 'skel-row ' + side;
    const b   = document.createElement('div'); b.className = 'skel-bubble';
    b.style.cssText = `width:${w}px;height:${h}px;border-radius:14px;`;
    const m   = document.createElement('div'); m.className = 'skel-meta';
    row.appendChild(b); row.appendChild(m); wrap.appendChild(row);
  });
  area.appendChild(wrap);
}
function _removeSkeleton() { document.getElementById('skel')?.remove(); }

/* ═══════════════════════════════════════════════════════════
   LOAD HISTORY
═══════════════════════════════════════════════════════════ */
export async function loadHistory(token, prepend = false) {
  const me   = 'slot_' + S.me.slot;
  const peer = 'slot_' + S.peer.slot;
  if (!prepend) showDecryptProg(true, 'Loading…', 0);

  let query = S.sb.from('messages')
    .select('id,sender_id,content,created_at,read_at')
    .or(`and(sender_id.eq.${me},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${me})`)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (prepend && S.oldestCursor) query = query.lt('created_at', S.oldestCursor);

  const { data, error } = await query;
  if (token !== S.chatToken) return;
  if (error) { toast('Failed to load messages'); _removeSkeleton(); showDecryptProg(false); return; }

  const rows = (data || []).reverse();
  S.hasMore = (data || []).length === PAGE_SIZE;
  if (rows.length > 0) S.oldestCursor = rows[0].created_at;
  if (rows.length > 0) showDecryptProg(true, 'Decrypting…', 0);

  const { results } = await wCallProgress(
    { type: 'DECRYPT_BATCH', messages: rows.map(r => ({ id: r.id, content: r.content })) },
    (done, total) => {
      if (token !== S.chatToken) return;
      setDecryptProg(Math.round(done / total * 100), `Decrypting ${done}/${total}`);
    }
  );
  if (token !== S.chatToken) return;
  showDecryptProg(false);

  const anyFailed = results.some(r => r.plain === null);
  _removeSkeleton();
  if (anyFailed) { _activateDecoy(); return; }

  const decoded = {};
  results.forEach(r => { decoded[r.id] = decodeContent(r.plain); });

  const area = document.getElementById('msgs');
  if (!area) return;

  // ── Build cache entries from this fetch ──
  const cacheEntries = [];

  if (prepend) {
    const frag = document.createDocumentFragment();
    const insertBefore = area.querySelector('.dsep,.msg-r');
    let lastDateInFrag = null;
    rows.forEach(row => {
      if (S.renderedIds.has(row.id)) return;
      const d = decoded[row.id];
      const from = row.sender_id === me ? 'me' : 'them';
      const dStr = new Date(row.created_at).toDateString();
      if (lastDateInFrag !== dStr) {
        const sep = document.createElement('div'); sep.className = 'dsep';
        const lbl = document.createElement('span'); lbl.className = 'dsep-lbl';
        lbl.textContent = fmtDate(row.created_at);
        sep.appendChild(lbl); frag.appendChild(sep);
        lastDateInFrag = dStr;
      }
      _appendMsgToFrag(frag, { id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
      cacheEntries.push({ id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
    });
    if (insertBefore) area.insertBefore(frag, insertBefore);
    else area.appendChild(frag);
  } else {
    rows.forEach(row => {
      if (S.renderedIds.has(row.id)) return;
      const d = decoded[row.id];
      const from = row.sender_id === me ? 'me' : 'them';
      renderMsg({ id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
      cacheEntries.push({ id: row.id, text: d.text, from, time: row.created_at, readAt: row.read_at, replyTo: d.replyTo });
    });
    scrollBottom();
  }

  // ── Persist to IndexedDB in the background ──
  if (cacheEntries.length > 0) {
    putMessages(S.me.slot, S.peer.slot, cacheEntries).catch(() => {});
  }

  const unread = rows.filter(r => r.sender_id === peer && !r.read_at).map(r => r.id);
  if (unread.length) _markRead(unread);
  _updatePageBtn();
}

function _updatePageBtn() {
  document.getElementById('page-loader')?.classList.toggle('show', S.hasMore && !S.historyLoading);
}

/* ═══════════════════════════════════════════════════════════
   REALTIME
═══════════════════════════════════════════════════════════ */
function _subMessages(token) {
  if (_msgCh) { try { _msgCh.unsubscribe(); } catch (_) { } _msgCh = null; }
  const me   = 'slot_' + S.me.slot;
  const peer = 'slot_' + S.peer.slot;
  const room = [me, peer].sort().join('--');

  _msgCh = S.sb.channel('chat-' + room)
    .on('broadcast', { event: 'typing' }, payload => {
      if (token !== S.chatToken) return;
      if (payload.payload?.from === peer) _receiveTyping(payload.payload.on);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${me}` },
      async payload => {
        const row = payload.new;
        if (row.sender_id !== peer) return;
        if (S.historyLoading) { S.msgQueue.push(row); return; }
        if (token !== S.chatToken) return;
        await _handleIncoming(row, token);
      })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
      const row = payload.new;
      if (token !== S.chatToken) return;
      if (row.sender_id !== 'slot_' + S.me.slot) return;
      if (row.read_at) {
        updateReceipt(row.id, 'read');
        markCachedRead(row.id, row.read_at).catch(() => {});
      }
    })
    .subscribe();
}

async function _handleIncoming(row, token) {
  if (token !== S.chatToken) return;
  if (S.isDecoy) return;
  if (S.renderedIds.has(row.id)) return;
  const { results } = await wCall({ type: 'DECRYPT_BATCH', messages: [{ id: row.id, content: row.content }] });
  if (token !== S.chatToken) return;
  const r = results[0];
  if (!r || r.plain === null) { _activateDecoy(); return; }
  const d = decodeContent(r.plain);
  renderMsg({ id: row.id, text: d.text, from: 'them', time: row.created_at, readAt: null, replyTo: d.replyTo });
  scrollBottom(true);
  _markRead([row.id]);
  _showTyping(false);

  // Cache the incoming message
  putMessages(S.me.slot, S.peer.slot, [
    { id: row.id, text: d.text, from: 'them', time: row.created_at, readAt: null, replyTo: d.replyTo }
  ]).catch(() => {});
}

export function clearMsgCh() {
  if (_msgCh) { try { _msgCh.unsubscribe(); } catch (_) { } _msgCh = null; }
}

/* ═══════════════════════════════════════════════════════════
   REPLY STATE
═══════════════════════════════════════════════════════════ */
export function setReply(id, text, fromName) {
  S.replyTo = { id, text, fromName };
  const bar = document.getElementById('reply-bar');
  if (bar) {
    const nameEl = bar.querySelector('.reply-name');
    const textEl = bar.querySelector('.reply-text');
    if (nameEl) nameEl.textContent = fromName || '';
    if (textEl) textEl.textContent = (text || '').slice(0, 80);
    bar.classList.add('show');
  }
  document.getElementById('msg-inp')?.focus();
}

export function clearReply() {
  S.replyTo = null;
  document.getElementById('reply-bar')?.classList.remove('show');
}

/* ═══════════════════════════════════════════════════════════
   SEND
═══════════════════════════════════════════════════════════ */
export async function doSend() {
  if (S.isDecoy) { toast('Wrong passphrase — cannot send'); return; }
  if (S.sendInflight || !S.peer || !S.me) return;
  const inp = document.getElementById('msg-inp');
  if (!inp) return;
  let text = inp.value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  if (!text) return;
  if (text.length > MAX_MSG) { text = text.slice(0, MAX_MSG); toast('Message trimmed to 4000 chars'); }

  if (!navigator.onLine) {
    S.offlineQueue.push({ text, replyTo: S.replyTo?.id || null });
    inp.value = ''; resizeTA(inp);
    document.getElementById('send-b').disabled = true;
    clearReply();
    toast('Offline — message queued'); return;
  }

  S.sendInflight = true;
  const replyToId = S.replyTo?.id || null;
  const replyText = S.replyTo?.text || null;
  const replyFrom = S.replyTo?.fromName || null;
  inp.value = ''; resizeTA(inp);
  document.getElementById('send-b').disabled = true;
  clearReply();
  bcastTyping(false);

  const optId = 'opt-' + Date.now();
  S.pendingTexts.set(optId, text);
  renderMsg({ id: optId, text, from: 'me', time: new Date().toISOString(), readAt: null, pending: true, replyTo: replyToId, replyText, replyFrom });
  scrollBottom(true);

  const sendBtn = document.getElementById('send-b');
  sendBtn?.classList.add('pop');
  setTimeout(() => sendBtn?.classList.remove('pop'), 300);

  window.Capacitor?.Plugins?.Haptics?.impact({ style: 'MEDIUM' }).catch(()=>{});

  try {
    const encoded = encodeContent(text, replyToId);
    const { cipher } = await wCall({ type: 'ENCRYPT', plain: encoded });
    if (!cipher) throw new Error('Encryption returned empty ciphertext');
    const me   = 'slot_' + S.me.slot;
    const peer = 'slot_' + S.peer.slot;
    const { data, error } = await S.sb.from('messages').insert({
      sender_id: me, sender_name: S.me.name, receiver_id: peer, content: cipher,
    }).select('id,created_at').single();
    if (error) throw error;
    _replaceOptimistic(optId, data.id, data.created_at);

    // Cache the sent message
    putMessages(S.me.slot, S.peer.slot, [
      { id: data.id, text, from: 'me', time: data.created_at, readAt: null, replyTo: replyToId }
    ]).catch(() => {});
  } catch (e) {
    _removeOptimistic(optId);
    toast('Failed to send — please try again');
    console.error('[doSend]', e);
    inp.value = text;
  } finally {
    S.sendInflight = false;
    document.getElementById('send-b').disabled = !inp.value.trim();
  }
}

export async function flushOfflineQueue() {
  if (!S.offlineQueue.length || !S.me || !S.peer) return;
  const snapshot = [...S.offlineQueue];
  S.offlineQueue = [];
  const failed = [];
  for (const item of snapshot) {
    try {
      const text = typeof item === 'string' ? item : item.text;
      const replyToId = typeof item === 'string' ? null : (item.replyTo || null);
      const encoded = encodeContent(text, replyToId);
      const { cipher } = await wCall({ type: 'ENCRYPT', plain: encoded });
      if (!cipher) throw new Error('Encryption failed');
      const me   = 'slot_' + S.me.slot;
      const peer = 'slot_' + S.peer.slot;
      const { data, error } = await S.sb.from('messages').insert({
        sender_id: me, sender_name: S.me.name, receiver_id: peer, content: cipher,
      }).select('id,created_at').single();
      if (error) throw error;
      renderMsg({ id: data.id, text, from: 'me', time: data.created_at, readAt: null, replyTo: replyToId });

      putMessages(S.me.slot, S.peer.slot, [
        { id: data.id, text, from: 'me', time: data.created_at, readAt: null, replyTo: replyToId }
      ]).catch(() => {});
    } catch (e) {
      console.error('[flushOfflineQueue] failed:', e);
      failed.push(item);
    }
  }
  if (failed.length) S.offlineQueue.unshift(...failed);
  if (snapshot.length > failed.length) scrollBottom(true);
}

/* ═══════════════════════════════════════════════════════════
   RENDER MESSAGES
═══════════════════════════════════════════════════════════ */
function _appendMsgToFrag(frag, { id, text, from, time, readAt, pending, replyTo, replyText, replyFrom }) {
  if (S.renderedIds.has(id)) return;
  S.renderedIds.add(id);
  frag.appendChild(_buildMsgRow({ id, text, from, time, readAt, pending, replyTo, replyText, replyFrom }));
  S.messages.unshift({ id, time }); // older → front
}

export function renderMsg({ id, text, from, time, readAt, pending, replyTo, replyText, replyFrom }) {
  if (S.renderedIds.has(id)) return;
  S.renderedIds.add(id);
  const area = document.getElementById('msgs');
  if (!area) return;

  const dStr = new Date(time).toDateString();
  const last = S.messages[S.messages.length - 1];
  if (!last || new Date(last.time).toDateString() !== dStr) {
    const sep = document.createElement('div'); sep.className = 'dsep';
    const lbl = document.createElement('span'); lbl.className = 'dsep-lbl';
    lbl.textContent = fmtDate(time);
    sep.appendChild(lbl); area.appendChild(sep);
  }
  S.messages.push({ id, time });
  area.appendChild(_buildMsgRow({ id, text, from, time, readAt, pending, replyTo, replyText, replyFrom }));
}

function _lookupReplyText(replyToId) {
  if (!replyToId) return null;
  // Look in the rendered message bubbles
  const el = document.querySelector(`[data-mid="${replyToId}"] .bubble`);
  return el?.textContent || null;
}

function _buildMsgRow({ id, text, from, time, readAt, pending, replyTo, replyText, replyFrom }) {
  const row = document.createElement('div');
  row.className = 'msg-r ' + from;
  row.dataset.mid = id;
  const bub  = document.createElement('div');
  bub.className = 'bubble' + (pending ? ' pending' : '');

  // ── Reply quote ──
  if (replyTo) {
    const quoteWrap = document.createElement('div');
    quoteWrap.className = 'reply-quote';
    const qName = document.createElement('span');
    qName.className = 'reply-quote-name';
    qName.textContent = replyFrom || (from === 'me' ? (S.peer?.name || '') : (S.me?.name || ''));
    const qText = document.createElement('span');
    qText.className = 'reply-quote-text';
    qText.textContent = (replyText || _lookupReplyText(replyTo) || '…').slice(0, 80);
    quoteWrap.appendChild(qName);
    quoteWrap.appendChild(qText);
    quoteWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = document.querySelector(`[data-mid="${replyTo}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('msg-flash');
        setTimeout(() => target.classList.remove('msg-flash'), 1200);
      }
    });
    bub.appendChild(quoteWrap);
  }

  const textNode = document.createElement('span');
  textNode.className = 'msg-text';
  textNode.textContent = text; // textContent — XSS safe
  bub.appendChild(textNode);

  const meta = document.createElement('div'); meta.className = 'msg-meta';
  const ts   = document.createElement('span'); ts.className = 'mt';
  ts.textContent = fmtTime(time);
  meta.appendChild(ts);
  if (from === 'me') {
    const rc = document.createElement('span');
    rc.className = 'rc ' + (pending ? 'pending' : readAt ? 'read' : 'sent');
    rc.textContent = pending ? '◷' : readAt ? '✓✓' : '✓';
    rc.dataset.rc = id;
    meta.appendChild(rc);
  }
  row.appendChild(bub); row.appendChild(meta);

  // ── Long-press / double-click to reply ──
  let _longT = null;
  row.addEventListener('touchstart', () => {
    _longT = setTimeout(() => {
      window.Capacitor?.Plugins?.Haptics?.impact({ style: 'LIGHT' }).catch(()=>{});
      const senderName = from === 'me' ? S.me?.name : S.peer?.name;
      setReply(id, text, senderName);
    }, 500);
  }, { passive: true });
  row.addEventListener('touchend',    () => { clearTimeout(_longT); }, { passive: true });
  row.addEventListener('touchcancel', () => { clearTimeout(_longT); }, { passive: true });
  row.addEventListener('dblclick', () => {
    const senderName = from === 'me' ? S.me?.name : S.peer?.name;
    setReply(id, text, senderName);
  });

  return row;
}

function _replaceOptimistic(optId, realId, realTime) {
  const originalText = S.pendingTexts.get(optId) || '';
  S.pendingTexts.delete(optId);
  const el = document.querySelector(`[data-mid="${optId}"]`);
  if (!el) {
    S.renderedIds.delete(optId);
    if (originalText) renderMsg({ id: realId, text: originalText, from: 'me', time: realTime, readAt: null });
    return;
  }
  el.dataset.mid = realId;
  el.querySelector('.bubble')?.classList.remove('pending');
  const rc = el.querySelector('.rc');
  if (rc) { rc.className = 'rc sent'; rc.textContent = '✓'; rc.dataset.rc = realId; }
  const ts = el.querySelector('.mt');
  if (ts) ts.textContent = fmtTime(realTime);
  S.renderedIds.delete(optId); S.renderedIds.add(realId);
  const idx = S.messages.findIndex(m => m.id === optId);
  if (idx > -1) S.messages[idx] = { id: realId, time: realTime };
}

function _removeOptimistic(optId) {
  S.pendingTexts.delete(optId);
  document.querySelector(`[data-mid="${optId}"]`)?.remove();
  S.renderedIds.delete(optId);
  const idx = S.messages.findIndex(m => m.id === optId);
  if (idx > -1) S.messages.splice(idx, 1);
}

export function updateReceipt(id, status) {
  const el = document.querySelector(`[data-rc="${id}"]`);
  if (!el) return;
  el.className = 'rc ' + status;
  el.textContent = status === 'read' ? '✓✓' : '✓';
}

async function _markRead(ids) {
  if (!ids.length) return;
  const toMark = ids.filter(id => id && !id.startsWith('opt-'));
  if (!toMark.length) return;
  for (let i = 0; i < toMark.length; i += 50) {
    const batch = toMark.slice(i, i + 50);
    await S.sb.from('messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', batch)
      .is('read_at', null);
  }
  // Update cache
  const now = new Date().toISOString();
  for (const id of toMark) {
    markCachedRead(id, now).catch(() => {});
  }
}

/* ═══════════════════════════════════════════════════════════
   DECOY
═══════════════════════════════════════════════════════════ */
function _activateDecoy() {
  S.isDecoy = true;
  document.getElementById('decoy-bar')?.classList.add('show');
  _removeSkeleton();
  showDecryptProg(false);
  const area = document.getElementById('msgs');
  if (!area) return;
  area.innerHTML = '';
  area.style.backgroundImage = 'radial-gradient(ellipse at 50% 0%,rgba(224,92,92,.04) 0%,transparent 60%)';
  const badge = document.createElement('div'); badge.className = 'e2ee-badge';
  badge.style.cssText = 'border-color:rgba(224,92,92,.2);background:rgba(224,92,92,.04);color:#e88080;';
  badge.textContent = '⚠ Decryption failed — passphrase mismatch';
  area.appendChild(badge);
  const now = Date.now();
  DECOY.forEach((m, i) => {
    const fakeT = new Date(now - (DECOY.length - i) * 4 * 60000).toISOString();
    const row = document.createElement('div');
    row.className = 'msg-r ' + (m.s === 1 ? 'me' : 'them');
    row.style.marginBottom = '1px';
    const bub  = document.createElement('div'); bub.className = 'bubble';
    bub.textContent = m.t;
    const meta = document.createElement('div'); meta.className = 'msg-meta';
    const ts   = document.createElement('span'); ts.className = 'mt'; ts.textContent = fmtTime(fakeT);
    meta.appendChild(ts);
    if (m.s === 1) {
      const rc = document.createElement('span'); rc.className = 'rc read'; rc.textContent = '✓✓';
      meta.appendChild(rc);
    }
    row.appendChild(bub); row.appendChild(meta); area.appendChild(row);
  });
  scrollBottom(false);
}

/* ═══════════════════════════════════════════════════════════
   TYPING
═══════════════════════════════════════════════════════════ */
let _typingLastBcast = 0;

export function onInput() {
  const inp = document.getElementById('msg-inp');
  if (!inp) return;
  resizeTA(inp);
  document.getElementById('send-b').disabled = !inp.value.trim();
  const now = Date.now();
  if (!S.isTyping || now - _typingLastBcast > TYPING_THROTTLE) {
    S.isTyping = true;
    _typingLastBcast = now;
    bcastTyping(true);
  }
  clearTimeout(S.typingTimer);
  S.typingTimer = setTimeout(() => { S.isTyping = false; bcastTyping(false); }, TYPING_THROTTLE);
}

export function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
}

export function bcastTyping(on) {
  if (!_msgCh || !S.peer) return;
  if (!on && !S.isTyping && _typingLastBcast === 0) return;
  _msgCh.send({ type: 'broadcast', event: 'typing', payload: { from: 'slot_' + S.me.slot, on } });
  if (!on) { S.isTyping = false; _typingLastBcast = 0; }
}

function _receiveTyping(on) {
  _showTyping(on);
  clearTimeout(S.typingAutoHide);
  if (on) S.typingAutoHide = setTimeout(() => _showTyping(false), TYPING_TIMEOUT);
}
function _showTyping(on) {
  document.getElementById('typing-r')?.classList.toggle('show', !!on);
  if (on) scrollBottom(true);
}

/* ═══════════════════════════════════════════════════════════
   SCROLL → LOAD MORE
═══════════════════════════════════════════════════════════ */
export function initScrollPagination() {
  const area = document.getElementById('msgs');
  if (!area) return;
  area.addEventListener('scroll', async () => {
    if (area.scrollTop < 60 && S.hasMore && !S.historyLoading && !S.isDecoy && S.peer) {
      S.historyLoading = true;
      document.getElementById('page-loader')?.classList.add('show');
      const prevH = area.scrollHeight;
      await loadHistory(S.chatToken, true);
      S.historyLoading = false;
      area.scrollTop = area.scrollHeight - prevH;
      _updatePageBtn();
    }
  });
}
