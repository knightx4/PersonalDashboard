import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { PoweredByBgg } from './powered-by-bgg';

export const GAME_MODES = [
  { id: 'photo', label: 'Shelf photo' },
  { id: 'scan', label: 'Scan barcode' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'By hand' },
] as const;

export type GameMode = (typeof GAME_MODES)[number]['id'];

/** The Add board games page around whichever tab is open. */
export function AddGamesView({ mode, children }: { mode: GameMode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add board games"
        actions={
          <Link
            href="/shopping/inventory/add/books"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Add books instead
          </Link>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-1" aria-label="Add mode">
        {GAME_MODES.map((entry) => (
          <Link
            key={entry.id}
            href={`/shopping/inventory/add/games?mode=${entry.id}`}
            aria-current={mode === entry.id ? 'page' : undefined}
            className={buttonVariants({
              variant: mode === entry.id ? 'primary' : 'ghost',
              size: 'sm',
            })}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {children}

      <PoweredByBgg />
    </div>
  );
}
