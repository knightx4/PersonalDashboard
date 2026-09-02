import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { NoteBody } from '@/components/vault/note-body';
import { NoteProperties } from '@/components/vault/note-properties';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadLinkTargets, loadNote } from '@/lib/vault/notes/load';
import { buildLinkIndex, toStandardMarkdown } from '@/lib/vault/markdown/obsidian';
import { folderOf } from '@/lib/vault/paths';

export const dynamic = 'force-dynamic';

function hrefForNote(path: string): string {
  return `/vault/n/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * One note.
 *
 * The path arrives as a catch-all segment because vault paths have slashes in
 * them and are the note's real identity -- there is no id in the URL, so a
 * link from one note to another can be built from the vault's own text without
 * a lookup.
 */
export default async function NotePage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const path = segments.map(decodeURIComponent).join('/');

  const supabase = await createVaultClient();
  const note = await loadNote(supabase, path);
  if (!note) notFound();

  // Titles and paths only -- rendering one note must not load the text of
  // every other one.
  const index = buildLinkIndex(await loadLinkTargets(supabase));
  const markdown = toStandardMarkdown(note.body, { index, hrefFor: hrefForNote });

  const folder = folderOf(note.path);

  return (
    <article className="mx-auto max-w-3xl">
      <Link
        href="/vault"
        className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
        All notes
      </Link>

      <header className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {note.title}
        </h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {folder ? `${folder}/` : 'Vault root'}
          {note.gitUpdatedAt && <> · updated {formatDay(note.gitUpdatedAt)}</>}
        </p>
      </header>

      <NoteProperties frontmatter={note.frontmatter} />

      <NoteBody markdown={markdown} />
    </article>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
