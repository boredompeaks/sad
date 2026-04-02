'use strict';
import { S }                     from './state.js';
import { SLOT_PREFIX }           from './constants.js';
import { wCallProgress }         from './crypto.js';
import { toast, showOverlay, hideOverlay, fmtTime, fmtDate, fmtExportDate } from './ui.js';

export async function doExport() {
  if (S.isDecoy) { toast('Cannot export — wrong passphrase'); return; }
  if (!S.peer || !S.me) return;
  toast('Preparing export…');
  showOverlay('Exporting conversation…');
  try {
    const me   = SLOT_PREFIX + S.me.slot;
    const peer = SLOT_PREFIX + S.peer.slot;
    const { data, error } = await S.sb.from('messages')
      .select('id,sender_id,sender_name,content,created_at')
      .or(`and(sender_id.eq.${me},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${me})`)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { toast('No messages to export'); return; }

    const { results } = await wCallProgress(
      { type: 'DECRYPT_BATCH', messages: rows.map(r => ({ id: r.id, content: r.content })), isExport: true },
      () => { }
    );
    const pMap = {};
    results.forEach(r => {
      if (r.plain === null) { pMap[r.id] = null; return; }
      // Decode JSON content format (reply-to support)
      try {
        const obj = JSON.parse(r.plain);
        if (typeof obj === 'object' && obj !== null && typeof obj.t === 'string') {
          pMap[r.id] = obj.t;
        } else {
          pMap[r.id] = r.plain;
        }
      } catch (_) {
        pMap[r.id] = r.plain; // legacy raw text
      }
    });
    if (results.some(r => r.plain === null)) { toast('Some messages could not be decrypted'); return; }

    const now  = new Date();
    const line = '━'.repeat(40);
    let out = `${line}\n  Cipher — Encrypted Chat Export\n`;
    out += `  Conversation: ${S.me.name} & ${S.peer.name}\n`;
    out += `  Exported: ${fmtExportDate(now)}\n${line}\n\n`;

    let lastDate = '';
    rows.forEach(row => {
      const d       = new Date(row.created_at);
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      if (dateStr !== lastDate) { out += `\n── ${fmtDate(row.created_at)} ──\n\n`; lastDate = dateStr; }
      const isMe  = row.sender_id === me;
      const uname = isMe ? S.me.name : S.peer.name;
      const ts    = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const dd    = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
      out += `[${dd}, ${ts}] ${uname}: ${pMap[row.id]}\n`;
    });
    out += `\n${line}\n  Total messages: ${rows.length}\n  This export is unencrypted. Keep it safe.\n${line}\n`;

    const blob = new Blob([out], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cipher-export-${now.getDate().toString().padStart(2,'0')}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getFullYear()}.txt`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    toast('Export downloaded');
  } catch (e) {
    toast('Export failed'); console.error('[doExport]', e);
  } finally { hideOverlay(); }
}
