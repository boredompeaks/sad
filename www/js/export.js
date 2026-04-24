'use strict';
import { S }                     from './state.js';
import { SLOT_PREFIX }           from './constants.js';
import { wCallProgress }         from './crypto.js';
import { toast, showOverlay, hideOverlay, fmtTime, fmtDate, fmtExportDate, setDecryptProg, showDecryptProg } from './ui.js';
import { withTimeout, withRetry, isRetryable } from './utils.js';

export async function doExport() {
  if (S.isDecoy) { toast('Cannot export — wrong passphrase'); return; }
  if (!S.peer || !S.me) return;

  showOverlay('Preparing export…');
  toast('Fetching messages…');

  try {
    const me   = SLOT_PREFIX + S.me.slot;
    const peer = SLOT_PREFIX + S.peer.slot;

    // Fetch with retry for transient network failures
    const { data, error } = await withRetry(
      () => withTimeout(
        S.sb.from('messages')
          .select('id,sender_id,sender_name,content,created_at')
          .or(`and(sender_id.eq.${me},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${me})`)
          .order('created_at', { ascending: true }),
        20000, 'doExport'
      ),
      { maxAttempts: 3, operationName: 'doExport', shouldRetry: isRetryable }
    );
    if (error) throw error;

    const rows = data || [];
    if (!rows.length) { toast('No messages to export'); return; }

    // Show decryption progress
    showDecryptProg(true, `Decrypting ${rows.length} messages…`, 0);

    const { results } = await wCallProgress(
      { type: 'DECRYPT_BATCH', messages: rows.map(r => ({ id: r.id, content: r.content })), isExport: true },
      (done, total) => {
        setDecryptProg(Math.round(done / total * 100), `Decrypting ${done} / ${total}…`);
      }
    );

    showDecryptProg(false);

    const pMap = {};
    results.forEach(r => {
      if (r.plain === null) { pMap[r.id] = null; return; }
      try {
        const obj = JSON.parse(r.plain);
        if (typeof obj === 'object' && obj !== null && typeof obj.t === 'string') {
          pMap[r.id] = obj.t;
        } else {
          pMap[r.id] = r.plain;
        }
      } catch (_) {
        pMap[r.id] = r.plain;
      }
    });

    const failedCount = results.filter(r => r.plain === null).length;
    if (failedCount > 0) {
      toast(`⚠ ${failedCount} message(s) could not be decrypted and were skipped`);
    }

    const now  = new Date();
    const line = '━'.repeat(40);
    let out = `${line}\n  Cipher — Encrypted Chat Export\n`;
    out += `  Conversation: ${S.me.name} & ${S.peer.name}\n`;
    out += `  Exported: ${fmtExportDate(now)}\n${line}\n\n`;

    let lastDate = '';
    let exported = 0;
    rows.forEach(row => {
      if (pMap[row.id] === null) return; // skip failed decrypts
      const d       = new Date(row.created_at);
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      if (dateStr !== lastDate) { out += `\n── ${fmtDate(row.created_at)} ──\n\n`; lastDate = dateStr; }
      const isMe  = row.sender_id === me;
      const uname = isMe ? S.me.name : S.peer.name;
      const ts    = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const dd    = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
      out += `[${dd}, ${ts}] ${uname}: ${pMap[row.id]}\n`;
      exported++;
    });
    out += `\n${line}\n  Total messages: ${exported}`;
    if (failedCount) out += ` (${failedCount} skipped)`;
    out += `\n  This export is unencrypted. Keep it safe.\n${line}\n`;

    const blob = new Blob([out], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cipher-export-${now.getDate().toString().padStart(2,'0')}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getFullYear()}.txt`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    toast(`✓ Export downloaded — ${exported} messages`);
  } catch (e) {
    showDecryptProg(false);
    toast('Export failed'); console.error('[doExport]', e);
  } finally { hideOverlay(); }
}
