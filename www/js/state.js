'use strict';
import { AV_COLORS } from './config.js';

/**
 * Single shared mutable state object.
 * All modules import this same reference — mutations are visible everywhere.
 */
export const S = {
  sb:        null,   // Supabase client (set in auth.js boot())
  isDecoy:   false,

  me:   null,        // { slot, name, color }
  peer: null,        // { slot, name, color }
  theme: 'dark',

  /* ── Presence ── */
  presenceMap:  {},
  peerCache:    null,  // cached DB row for the other user

  /* ── Messages ── */
  renderedIds:  new Set(),
  messages:     [],          // [ {id, time} ] for date-sep tracking
  pendingTexts: new Map(),   // optId → original text (optimistic recovery)
  oldestCursor: null,
  hasMore:      false,
  msgQueue:     [],          // realtime msgs buffered during history load
  historyLoading: false,

  /* ── Typing ── */
  isTyping:      false,
  typingTimer:   null,       // auto-clear typing timeout handle
  typingThrottle: null,      // timestamp of last typing broadcast
  typingAutoHide: null,      // remote typing indicator hide handle

  /* ── Reply ── */
  replyTo:       null,         // { id, text, fromName } — active reply target

  /* ── Misc ── */
  presenceHB:    null,
  presenceLeaveT: {},
  chatToken:     0,          // incremented on every openChat for stale-load abort
  sendInflight:  false,
  offlineQueue:  [],
  selectedColor: AV_COLORS[0],
  rl: { attempts: 0, locked: false, until: 0, timer: null },
};
