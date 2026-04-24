'use strict';

/**
 * Wraps a promise with a timeout to handle edge cases like Server Timeouts or Connection drops
 * where native clients (like Supabase) might hang indefinitely.
 *
 * @param {Promise} promise - The promise to wrap.
 * @param {number} ms - Timeout in milliseconds.
 * @param {string} operationName - Optional string for logging what failed.
 * @returns {Promise}
 */
export function withTimeout(promise, ms = 15000, operationName = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const err = new Error(`${operationName} timed out after ${ms}ms`);
        err.name = 'TimeoutError';
        reject(err);
      }, ms)
    )
  ]);
}

/**
 * Retries an async factory function with exponential backoff and full-jitter.
 *
 * Uses the "Full Jitter" strategy from the AWS Architecture Blog:
 *   sleep = random(0, min(cap, base * 2^attempt))
 *
 * @param {() => Promise<any>} fn    - Async factory (called fresh on each attempt).
 * @param {object}             opts
 * @param {number}             opts.maxAttempts  - Total attempts before giving up (default 3).
 * @param {number}             opts.baseDelay    - Base delay in ms (default 500).
 * @param {number}             opts.cap          - Maximum delay cap in ms (default 16000).
 * @param {string}             opts.operationName - Label for log messages.
 * @param {(err: Error, attempt: number) => boolean} opts.shouldRetry
 *   Optional predicate; return false to abort immediately (e.g. auth errors).
 * @returns {Promise<any>}
 */
export async function withRetry(fn, {
  maxAttempts  = 3,
  baseDelay    = 500,
  cap          = 16_000,
  operationName = 'Operation',
  shouldRetry   = () => true,
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const isLast = attempt === maxAttempts - 1;
      if (isLast || !shouldRetry(e, attempt)) {
        throw e;
      }
      const jitter = Math.random() * Math.min(cap, baseDelay * 2 ** attempt);
      console.warn(`[withRetry] ${operationName} failed (attempt ${attempt + 1}/${maxAttempts}), retrying in ${Math.round(jitter)}ms…`, e.message);
      await new Promise(r => setTimeout(r, jitter));
    }
  }
  throw lastErr;
}

/**
 * Returns true for errors that are worth retrying (network/timeout),
 * and false for errors that are deterministic failures (auth, constraint).
 * @param {Error} e
 */
export function isRetryable(e) {
  if (!e) return false;
  // Supabase/PostgREST network errors
  if (e.name === 'TimeoutError')        return true;
  if (e.message?.includes('fetch'))     return true;
  if (e.message?.includes('network'))   return true;
  // Supabase status codes — 5xx are server errors, retry. 4xx are client errors, don't.
  const code = Number(e.code || e.status);
  if (code >= 500 && code < 600)        return true;
  return false;
}
