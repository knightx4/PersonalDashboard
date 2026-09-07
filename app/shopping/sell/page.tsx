import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Tag } from 'lucide-react';
import { loadSellQueue } from '@/lib/sell/load-for-sale';
import { ESTIMATE_BATCH_LIMIT } from '@/lib/sell/price-run';
import { formatMoney } from '@/lib/money';
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

      <SellSettingsForm netFloorCents={netFloorCents} effortCents={effortCents} />

      <p className="text-body text-ink-muted">
        Floor {formatMoney(netFloorCents)} · Effort {formatMoney(effortCents)}
      </p>

      {PRICE_SOURCE_NOTE[priceSource] && (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-ui text-ink-muted">
          {PRICE_SOURCE_NOTE[priceSource]}
        </p>
      )}

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
