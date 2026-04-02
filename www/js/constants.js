'use strict';

/**
 * constants.js — Single source of truth for all magic strings.
 * Import from here instead of hardcoding values across modules.
 */

/* ── Slot / Identity Prefixes ── */
export const SLOT_PREFIX       = 'slot_';
export const OPTIMISTIC_PREFIX = 'opt-';

/* ── E2EE Salt Prefix ── */
export const SALT_PREFIX       = 'cipher-e2ee-v3-';

/* ── Presence Channel ── */
export const PRESENCE_CHANNEL  = 'presence';
export const CHAT_CHANNEL_PREFIX = 'chat-';
export const CHANNEL_SEPARATOR = '--';

/* ── IndexedDB ── */
export const DB_NAME           = 'cipher_cache';
export const DB_VERSION        = 1;
export const DB_STORE          = 'msgs';

/* ── Broadcast Events ── */
export const EVT_TYPING        = 'typing';

/* ── localStorage Keys ── */
export const LS_THEME          = 'cipher_theme';
