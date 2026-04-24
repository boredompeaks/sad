'use strict';

/**
 * crypto.js — Worker bridge with health monitoring.
 * - Every wCall is guarded by a per-message timeout (default 20s).
 * - Worker crashes trigger a full respawn; queued messages get an error immediately.
 * - A PING/PONG mechanism lets the caller verify liveness before critical ops.
 */

let _worker  = null;
const _pending = new Map();
let _msgId   = 0;

// How long a single worker call is allowed to take before we abort + reject it
const WORKER_CALL_TIMEOUT_MS = 20_000;

function _spawnWorker() {
  const w = new Worker(new URL('./cipher.worker.js', import.meta.url));
  w.onmessage = ({ data: m }) => {
    const p = _pending.get(m.id);
    if (!p) return;
    // Clear the per-call timeout guard
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
    if (m.type === 'BATCH_PROGRESS') { p.onProgress?.(m.done, m.total); return; }
    _pending.delete(m.id);
    if (m.type === 'ERROR') p.rej(new Error(m.error));
    else p.res(m);
  };
  w.onerror = e => {
    console.error('[CryptoWorker] crash detected — respawning:', e);
    // Reject all in-flight calls immediately
    _pending.forEach(p => {
      if (p.timer) clearTimeout(p.timer);
      p.rej(new Error('CryptoWorker crashed'));
    });
    _pending.clear();
    _worker = null; // next wCall will auto-respawn
  };
  return w;
}

function getWorker() {
  if (!_worker) _worker = _spawnWorker();
  return _worker;
}

/** Force a full worker restart (e.g. after a key-state mismatch). */
export function restartWorker() {
  if (_worker) {
    try { _worker.terminate(); } catch (_) {}
    _pending.forEach(p => { if (p.timer) clearTimeout(p.timer); p.rej(new Error('Worker restarted')); });
    _pending.clear();
    _worker = null;
  }
  getWorker(); // spawn fresh
}

/** Warm up the worker on boot so the first crypto call is instant. */
export function initWorker() {
  getWorker();
}

/** Send a message, get a Promise back. Each call has its own timeout guard. */
export function wCall(msg, timeoutMs = WORKER_CALL_TIMEOUT_MS) {
  return new Promise((res, rej) => {
    const id = ++_msgId;
    const timer = setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        rej(new Error(`CryptoWorker call '${msg.type}' timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    _pending.set(id, { res, rej, timer });
    getWorker().postMessage({ ...msg, id });
  });
}

/** Like wCall but fires an onProgress callback for BATCH_PROGRESS events. */
export function wCallProgress(msg, onProgress, timeoutMs = WORKER_CALL_TIMEOUT_MS) {
  return new Promise((res, rej) => {
    const id = ++_msgId;
    const timer = setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        rej(new Error(`CryptoWorker batch call '${msg.type}' timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    _pending.set(id, { res, rej, timer, onProgress });
    getWorker().postMessage({ ...msg, id });
  });
}

/**
 * Sends a PING to the worker and resolves true if a PONG is received within
 * the given timeout; resolves false if the worker is unresponsive.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function pingWorker(timeoutMs = 3000) {
  try {
    const resp = await wCall({ type: 'PING' }, timeoutMs);
    return resp?.type === 'PONG';
  } catch (_) {
    return false;
  }
}

/** Expose the raw worker reference (needed by doLogout CLEAR_KEY call). */
export function getWorkerRef() { return _worker; }
