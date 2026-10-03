import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { NoteBody } from '@/components/vault/note-body';
import { NoteProperties } from '@/components/vault/note-properties';
import {
  FoldNoteListButton,
  NoteListColumn,
  NoteListFold,
  UnfoldNoteListButton,
} from '@/components/vault/note-list-fold';
import { VaultPanel } from '@/components/vault/vault-panel';
import { VaultSheet } from '@/components/vault/vault-sheet';
import { createVaultClient } from '@/lib/vault/auth/server';
import {
  groupByFolder,
  loadAttachments,
  loadLinkTargets,
  loadNote,
  loadNotes,
} from '@/lib/vault/notes/load';
import { buildAttachmentIndex } from '@/lib/vault/markdown/attachments';
import { buildLinkIndex, toStandardMarkdown } from '@/lib/vault/markdown/obsidian';
import { folderOf, noteHref } from '@/lib/vault/paths';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { loadTasksFor } from '@/lib/todo/links/load';
import { whyNotRead } from '@/lib/vault/map/rules';
import { loadNoteThread } from '@/lib/vault/maya/store';
import { Thread } from '@/components/thread/thread';
import type { DevComment } from '@/lib/comments/load';
import { loadThread } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import { MapReview } from './map-review';
import { MayaAsk } from './maya-ask';
import { NoteEdit } from './note-edit';

export const dynamic = 'force-dynamic';

/**
 * One note.
 *
 * The path arrives as a catch-all segment because vault paths have slashes in
 * them and are the note's real identity -- there is no id in the URL, so a
 * link from one note to another can be built from the vault's own text without
 * a lookup.
 *
 * The vault itself sits beside the note from `lg` up, as #468 and #557 settled:
 * every folder, only the one you are reading in open, so the next note is one
 * click away rather than a trip back to the list. Any other folder you left
 * open comes back open too, out of the browser you are reading in and nowhere
 * else, which is #567's answer. It is drawn here rather than in
 * `app/vault/layout.tsx` because a layout cannot read the address bar, and the
 * search box at the top of the column has to.
 *
 * That box is #468's answer to searching the vault while reading a note: it
 * narrows the column in place, against the same full-text index the note list
 * searches, so finding another note never costs you the one in front of you.
 * The query is `q` on this note's own URL, so a narrowed column is a link and
 * the search survives the back button; the note itself is not touched by it.
 *
 * Below `lg` there is no room for a column beside the note, so the same panel
 * slides in over it from a button in the header row (#577). Column and sheet
 * are one component, `components/vault/vault-panel.tsx`, so the search and the
 * folds behave the same at both widths.
 *
 * On a laptop the column can be folded away so the note has the width (#1380):
 * a button beside the search box hides it, and one in the header row brings it
 * back, in the spot the phone's sheet button takes below `lg`. The pieces are
 * in `components/vault/note-list-fold.tsx`. The fold is kept in this browser
 * (#1381), so it lasts from note to note and through a reload; a note opened
 * with a search in the address shows the list for that view regardless.
 */
export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ path: segments }, { q }] = await Promise.all([params, searchParams]);
  const path = segments.map(decodeURIComponent).join('/');
  const search = q?.trim() ?? '';

  const supabase = await createVaultClient();
  const note = await loadNote(supabase, path);
  if (!note) notFound();

  // Two reads of the vault index, together rather than one after the other.
  // The link targets are every note's path and title and deliberately no
  // bodies -- rendering one note must not load the text of every other one --
  // and the notes are what the column lists: every note in the vault, the
  // same list the Vault page shows. A search
  // narrows that second read and nothing else: the wikilinks in the note you
  // are reading still have to resolve against the whole vault.
  // The attachment rows come with them: an embedded image or recording is
  // resolved by name the way a wikilink is, so it needs the vault's list.
  const [targets, notes, attachments] = await Promise.all([
    loadLinkTargets(supabase),
    loadNotes(supabase, search ? { search } : {}),
    loadAttachments(supabase),
  ]);
  const index = buildLinkIndex(targets);
  const markdown = toStandardMarkdown(note.body, { index, hrefFor: noteHref });

  const groups = groupByFolder(notes);
  const folder = folderOf(note.path);

  // An empty vault keeps the column and the button away entirely; a search that
  // matched nothing must not, or the box that got you there would go with it.
  const hasVault = groups.length > 0 || Boolean(search);
  const notRead = whyNotRead(note);

  const user = await requireUser();
  const [{ timezone }, linkedTasks, mayaThread, comments] = await Promise.all([
    loadAccountSettings(user.id),
    loadTasksFor(user.id, 'note', note.id),
    notRead ? null : loadNoteThread(supabase, note.id),
    // A failed read leaves the thread empty rather than the page broken.
    loadThread(supabase, threadRef('vault_note', note.id), { userId: user.id }).catch(
      (): DevComment[] => [],
    ),
  ]);

  return (
    <NoteListFold notePath={note.path} search={search}>
      {/* Hidden below lg rather than stacked above the note: at that width the
          same panel arrives as a sheet instead, from the button beside "All
          notes" below. */}
      {hasVault && (
        <NoteListColumn>
          {/* At the offset the filter rail uses. The box is pinned and only the
              tree under it scrolls: a vault taller than the viewport must not
              make either the search or the bottom of the note reachable only by
              scrolling past a thousand titles. */}
          <div className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col">
            <VaultPanel
              groups={groups}
              currentPath={note.path}
              search={search}
              beside={<FoldNoteListButton />}
            />
          </div>
        </NoteListColumn>
      )}

      {/* Folded, the note takes the column's width and the gap beside it:
          15rem and 2rem on top of max-w-3xl's 48rem is max-w-5xl. */}
      <article className="mx-auto min-w-0 max-w-3xl flex-1 group-data-[folded=true]/note:max-w-5xl">
        {/* The way back, and -- below lg, where the column is not drawn -- the
            way into the same vault without leaving the note (#577). From lg up
            the same spot holds the way back to a folded column (#1380). */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            href="/vault"
            className="inline-flex items-center gap-1 text-ui font-medium text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
            All notes
          </Link>

          {hasVault && (
            <>
              <VaultSheet groups={groups} currentPath={note.path} search={search} />
              <UnfoldNoteListButton />
            </>
          )}
        </div>

        {/* Edit swaps the rendered body for a text box in the same place
            (#1425); the title and properties stay, since a save keeps the
            frontmatter it opened with. */}
        <NoteEdit
          notePath={note.path}
          body={note.body}
          blobSha={note.blobSha}
          heading={
            <header>
              <h1 className="font-display text-title font-semibold tracking-tight text-ink">
                {note.title}
              </h1>
              <p className="mt-1 text-ui text-ink-muted">
                {folder ? `${folder}/` : 'Vault root'}
                {note.gitUpdatedAt && <> · updated {formatDay(note.gitUpdatedAt)}</>}
              </p>
            </header>
          }
          properties={<NoteProperties frontmatter={note.frontmatter} />}
        >
          <NoteBody
            markdown={markdown}
            notePath={note.path}
            attachments={buildAttachmentIndex(attachments)}
          />
        </NoteEdit>

        {/* Tasks ABOUT this note, which is not the same thing as the checkboxes
          inside it -- those belong to Obsidian and are not read here at all.
          This is the half of the integration that costs nothing: a note is a
          row with an id, and a task can point at it. */}
        <div className="mt-8">
          <LinkedTasks
            target="note"
            targetId={note.id}
            returnTo={noteHref(note.path)}
            tasks={linkedTasks}
            timezone={timezone}
          />
        </div>

        {/* Notes on the note, kept in the app rather than written into the
            vault (plan #1471). One tagged @dash is answered from the note,
            unless the map turns the note away, when Dash says so instead. */}
        <section aria-label="Comments" className="mt-8">
          <Thread
            subject={threadRef('vault_note', note.id)}
            turns={comments}
            placeholder="A note on this note, or a question for Dash."
          />
        </section>

        {/* Reading the note for the map (#763). A note the map never reads --
            a journal, or one carrying what looks like a key -- says so in the
            button's place rather than offering a press that can only refuse,
            and nothing about it is sent to find that out. */}
        {notRead ? (
          <p className="mt-10 text-ui text-ink-muted">{notRead.detail}</p>
        ) : (
          <>
            {/* Maya reads what the map reads and nothing else (#1285): a note
                the map turns away shows no way to ask either. */}
            <MayaAsk notePath={note.path} thread={mayaThread} />
            <MapReview notePath={note.path} />
          </>
        )}
      </article>
    </NoteListFold>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
