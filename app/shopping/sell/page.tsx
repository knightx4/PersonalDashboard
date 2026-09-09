import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Tag } from 'lucide-react';
import { loadSellQueue } from '@/lib/sell/load-for-sale';
import { ESTIMATE_BATCH_LIMIT } from '@/lib/sell/price-run';
import { SellQueue, SellSettingsForm, TestEbayConnectionButton } from './sell-ui';

export const metadata = { title: 'Sell assistant' };

const PRICE_SOURCE_NOTE: Record<string, string | null> = {
  ebay_browse: 'Prices from active eBay listings (asking, not sold).',
  web_estimate:
    'Prices are web-search estimates, not eBay data — good enough to sort a shelf, not to price a rarity. They are billed per lookup, so they run only when you ask, cache for a month, and any price you type yourself wins.',
  none: 'No price source configured, so nothing can be priced yet. Set EBAY_CLIENT_ID/SECRET or ANTHROPIC_API_KEY.',
};

export default async function SellPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { rows, netFloorCents, effortCents, priceSource, unpricedCount } =
    await loadSellQueue({ supabase, userId: user.id });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Sell assistant"
        description="Everything you marked for sale, priced and sorted by what it nets you. Drafts only — nothing posts without you."
        actions={
          <Link
            href="/shopping/inventory"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Mark more for sale
          </Link>
        }
      />

      {/* The floor and the effort cost read as a sentence and are edited in
          it. The page used to carry both a form for them and a line printing
          them back, which is what a form standing in front of its own values
          looks like. Law 12. */}
      <SellSettingsForm netFloorCents={netFloorCents} effortCents={effortCents} />

      {/*
        Where the prices come from is ordinary explanatory copy in two of the
        three cases, and a banner only in the third — no source configured
        means nothing on this page can be priced at all, which is the page
        failing to do its job and owes the reader a claim rather than a note.
        A box around the other two was decoration on a sentence. Laws 2 and 11.
      */}
      {PRICE_SOURCE_NOTE[priceSource] &&
        (priceSource === 'none' ? (
          <Banner tone="warn">{PRICE_SOURCE_NOTE[priceSource]}</Banner>
        ) : (
          <p className="text-ui text-ink-muted">{PRICE_SOURCE_NOTE[priceSource]}</p>
        ))}

      {/* Sits under the source note because it is the note's evidence. */}
      <TestEbayConnectionButton />

      {rows.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Nothing marked for sale"
          description="Mark anything you own for sale and it lands here, whatever it is — a book, a board game, a blender. The assistant prices it and says whether listing it is worth the effort."
          action={{ label: 'Browse inventory', href: '/shopping/inventory' }}
          secondaryAction={{ label: 'Add something you own', href: '/shopping/inventory/add' }}
        />
      ) : (
        <SellQueue
          rows={rows}
          unpricedCount={unpricedCount}
          batchLimit={ESTIMATE_BATCH_LIMIT}
          paid={priceSource === 'web_estimate'}
          hasPriceSource={priceSource !== 'none'}
        />
      )}
    </div>
  );
}
