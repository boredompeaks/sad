/* cipher.worker.js — runs entirely off the main thread.
   No imports allowed in a classic Worker. Uses only Web Crypto API. */
'use strict';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function hex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
function unhex(h) {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.substr(i, 2), 16);
  return b;
}

async function pbkdf2Key(pw, salt, iters) {
  const km = await crypto.subtle.importKey(
    'raw', ENC.encode(pw), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ENC.encode(salt), iterations: iters, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function pbkdf2Hash(pw, saltBytes, iters) {
  const km = await crypto.subtle.importKey(
    'raw', ENC.encode(pw), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const k = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
    km,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign']
  );
  return hex(await crypto.subtle.exportKey('raw', k));
}

let _aesKey = null;

self.onmessage = async ({ data: msg }) => {
  const { id, type } = msg;
  try {
    // ── Health check ───────────────────────────────────────────────────────
    if (type === 'PING') {
      self.postMessage({ id, type: 'PONG' });

    } else if (type === 'CLEAR_KEY') {
      _aesKey = null;
      self.postMessage({ id, type: 'KEY_CLEARED' });

    } else if (type === 'DERIVE_KEY') {
      const { passphrase, salt, iters } = msg;
      if (!passphrase || typeof passphrase !== 'string' || !passphrase.trim())
        throw new Error('DERIVE_KEY: passphrase must be a non-empty string');
      if (!salt || typeof salt !== 'string' || salt.length < 16)
        throw new Error('DERIVE_KEY: salt must be at least 16 chars');
      const iterations = (typeof iters === 'number' && iters >= 100_000) ? iters : 310_000;
      _aesKey = await pbkdf2Key(passphrase, salt, iterations);
      self.postMessage({ id, type: 'KEY_READY' });

    } else if (type === 'HASH_PW') {
      const { password, iters } = msg;
      if (!password || typeof password !== 'string')
        throw new Error('HASH_PW: password must be a non-empty string');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await pbkdf2Hash(password, salt, iters);
      self.postMessage({ id, type: 'PW_HASH', result: iters + ':' + hex(salt.buffer) + ':' + hash });

    } else if (type === 'VERIFY_PW') {
      const { password, stored } = msg;
      if (!password || !stored) { self.postMessage({ id, type: 'PW_VERIFY', ok: false }); return; }
      const parts = stored.split(':');
      if (parts.length !== 3) { self.postMessage({ id, type: 'PW_VERIFY', ok: false }); return; }
      const iters = parseInt(parts[0], 10);
      const salt  = unhex(parts[1]);
      const hash  = parts[2];
      if (isNaN(iters) || iters < 1000 || !salt.length || !hash) {
        self.postMessage({ id, type: 'PW_VERIFY', ok: false }); return;
      }
      const got = await pbkdf2Hash(password, salt, iters);
      self.postMessage({ id, type: 'PW_VERIFY', ok: got === hash });

    } else if (type === 'ENCRYPT') {
      if (!_aesKey) {
        self.postMessage({ id, type: 'ERROR', error: 'No encryption key — please log in again' });
        return;
      }
      if (!msg.plain || typeof msg.plain !== 'string')
        throw new Error('ENCRYPT: plain must be a non-empty string');
      const iv  = crypto.getRandomValues(new Uint8Array(12));
      const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _aesKey, ENC.encode(msg.plain));
      const buf = new Uint8Array(12 + ct.byteLength);
      buf.set(iv, 0); buf.set(new Uint8Array(ct), 12);
      self.postMessage({ id, type: 'ENCRYPTED', cipher: btoa(String.fromCharCode(...buf)) });

    } else if (type === 'DECRYPT_BATCH') {
      if (!_aesKey) {
        self.postMessage({ id, type: 'ERROR', error: 'No decryption key — please log in again' });
        return;
      }
      const { messages, isExport } = msg;
      if (!Array.isArray(messages)) throw new Error('DECRYPT_BATCH: messages must be an array');
      const results = [];
      for (let i = 0; i < messages.length; i++) {
        const { id: mid, content } = messages[i];
        try {
          if (!content || typeof content !== 'string') throw new Error('Empty content');
          const buf = Uint8Array.from(atob(content), c => c.charCodeAt(0));
          if (buf.length < 13) throw new Error('Ciphertext too short');
          const pt  = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: buf.slice(0, 12) }, _aesKey, buf.slice(12)
          );
          results.push({ id: mid, plain: DEC.decode(pt) });
        } catch { results.push({ id: mid, plain: null }); }
        if (!isExport && i % 5 === 0)
          self.postMessage({ id, type: 'BATCH_PROGRESS', done: i + 1, total: messages.length });
      }
      self.postMessage({ id, type: 'BATCH_DONE', results });

    } else {
      // Unknown message type — don't silently swallow
      self.postMessage({ id, type: 'ERROR', error: `Unknown message type: ${type}` });
    }
  } catch (e) {
    self.postMessage({ id, type: 'ERROR', error: e.message || String(e) });
  }
};
