import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { AddGameManualForm, GameSearchForm } from './game-forms';
import { GameScanPanel } from './game-scan-panel';
import { GameShelfPhotoPanel } from './game-photo-panel';

export const metadata = { title: 'Add board games' };

/**
 * Reading forty boxes out of one photo, then looking each one up, runs well
 * past a default serverless limit. Server actions invoked from this page
 * inherit this ceiling.
 */
export const maxDuration = 300;

const MODES = [
  { id: 'photo', label: 'Shelf photo' },
  { id: 'scan', label: 'Scan barcode' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'By hand' },
] as const;

type Mode = (typeof MODES)[number]['id'];

function parseMode(raw: string | string[] | undefined): Mode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'scan' || value === 'search' || value === 'manual') return value;
  return 'photo';
}

export default async function AddGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireUser();
  const mode = parseMode((await searchParams).mode);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add board games"
        description="Photograph the whole stack, scan a box, or search by name. Editions are kept apart — a base box and its expansion are different products."
        actions={
          <Link
            href="/inventory/add"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Add books instead
          </Link>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-1" aria-label="Add mode">
        {MODES.map((entry) => (
          <Link
            key={entry.id}
            href={`/inventory/add/games?mode=${entry.id}`}
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
    </div>
  );
}
