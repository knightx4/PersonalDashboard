import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { NoteBody } from '@/components/vault/note-body';
import { NoteProperties } from '@/components/vault/note-properties';
import { RememberedVaultTree } from '@/components/vault/vault-tree-remembered';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { createVaultClient } from '@/lib/vault/auth/server';
import { groupByFolder, loadLinkTargets, loadNote, loadNotes } from '@/lib/vault/notes/load';
import { buildLinkIndex, toStandardMarkdown } from '@/lib/vault/markdown/obsidian';
import { folderOf, noteHref } from '@/lib/vault/paths';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { loadTasksFor } from '@/lib/todo/links/load';

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
  // and the notes are what the column lists, which inherits the note list's
  // first 500 by path; that cap is filed as an idea of its own. A search
  // narrows that second read and nothing else: the wikilinks in the note you
  // are reading still have to resolve against the whole vault.
  const [targets, notes] = await Promise.all([
    loadLinkTargets(supabase),
    loadNotes(supabase, search ? { search } : {}),
  ]);
  const index = buildLinkIndex(targets);
  const markdown = toStandardMarkdown(note.body, { index, hrefFor: noteHref });

  const groups = groupByFolder(notes);
  const folder = folderOf(note.path);

  const user = await requireUser();
  const [{ timezone }, linkedTasks] = await Promise.all([
    loadAccountSettings(user.id),
    loadTasksFor(user.id, 'note', note.id),
  ]);

  return (
    <div className="flex gap-8">
      {/* Hidden below lg rather than stacked above the note: a phone gets the
          same tree from a sheet instead, which is #577. An empty vault keeps
          the column away entirely; a search that matched nothing must not, or
          the box that got you there would go with it. */}
      {(groups.length > 0 || search) && (
        <aside aria-label="Vault" className="hidden w-60 shrink-0 lg:block">
          {/* At the offset the filter rail uses. The box is pinned and only the
              tree under it scrolls: a vault taller than the viewport must not
              make either the search or the bottom of the note reachable only by
              scrolling past a thousand titles. */}
          <div className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col gap-3">
            <SearchField placeholder="Search your notes" />

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {groups.length === 0 && search ? (
                <SearchEmpty query={search} className="px-3 py-8" />
              ) : (
                // Searching opens every folder it left in the column: a match
                // folded out of sight has not been reached. Anything else the
                // reader left open is opened on top of that, never instead of
                // it (#576).
                <RememberedVaultTree
                  groups={groups}
                  currentPath={note.path}
                  openAll={Boolean(search)}
                />
              )}
            </div>
          </div>
        </aside>
      )}

      <article className="mx-auto min-w-0 max-w-3xl flex-1">
        <Link
          href="/vault"
          className="mb-4 inline-flex items-center gap-1 text-ui font-medium text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
          All notes
        </Link>

        <header className="mb-5">
          <h1 className="font-display text-title font-semibold tracking-tight text-ink">
            {note.title}
          </h1>
          <p className="mt-1 text-ui text-ink-muted">
            {folder ? `${folder}/` : 'Vault root'}
            {note.gitUpdatedAt && <> · updated {formatDay(note.gitUpdatedAt)}</>}
          </p>
        </header>

        <NoteProperties frontmatter={note.frontmatter} />

        <NoteBody markdown={markdown} />

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
      </article>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
