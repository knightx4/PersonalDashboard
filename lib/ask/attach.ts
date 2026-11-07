import { attachmentHref } from '@/lib/attachments/rules';
import { fileHref } from '@/lib/files/files';
import { attachedNote, attachTarget, type SavedAttachment } from '@/lib/talk/attached';
import type { AskContext, AskToolResult } from './db';

/**
 * attach_saved (plan #3050.4; lib/talk/attached.ts): reads the page or file
 * a bot named, as the person and filtered to them as well, and keeps a card
 * for it as the call's result. A row that is not theirs, archived or gone is
 * not found, and the bot is told so.
 */
export async function attachSavedLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const target = attachTarget(input);
  if (!target) {
    return { ok: false, error: 'Give table core.files or core.attachments and the ref a lookup returned for the row.' };
  }
  const core = await ctx.db('core');
  let card: SavedAttachment | null = null;
  if (target.table === 'core.files') {
    const { data, error } = await core
      .from('files')
      .select('id, title, format')
      .eq('user_id', ctx.userId)
      .eq('id', target.id)
      .is('archived_at', null)
      .limit(1);
    if (error) throw new Error(`attach_saved: ${error.message}`);
    const row = ((data ?? []) as { id: string; title: string | null; format: string | null }[])[0];
    if (row) {
      card = {
        table: 'core.files',
        id: row.id,
        title: row.title?.trim() || 'Untitled page',
        kind: row.format === 'html' ? 'page' : 'writing',
        href: fileHref(row.id),
      };
    }
  } else {
    const { data, error } = await core
      .from('attachments')
      .select('id, name, content_type, size_bytes')
      .eq('user_id', ctx.userId)
      .eq('id', target.id)
      .limit(1);
    if (error) throw new Error(`attach_saved: ${error.message}`);
    const row = ((data ?? []) as { id: string; name: string; content_type: string; size_bytes: number }[])[0];
    if (row) {
      card = {
        table: 'core.attachments',
        id: row.id,
        title: row.name,
        kind: 'file',
        href: attachmentHref(row.id),
        contentType: row.content_type,
        size: Number(row.size_bytes),
      };
    }
  }
  if (!card) return { ok: false, error: `No ${target.table === 'core.files' ? 'page or file' : 'file'} of theirs has that ref. Find it with search first.` };
  return { ok: true, rows: [], note: attachedNote(card), kept: { attached: card } };
}
