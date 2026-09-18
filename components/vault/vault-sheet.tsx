'use client';

import { useEffect, useState } from 'react';
import { PanelLeftOpen, X } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { scrim } from '@/components/ui/popover';
import { VaultPanel } from '@/components/vault/vault-panel';
import type { VaultFolderGroup } from '@/components/vault/vault-tree';
import { cn } from '@/lib/cn';
import { noteHref } from '@/lib/vault/paths';

/**
 * Whether following this link should close the sheet.
 *
 * The rule is "a link that changes which note you are on", not "any link":
 * inside the panel there are three kinds of link, and only one of them is you
 * leaving. The tree's rows open another note and should close it -- that is
 * #577's own done-when. The cross on the search box and the way out of a search
 * that matched nothing both point at this same note with the query taken off,
 * so they clear the search in place; closing the sheet on those would throw the
 * reader out of the vault at the exact moment they asked to see all of it
 * again.
 *
 * Pure, and exported, because it is the whole of the behaviour and a sheet
 * cannot be opened in a test runner with no DOM.
 */
export function leavesThisNote(href: string | null | undefined, here: string): boolean {
  if (!href) return false;
  return href.split('#')[0]!.split('?')[0] !== here;
}

/**
 * The vault, over the note, on anything narrower than a laptop.
 *
 * The column beside the note is `hidden` below `lg` -- it would take the whole
 * width and push the note off the screen -- so below that width there was no
 * way to the next note except back to the list. This is the way: a button in
 * the note's own header row, and the same panel the column holds, slid in over
 * what you are reading with the page dimmed behind it.
 *
 * It is `components/shell/left-rail.tsx`'s shape, which is in turn the shell
 * drawer's: a trigger, a scrim that is also the button that closes it, Escape,
 * and `overflow: hidden` on the body so the note does not scroll under the
 * panel while the panel scrolls. Mounted only while open, so a shut sheet costs
 * nothing.
 *
 * Like the rail, it needs its script: with JavaScript off there is no sheet,
 * and the way to another note is the "All notes" link beside this button, which
 * is a plain link and always has been. Nothing that only exists here is lost.
 */
export function VaultSheet({
  groups,
  currentPath,
  search,
}: {
  groups: VaultFolderGroup[];
  currentPath: string;
  search: string;
}) {
  const [open, setOpen] = useState(false);
  const here = noteHref(currentPath);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0 lg:hidden')}
      >
        <PanelLeftOpen className="size-4" strokeWidth={1.75} aria-hidden />
        Browse the vault
      </button>

      {open && (
        <div className="fixed inset-0 z-overlay lg:hidden">
          <button
            type="button"
            aria-label="Close the vault"
            onClick={() => setOpen(false)}
            className={scrim}
          />
          {/* Off the left edge, where the column it stands in for sits. */}
          <aside
            aria-label="Vault"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-border bg-surface"
            // One handler rather than a callback threaded through the tree:
            // the rows are plain `<Link>`s in server markup on purpose -- see
            // components/vault/vault-tree.tsx -- and they stay that way.
            onClick={(event) => {
              const link = (event.target as Element).closest('a');
              if (leavesThisNote(link?.getAttribute('href'), here)) setOpen(false);
            }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-ui font-semibold text-ink">Vault</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="press flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
                <span className="sr-only">Close the vault</span>
              </button>
            </div>

            <VaultPanel
              groups={groups}
              currentPath={currentPath}
              search={search}
              className="p-4"
            />
          </aside>
        </div>
      )}
    </>
  );
}
