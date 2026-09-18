'use client';

import { useSyncExternalStore } from 'react';
import { VaultTree, type VaultFolderGroup } from '@/components/vault/vault-tree';
import {
  openFoldersServerSnapshot,
  openFoldersSnapshot,
  rememberOpenFolder,
  subscribeToOpenFolders,
} from '@/lib/vault/open-folders';

/**
 * The vault column, opened the way you left it.
 *
 * The tree itself stays what it is -- server markup, native `<details>`, folds
 * that work before JavaScript does. This is the thin client layer over it that
 * #567 asked for: the open folders come out of the browser's own storage, and
 * go back into it on every fold through the `onToggle` that `Disclosure`
 * already takes.
 *
 * Through `useSyncExternalStore` rather than an effect, the same call
 * `components/ui/timezone-field.tsx` makes for the detected zone: the server
 * has no idea what this browser remembers, so it renders nothing remembered --
 * which is exactly the view #557 chose, the folder you are reading in and no
 * other -- and the remembered folds arrive with the script. With no script at
 * all the column simply stays that first view.
 *
 * Folding sets no state, deliberately. Nothing subscribes, so a fold re-renders
 * nothing; the `<details>` elements keep their own open state, which is the
 * only way a fold the reader just made cannot be written back over by React on
 * the next render.
 */
export function RememberedVaultTree({
  groups,
  currentPath,
  openAll = false,
  className,
}: {
  groups: VaultFolderGroup[];
  currentPath: string;
  openAll?: boolean;
  className?: string;
}) {
  const openFolders = useSyncExternalStore(
    subscribeToOpenFolders,
    openFoldersSnapshot,
    openFoldersServerSnapshot,
  );

  return (
    <VaultTree
      groups={groups}
      currentPath={currentPath}
      openAll={openAll}
      className={className}
      openFolders={openFolders}
      onToggleFolder={rememberOpenFolder}
    />
  );
}
