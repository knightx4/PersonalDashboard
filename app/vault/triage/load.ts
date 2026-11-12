import { after } from 'next/server';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { createCoreClient } from '@/lib/core/auth/server';
import { whenDate } from '@/lib/core/when';
import { foldQuickNoteFilesNow } from '@/lib/capture/vault';
import { inboxNoteName } from '@/lib/vault/notes/create';
import { loadInboxNotes, loadNote } from '@/lib/vault/notes/load';
import { isQuickNoteFile } from '@/lib/vault/notes/quick-notes';
import { parseQuickSections, quickSectionFingerprint } from '@/lib/vault/notes/quick-sections';
import { suggestedNotesForInbox } from '@/lib/vault/notes/related';
import { noteHref, TRIAGE_NOTE_PATH } from '@/lib/vault/paths';
import type { TriageNote } from './triage';

/** Enough of a quick note to tell two apart in a list. */
function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 180 ? `${flat.slice(0, 179)}…` : flat;
}

/**
 * The quick notes waiting in Quick note triage, one per section of that note
 * (plan #3063), newest first, each with up to three notes suggested for it
 * by meaning (plan #1729), as the triage deck draws them. Read by the
 * Vault's Now page, which triage folded into (plan #1496.9).
 *
 * Quick notes still kept as files in the Inbox from before are folded into
 * the note once the page has gone (foldQuickNoteFilesNow), and show here
 * from the next visit.
 */
export async function loadTriageNotes(
  supabase: VaultSupabaseClient,
  userId: string,
): Promise<TriageNote[]> {
  const [triage, inbox, core] = await Promise.all([
    loadNote(supabase, TRIAGE_NOTE_PATH),
    loadInboxNotes(supabase),
    createCoreClient(),
  ]);
  if (inbox.some((note) => isQuickNoteFile(note.path, note.body))) {
    after(() => foldQuickNoteFilesNow(supabase, userId));
  }
  const sections = triage ? parseQuickSections(triage.body).reverse() : [];
  if (!triage || sections.length === 0) return [];
  const suggested = await suggestedNotesForInbox(
    supabase,
    userId,
    sections.map((section) => ({ id: section.id, body: section.text })),
    { core, exclude: [triage.id] },
  );

  const href = noteHref(TRIAGE_NOTE_PATH);
  return sections.map((section) => ({
    id: section.id,
    // The section's address, which filing reads its id from.
    path: `${TRIAGE_NOTE_PATH}#${section.id}`,
    title: inboxNoteName(section.text, section.capturedAt ? new Date(section.capturedAt) : new Date()),
    body: section.text,
    // What filing checks, so a section edited since it was shown is refused.
    blobSha: quickSectionFingerprint(section.text),
    written: section.capturedAt ? whenDate(section.capturedAt, { timeZone: 'UTC' }) : null,
    href,
    excerpt: excerptOf(section.text),
    // The score is left behind: only the order says which is nearest (law 3).
    suggestions: (suggested.get(section.id) ?? []).map(({ path, title, href: to }) => ({
      path,
      title,
      href: to,
    })),
  }));
}
