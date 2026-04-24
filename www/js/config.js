'use strict';

/* ── Supabase ── */
export const SB_URL = 'https://wgtwgmlbikrwhfrovzsb.supabase.co';
export const SB_KEY = 'sb_publishable_jYDM7NlvEggva2SWUS68oQ_GonFzH1b';

/* ── Avatar palette ── */
export const AV_COLORS = [
  '#c9963a','#e05c5c','#5cb87a','#5b8de0',
  '#a06cd5','#e0855c','#3ab8c9','#c95c8a',
];

/* ── Emoji picker ── */
export const EMOJIS = [
  '😊','😂','❤️','👍','🙏','🔥','😭','✨','💀','🫡',
  '😅','😍','😎','🥺','💯','🎉','😤','👀','🫂','💬',
  '🤝','😏','🧠','💪','🌙','⭐','🚀','💎','🎯','🤣',
  '🫶','🤙','😬','🙃','💫',
];

/* ── Pagination / limits ── */
export const PAGE_SIZE        = 40;
export const MAX_MSG          = 4000;

/* ── Crypto ── */
export const PBKDF2_ITER      = 310_000;

/* ── Rate limiting ── */
export const RL_GRACE         = 3;
export const RL_SCHED         = [5000, 15000, 45000, 120_000, 300_000];

/* ── Typing / Presence ── */
export const TYPING_THROTTLE        = 2000;
export const TYPING_TIMEOUT         = 4000;
export const PRESENCE_HEARTBEAT      = 25_000;
export const PRESENCE_LEAVE_DEBOUNCE  = 4_000;
export const PRESENCE_AWAY_TIMEOUT    = 120_000; // 2 minutes of inactivity = away

/* ── Decoy conversation ── */
export const DECOY = [
  { s:1, t:'wait… someone actually tried to get in 💀' },
  { s:2, t:'bro entered the wrong passphrase lmaooo' },
  { s:1, t:'fr imagine thinking that would work 😭' },
  { s:2, t:'the audacity to even try' },
  { s:1, t:'they\'re literally reading this right now' },
  { s:2, t:'HI BESTIE 👋 wrong key tho' },
  { s:1, t:'imagine going through all that and getting nothing' },
  { s:2, t:'ikrr the audacity is sending me 💀' },
  { s:1, t:'everything\'s locked behind AES-256 rip' },
  { s:2, t:'encrypted and completely unreachable lol' },
  { s:1, t:'must be so embarrassing fr' },
  { s:2, t:'we don\'t judge… actually we do 😌' },
  { s:1, t:'better luck next lifetime bestie 🤞' },
  { s:2, t:'go touch some grass instead of snooping 🌿' },
];
