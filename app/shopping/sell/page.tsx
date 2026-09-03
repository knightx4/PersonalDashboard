import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { BookOpen } from 'lucide-react';
import { loadSellAssistant } from '@/lib/sell/load';
import { loadSellGames } from '@/lib/sell/load-games';
import { formatMoney } from '@/lib/money';
import { GAME_SHIP_FLAT_CENTS } from '@/lib/sell/pricing';
import {
  EstimatePricesButton,
  ImportBooksFromOrdersButton,
  SellConfirmQueue,
  SellGamePathGroup,
  SellPathGroup,
  SellSettingsForm,
  TestEbayConnectionButton,
} from './sell-ui';
import { ESTIMATE_BATCH_LIMIT } from '@/lib/sell/load';
import type { SellPath } from '@/lib/sell/route';

export const metadata = { title: 'Sell assistant' };

const PATH_ORDER: SellPath[] = [
  'list_individually',
  'buyback',
  'lot',
  'donate',
];

export default async function SellPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const {
    rows,
    pending,
    netFloorCents,
    effortCents,
    needsConfirmationCount,
    priceSource,
    unpricedCount,
  } = await loadSellAssistant({ supabase, userId: user.id });

  // Games run after the books, reusing the floor and effort the book shelf
  // settled on so both lists are measured against the same bar.
  const games = await loadSellGames({
    supabase,
    userId: user.id,
    netFloorCents,
    effortCents,
  });

  const PRICE_SOURCE_NOTE: Record<typeof priceSource, string | null> = {
    ebay_browse: 'Prices from active eBay listings (asking, not sold).',
    web_estimate:
      'Prices are web-search estimates, not eBay data — good enough to sort a shelf, not to price a rarity. They are billed per lookup, so they run only when you ask, cache for a month, and any price you type yourself wins.',
    none: 'No price source configured, so nothing can be routed yet. Set EBAY_CLIENT_ID/SECRET or ANTHROPIC_API_KEY.',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Sell assistant"
        description="Net-based routing for confirmed ISBN books. Drafts only — nothing posts without you."
        actions={
          <Link
            href="/shopping/inventory/add"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Add books
          </Link>
        }
      />

      <SellSettingsForm netFloorCents={netFloorCents} effortCents={effortCents} />

      <p className="text-sm text-ink-muted">
        Floor {formatMoney(netFloorCents)} · Effort {formatMoney(effortCents)}
        {needsConfirmationCount > 0
          ? ` · ${needsConfirmationCount} book(s) waiting on edition confirm`
          : ''}
      </p>

      {PRICE_SOURCE_NOTE[priceSource] && (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink-muted">
          {PRICE_SOURCE_NOTE[priceSource]}
        </p>
      )}

      {/* Sits under the source note because it is the note's evidence. */}
      <TestEbayConnectionButton />

      <EstimatePricesButton
        unpricedCount={unpricedCount + games.unpricedCount}
        pricedCount={Math.max(
          0,
          rows.length - unpricedCount + (games.rows.length - games.unpricedCount),
        )}
        batchLimit={ESTIMATE_BATCH_LIMIT}
        paid={priceSource === 'web_estimate'}
      />

      <ImportBooksFromOrdersButton />

      <SellConfirmQueue rows={pending} />

      {rows.length === 0 &&
      pending.length === 0 &&
      games.rows.length === 0 &&
      games.needsConfirmationCount === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nothing sell-ready yet"
          description="Books from your order emails land here automatically. You can also scan or search to add books and board games you already own."
          action={{ label: 'Add owned items', href: '/shopping/inventory/add' }}
        />
      ) : (
        <>
          {rows.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Books
              </h2>
              {PATH_ORDER.map((path) => (
                <SellPathGroup
                  key={path}
                  path={path}
                  rows={rows.filter((r) => r.path === path)}
                />
              ))}
            </section>
          )}

          {(games.rows.length > 0 || games.needsConfirmationCount > 0) && (
            <section className="space-y-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Board games
              </h2>
              <p className="text-[13px] text-ink-muted">
                Shipping is assumed flat at {formatMoney(GAME_SHIP_FLAT_CENTS)} a game, and
                there is no buyback path — nothing buys board games back the way a vendor
                buys textbooks.
                {games.needsConfirmationCount > 0 && (
                  <>
                    {' '}
                    {games.needsConfirmationCount} game(s) are still waiting on an edition
                    confirm and are not routed yet —{' '}
                    <Link
                      href="/shopping/inventory"
                      className="underline underline-offset-2 hover:text-brand"
                    >
                      confirm them in inventory
                    </Link>
                    .
                  </>
                )}
              </p>
              {PATH_ORDER.map((path) => (
                <SellGamePathGroup
                  key={path}
                  path={path}
                  rows={games.rows.filter((r) => r.path === path)}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
