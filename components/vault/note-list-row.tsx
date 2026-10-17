import Link from '@/components/ui/link';
import { MoveLabel } from '@/components/ui/move-label';
import { rowRef, workingMove } from '@/lib/core/move';

/**
 * One note in the vault's list: its title, and its first line under it.
 *
 * While a run or an Ask Dash hand-off is about the note (plan #1964.2.2), Dash's
 * mark leads the line under the title, as it does on a return or a reading. A
 * goal's context names a note by its path rather than its id, so both are
 * checked.
 */
export function NoteListRow({
  note,
  working: running,
}: {
  note: { id: string; path: string; title: string; excerpt: string | null };
  /** The refs a run or hand-off is about; left out, none. */
  working?: readonly string[];
}) {
  const working = workingMove(running, [rowRef('obsidian.notes', note.id), rowRef('obsidian.notes', note.path)]);

  return (
    <li>
      <Link
        href={`/vault/n/${note.path.split('/').map(encodeURIComponent).join('/')}`}
        className="block px-4 py-3 transition-colors duration-quick hover:bg-canvas"
      >
        <span className="block text-body font-medium text-ink">{note.title}</span>
        {(working || note.excerpt) && (
          <span className="mt-0.5 flex items-center gap-3">
            {working && <MoveLabel move={working.move} title={working.title} className="shrink-0" />}
            {note.excerpt && <span className="min-w-0 flex-1 truncate text-ui text-ink-muted">{note.excerpt}</span>}
          </span>
        )}
      </Link>
    </li>
  );
}
