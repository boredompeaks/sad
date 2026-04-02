'use strict';

/**
 * crypto.js — Worker bridge.
 * Uses new URL('./cipher.worker.js', import.meta.url) so the path resolves
 * correctly under any Capacitor scheme (capacitor://localhost on iOS,
 * http://localhost on Android) as well as plain file:// and http://localhost.
 */

let _worker  = null;
const _pending = new Map();
let _msgId   = 0;

function getWorker() {
  if (_worker) return _worker;
  // Resolve path relative to THIS module — works under all Capacitor schemes.
  _worker = new Worker(new URL('./cipher.worker.js', import.meta.url));
  _worker.onmessage = ({ data: m }) => {
    const p = _pending.get(m.id);
    if (!p) return;
    if (m.type === 'BATCH_PROGRESS') { p.onProgress?.(m.done, m.total); return; }
    _pending.delete(m.id);
    if (m.type === 'ERROR') p.rej(new Error(m.error));
    else p.res(m);
  };
  _worker.onerror = e => {
    console.error('[CryptoWorker] crashed:', e);
    _pending.forEach(p => p.rej(e));
    _pending.clear();
    _worker = null; // next call will re-spawn
  };
  return _worker;
}

/** Warm up the worker on boot so the first crypto call is instant. */
export function initWorker() {
  getWorker();
}

/** Send a message, get a Promise back. */
export function wCall(msg) {
  return new Promise((res, rej) => {
    const id = ++_msgId;
    _pending.set(id, { res, rej });
    getWorker().postMessage({ ...msg, id });
  });
}

/** Like wCall but fires an onProgress callback for BATCH_PROGRESS events. */
export function wCallProgress(msg, onProgress) {
  return new Promise((res, rej) => {
    const id = ++_msgId;
    _pending.set(id, { res, rej, onProgress });
    getWorker().postMessage({ ...msg, id });
  });
}

/** Expose the raw worker reference (needed by doLogout CLEAR_KEY call). */
export function getWorkerRef() { return _worker; }
