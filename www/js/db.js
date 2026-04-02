'use strict';

/**
 * db.js — IndexedDB offline cache for decrypted messages.
 *
 * Stores messages after successful decryption so the user can review
 * conversations immediately on app open without waiting for network.
 *
 * DB schema:
 *   Store "msgs" — keyPath: "id"
 *     Fields: id, convKey, text, from, time, readAt, replyTo
 *     Index:  "by_conv_time" on [convKey, time]
 *
 * convKey = sorted pair like "slot_1--slot_2"
 */

import { DB_NAME, DB_VERSION, DB_STORE as STORE, SLOT_PREFIX, CHANNEL_SEPARATOR } from './constants.js';

let _db = null;

/* ═══════════════════════════════════════════════════════════
   OPEN / INIT
═══════════════════════════════════════════════════════════ */
function _open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by_conv_time', ['convKey', 'time'], { unique: false });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror   = () => { reject(req.error); };
    } catch (e) {
      reject(e);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function _convKey(meSlot, peerSlot) {
  return [SLOT_PREFIX + meSlot, SLOT_PREFIX + peerSlot].sort().join(CHANNEL_SEPARATOR);
}

/* ═══════════════════════════════════════════════════════════
   PUT — bulk upsert decrypted messages
═══════════════════════════════════════════════════════════ */
export async function putMessages(meSlot, peerSlot, messages) {
  try {
    const db  = await _open();
    const key = _convKey(meSlot, peerSlot);
    const tx  = db.transaction(STORE, 'readwrite');
    const st  = tx.objectStore(STORE);
    for (const m of messages) {
      st.put({
        id:      m.id,
        convKey: key,
        text:    m.text,
        from:    m.from,
        time:    m.time,
        readAt:  m.readAt || null,
        replyTo: m.replyTo || null,
      });
    }
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('[db.putMessages] failed:', e);
  }
}

/* ═══════════════════════════════════════════════════════════
   GET — retrieve cached messages for a conversation, ordered
═══════════════════════════════════════════════════════════ */
export async function getMessages(meSlot, peerSlot) {
  try {
    const db    = await _open();
    const key   = _convKey(meSlot, peerSlot);
    const tx    = db.transaction(STORE, 'readonly');
    const idx   = tx.objectStore(STORE).index('by_conv_time');
    const range = IDBKeyRange.bound([key, ''], [key, '\uffff']);
    const req   = idx.getAll(range);
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  } catch (e) {
    console.warn('[db.getMessages] failed:', e);
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════
   UPDATE READ STATUS — mark a message as read in the cache
═══════════════════════════════════════════════════════════ */
export async function markCachedRead(id, readAt) {
  try {
    const db = await _open();
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const req = st.get(id);
    req.onsuccess = () => {
      const row = req.result;
      if (row) { row.readAt = readAt; st.put(row); }
    };
  } catch (e) {
    console.warn('[db.markCachedRead] failed:', e);
  }
}

/* ═══════════════════════════════════════════════════════════
   CLEAR — wipe all cached data (on logout)
═══════════════════════════════════════════════════════════ */
export async function clearCache() {
  try {
    const db = await _open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('[db.clearCache] failed:', e);
  }
}
