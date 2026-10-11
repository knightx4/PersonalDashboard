import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { AddGameManualForm, GameSearchForm } from './game-forms';
import { GameScanPanel } from './game-scan-panel';
import { GameShelfPhotoPanel } from './game-photo-panel';
import { PoweredByBgg } from './powered-by-bgg';

export const GAME_MODES = [
  { id: 'photo', label: 'Shelf photo' },
  { id: 'scan', label: 'Scan barcode' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'By hand' },
] as const;

export type GameMode = (typeof GAME_MODES)[number]['id'];

/**
 * Add board games, drawn for the mode the page read from the address
 * (page.tsx), so the gallery can draw it too (plan #1604).
 */
export function AddGamesView({ mode }: { mode: GameMode }) {
  return (
    <div className="mx-auto max-w-3xl [&_a]:press-area">
      <PageHeader
        title="Add board games"
        description="Photograph the whole stack, scan a box, or search by name. Editions are kept apart — a base box and its expansion are different products."
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

      {mode === 'photo' && <GameShelfPhotoPanel />}
      {mode === 'scan' && <GameScanPanel />}
      {mode === 'search' && <GameSearchForm />}
      {mode === 'manual' && <AddGameManualForm />}

      <PoweredByBgg />
    </div>
  );
}
