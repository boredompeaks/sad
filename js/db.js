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
 *
 * Robustness:
 *   - All operations are wrapped in try/catch — IndexedDB failures are non-fatal.
 *   - pruneCache() is called after every putMessages to cap cache size.
 */

import { DB_NAME, DB_VERSION, DB_STORE as STORE, SLOT_PREFIX, CHANNEL_SEPARATOR } from './constants.js';

let _db = null;

// Maximum cached messages per conversation
const CACHE_MAX_ROWS = 200;

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
  if (!Array.isArray(messages) || !messages.length) return;
  try {
    const db  = await _open();
    const key = _convKey(meSlot, peerSlot);
    const tx  = db.transaction(STORE, 'readwrite');
    const st  = tx.objectStore(STORE);
    for (const m of messages) {
      if (!m?.id) continue; // defensive — skip malformed entries
      st.put({
        id:      m.id,
        convKey: key,
        text:    m.text   || '',
        from:    m.from   || 'them',
        time:    m.time   || new Date().toISOString(),
        readAt:  m.readAt || null,
        replyTo: m.replyTo || null,
      });
    }
    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
    // Prune after writing — fire-and-forget so it doesn't block the caller
    pruneCache(meSlot, peerSlot, CACHE_MAX_ROWS).catch(e =>
      console.warn('[db.pruneCache] failed:', e)
    );
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
  if (!id || !readAt) return;
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
   PRUNE — delete oldest entries beyond maxRows for a conversation
   Uses a cursor on by_conv_time to delete from the oldest end.
═══════════════════════════════════════════════════════════ */
export async function pruneCache(meSlot, peerSlot, maxRows = CACHE_MAX_ROWS) {
  try {
    const db  = await _open();
    const key = _convKey(meSlot, peerSlot);

    // 1 — Count existing rows for this conversation
    const countTx  = db.transaction(STORE, 'readonly');
    const countIdx = countTx.objectStore(STORE).index('by_conv_time');
    const range    = IDBKeyRange.bound([key, ''], [key, '\uffff']);
    const count    = await new Promise((res, rej) => {
      const req = countIdx.count(range);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });

    const excess = count - maxRows;
    if (excess <= 0) return; // nothing to prune

    // 2 — Open a cursor from the oldest end and delete `excess` entries
    const delTx  = db.transaction(STORE, 'readwrite');
    const delIdx = delTx.objectStore(STORE).index('by_conv_time');
    await new Promise((res, rej) => {
      let deleted = 0;
      const req = delIdx.openCursor(range, 'next');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || deleted >= excess) { res(); return; }
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    console.warn('[db.pruneCache] error:', e);
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
