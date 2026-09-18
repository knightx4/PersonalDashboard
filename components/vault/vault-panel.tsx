import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { RememberedVaultTree } from '@/components/vault/vault-tree-remembered';
import type { VaultFolderGroup } from '@/components/vault/vault-tree';
import { cn } from '@/lib/cn';

/**
 * The vault, as a box you can search and browse: the box at the top, the tree
 * under it, and the sentence that replaces the tree when a search matched
 * nothing.
 *
 * It exists because there are two of them. From `lg` up it is the column beside
 * an open note (#468, #557); below `lg` the same thing slides in from a button
 * on the note (#577). Written twice, the two would drift -- and the first thing
 * to drift would be `openAll`, which is why that is derived here from the
 * search rather than passed in. A search opens every folder it left a match in,
 * because a match folded out of sight has not been reached, and a sheet that
 * forgot to say so would fold its own results away.
 *
 * The tree is `RememberedVaultTree` rather than `VaultTree` for the same
 * reason: the folders you left open live in this browser's storage (#567),
 * behind one cached reader, and a second way in goes stale the first time
 * somebody folds something.
 *
 * The caller frames it -- sticky in the column, full height in the sheet -- so
 * the only layout here is the part that is the same in both: the box pinned,
 * and only the tree under it scrolling.
 */
export function VaultPanel({
  groups,
  currentPath,
  search,
  className,
}: {
  groups: VaultFolderGroup[];
  /** The note being read, so its folder opens and its row is marked. */
  currentPath: string;
  /** What the column was narrowed by, trimmed. '' is an unsearched vault. */
  search: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>
      <SearchField placeholder="Search your notes" />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {groups.length === 0 && search ? (
          <SearchEmpty query={search} className="px-3 py-8" />
        ) : (
          <RememberedVaultTree
            groups={groups}
            currentPath={currentPath}
            openAll={Boolean(search)}
          />
        )}
      </div>
    </div>
  );
}
