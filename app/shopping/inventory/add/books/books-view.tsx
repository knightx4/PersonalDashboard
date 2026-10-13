import Link from '@/components/ui/link';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { AddBookManualForm, AddBookPasteForm, AddBookSearchForm } from '../add-book-forms';
import { BarcodeScanPanel } from '../barcode-scan';
import { PhotoCapturePanel } from '../photo-capture';

/*
 * One word each so the row fits one line at 390 wide; nowrap and the sideways
 * scroll cover a narrower phone or larger text (plan #1779).
 */
export const BOOK_MODES = [
  { id: 'search', label: 'Search' },
  { id: 'paste', label: 'Paste' },
  { id: 'scan', label: 'Scan' },
  { id: 'photo', label: 'Photo' },
  { id: 'manual', label: 'Manual' },
] as const;

export type BookMode = (typeof BOOK_MODES)[number]['id'];

/**
 * Add owned books, drawn for the mode the page read from the address
 * (page.tsx), so the gallery can draw it too (plan #1604).
 */
export function AddBooksView({ mode }: { mode: BookMode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add owned books"
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

      <nav className="mb-6 flex gap-1 overflow-x-auto whitespace-nowrap" aria-label="Add mode">
        {BOOK_MODES.map((entry) => (
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
