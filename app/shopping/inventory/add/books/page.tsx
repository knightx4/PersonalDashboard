import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { AddBookManualForm, AddBookPasteForm, AddBookSearchForm } from '../add-book-forms';
import { BarcodeScanPanel } from '../barcode-scan';
import { PhotoCapturePanel } from '../photo-capture';

export const metadata = { title: 'Add owned books' };

const MODES = [
  { id: 'search', label: 'Search' },
  { id: 'paste', label: 'Paste list' },
  { id: 'scan', label: 'Scan barcode' },
  { id: 'photo', label: 'Shelf / cover photo' },
  { id: 'manual', label: 'By hand' },
] as const;

type Mode = (typeof MODES)[number]['id'];

function parseMode(raw: string | string[] | undefined): Mode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'paste' || value === 'scan' || value === 'photo' || value === 'manual') {
    return value;
  }
  return 'search';
}

export default async function AddOwnedBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const mode = parseMode(params.mode);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add owned books"
        description="Capture books you already own. Barcodes are sell-ready; titles and shelf photos need a confirm tap."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/shopping/inventory/add/games"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Add board games
            </Link>
            <Link
              href="/shopping/inventory/add"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Add anything else
            </Link>
          </div>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-1" aria-label="Add mode">
        {MODES.map((entry) => (
          <Link
            key={entry.id}
            href={`/shopping/inventory/add/books?mode=${entry.id}`}
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

      {mode === 'search' && <AddBookSearchForm />}
      {mode === 'paste' && <AddBookPasteForm />}
      {mode === 'scan' && <BarcodeScanPanel />}
      {mode === 'photo' && <PhotoCapturePanel />}
      {mode === 'manual' && <AddBookManualForm />}
    </div>
  );
}
