import Link from 'next/link';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { folderOf, noteHref } from '@/lib/vault/paths';
import type { NoteSummary } from '@/lib/vault/notes/load';

/** One folder's worth of notes, as `groupByFolder` hands them over. */
export type VaultFolderGroup = { folder: string; notes: NoteSummary[] };

/**
 * The whole vault, grouped by folder, with one folder open.
 *
 * #557 settled what the column beside an open note shows: every folder, only
 * the one you are reading in open. So this is a tree rather than a list, and
 * the rows carry titles alone -- the excerpts the note list shows are there to
 * tell two notes apart while you are choosing; here you have already chosen,
 * and the column's job is to get you to the next one in a glance.
 *
 * Each folder is a `Disclosure`, which is a native `<details>`: the folds work
 * before JavaScript does, which is law 6 and the reason nothing here is
 * stateful. #576 hangs remembering what you left open off the `onToggle` that
 * component already takes, from a client wrapper around this one; nothing in
 * this file has to change for it.
 *
 * Headerless and width-agnostic on purpose. The note page frames it as a
 * column from `lg` up, and #577 puts the same tree inside a phone sheet.
 */
export function VaultTree({
  groups,
  currentPath,
  openAll = false,
  className,
}: {
  groups: VaultFolderGroup[];
  /** The note being read, so its folder opens and its row is marked. */
  currentPath: string;
  /**
   * Every folder open rather than just the one being read in. #557's one-open
   * rule is about the whole vault sitting there unasked for; once the column
   * has been narrowed by a search (#476) the groups *are* the answer, and a
   * match folded out of sight has not been reached.
   */
  openAll?: boolean;
  className?: string;
}) {
  const currentFolder = folderOf(currentPath);

  return (
    <nav aria-label="All notes" className={cn('space-y-0.5', className)}>
      {groups.map((group) => {
        const reading = group.folder === currentFolder;

        return (
          <Disclosure
            key={group.folder || '(root)'}
            defaultOpen={openAll || reading}
            // Law 10's second half: the shut line says whether opening it is
            // worth it, and for a folder that is how much is inside.
            meta={group.notes.length}
            title={
              <span className={cn('truncate', reading && 'text-accent')}>
                {group.folder || 'Vault root'}
                {/* The tint is the mark for anyone who can see it; this is the
                    same fact for anyone who cannot. */}
                {reading && <span className="sr-only"> (the folder you are reading in)</span>}
              </span>
            }
          >
            <ul className="space-y-0.5">
              {group.notes.map((note) => {
                const open = note.path === currentPath;

                return (
                  <li key={note.id}>
                    <Link
                      href={noteHref(note.path)}
                      aria-current={open ? 'page' : undefined}
                      title={note.title}
                      className={cn(
                        'block truncate rounded-lg px-2 py-1 text-ui transition-colors duration-150',
                        open
                          ? 'bg-accent-tint font-medium text-accent'
                          : 'text-ink-muted hover:bg-sunken hover:text-ink',
                      )}
                    >
                      {note.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Disclosure>
        );
      })}
    </nav>
  );
}
