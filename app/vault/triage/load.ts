import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { createCoreClient } from '@/lib/core/auth/server';
import { whenDate } from '@/lib/core/when';
import { loadInboxNotes } from '@/lib/vault/notes/load';
import { suggestedNotesForInbox } from '@/lib/vault/notes/related';
import { noteHref } from '@/lib/vault/paths';
import type { TriageNote } from './triage';

/**
 * The quick notes waiting in the vault's Inbox folder, each with up to three
 * notes suggested for it by meaning (plan #1729), as the triage deck draws
 * them. Read by the Vault's Now page, which triage folded into (plan #1496.9).
 */
export async function loadTriageNotes(
  supabase: VaultSupabaseClient,
  userId: string,
): Promise<TriageNote[]> {
  const [inbox, core] = await Promise.all([loadInboxNotes(supabase), createCoreClient()]);
  if (inbox.length === 0) return [];
  const suggested = await suggestedNotesForInbox(supabase, userId, inbox, { core });

  return inbox.map((note) => ({
    id: note.id,
    path: note.path,
    title: note.title,
    body: note.body,
    blobSha: note.blobSha,
    written: note.gitUpdatedAt ? whenDate(note.gitUpdatedAt, { timeZone: 'UTC' }) : null,
    href: noteHref(note.path),
    excerpt: note.excerpt,
    // The score is left behind: only the order says which is nearest (law 3).
    suggestions: (suggested.get(note.id) ?? []).map(({ path, title, href }) => ({
      path,
      title,
      href,
    })),
  }));
}
