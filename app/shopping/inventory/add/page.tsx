import Link from 'next/link';
import { BookOpen, Dices } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { createClient, requireUser } from '@/lib/auth/server';
import { AddItemForm, type CategoryOption } from './add-item-form';

export const metadata = { title: 'Add new item' };

/** The flows that know more about a thing than a typed name can. */
const CATALOGUED = [
  {
    href: '/shopping/inventory/add/books',
    icon: BookOpen,
    label: 'Add books',
    hint: 'Scan a barcode, paste a list, or photograph a shelf. Sell-ready.',
  },
  {
    href: '/shopping/inventory/add/games',
    icon: Dices,
    label: 'Add board games',
    hint: 'Photograph the stack or scan a box. Editions are kept apart.',
  },
] as const;

/**
 * One way in for everything you own.
 *
 * The entry point used to be "Add owned books", which made the shelf-scanning
 * flow look like the only way anything got into the inventory. Books and board
 * games are the two things with a catalog behind them, so they keep their own
 * screens -- but they are now a choice made from here rather than the door you
 * have to walk through.
 */
export default async function AddItemPage() {
  await requireUser();
  const supabase = await createClient();

  // Same shape the inventory list's category rail uses: top level only, and
  // RLS is what decides whose categories come back.
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .is('parent_id', null)
    .order('name');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add new item"
        description="Type in anything you own, or use one of the capture flows for the things that have a catalog behind them."
        actions={
          <Link
            href="/shopping/inventory"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Back to inventory
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {/* ui-ok: card-per-row -- two choosers side by side in a grid, not a
          * scrolled list. Law 13 says cards are for exactly this. */}
        {CATALOGUED.map((entry) => (
          <Link key={entry.href} href={entry.href} className="block">
            <Card padding="dense" interactive className="h-full">
              <p className="flex items-center gap-2 text-ui font-semibold text-ink">
                <entry.icon className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
                {entry.label}
              </p>
              <p className="mt-1 text-small text-ink-muted">{entry.hint}</p>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 text-ui font-semibold text-ink">Or add it by hand</h2>
      <AddItemForm categories={(categories ?? []) as CategoryOption[]} />
    </div>
  );
}
