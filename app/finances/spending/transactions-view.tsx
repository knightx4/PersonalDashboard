import { ReceiptText } from 'lucide-react';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { PageWide } from '@/components/shell/page-width';
import { TabbedSections } from '@/components/patterns/tabbed-sections';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Figure } from '@/components/ui/figure';
import { Meter } from '@/components/ui/meter';
import { ChargeRow } from '@/components/finances/charge-row';
import { MerchantList } from '@/components/finances/merchant-list';
import { MonthFlowChart } from '@/components/finances/month-flow-chart';
import type { TransactionSpending } from '@/lib/finances/spending/model';
import { formatMoney, labelForPreset, type PresetRange } from '@/lib/money';
import type { Tab } from '@/lib/tabs';

/**
 * Spending from bank and card transactions (plan #2593.7): what the period
 * cost after refunds, with card payments and own-account transfers left out
 * and said so, then four tabs. Each month shows money in against money
 * spent for the year; Categories and Merchants split the period; Charges
 * lists its largest, each opening its order when one is tied to it.
 *
 * Presentational, so the gallery draws it from fixtures; page.tsx reads the
 * data and decides the open tab.
 */

export const SPENDING_TABS: readonly Tab[] = [
  { id: 'months', label: 'Each month' },
  { id: 'categories', label: 'Categories' },
  { id: 'merchants', label: 'Merchants' },
  { id: 'charges', label: 'Largest charges' },
];

/** The ranges the rail offers, as the orders view has them (lib/dashboard/load.ts, which is server-only). */
const RANGES: readonly PresetRange[] = ['this_month', 'last_month', 'last_3_months', 'ytd', 'last_12_months'];

export type SpendingTab = 'months' | 'categories' | 'merchants' | 'charges';

function rangeHref(range: PresetRange, tab: SpendingTab): string {
  const params = new URLSearchParams({ range });
  if (tab !== 'months') params.set('tab', tab);
  return `/finances/spending?${params.toString()}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function TransactionsSpendingView({
  range,
  tab,
  data,
  currency = 'USD',
  heldMonth,
  openMerchant,
  dashToday,
}: {
  range: PresetRange;
  tab: SpendingTab;
  data: TransactionSpending;
  currency?: string;
  /** For the gallery: a month held in the chart's readout. */
  heldMonth?: string;
  /** For the gallery: a merchant drawn with its charges open. */
  openMerchant?: string;
  dashToday?: React.ReactNode;
}) {
  const money = (cents: number) => formatMoney(cents, currency);
  const caption = [
    data.refundCents > 0
      ? `${money(data.outCents)} out, less ${money(data.refundCents)} refunded`
      : `${money(data.outCents)} out`,
    data.internalCount > 0
      ? `${plural(data.internalCount, 'card payment or transfer', 'card payments and transfers')} between your accounts (${money(
          data.internalCents,
        )}) not counted`
      : null,
  ]
    .filter(Boolean)
    .join('. ');

  const empty = data.chargeCount === 0 && data.refundCents === 0;
  // Nothing moved at all in the period: the card would be all zeros.
  const still = empty && data.inCents === 0 && data.internalCount === 0;

  return (
    <PageWide className="flex flex-col gap-6 xl:flex-row [&_a]:press-area">
      <LeftRail>
        <RailGroup label="Time range">
          {RANGES.map((id) => (
            <RailItem
              key={id}
              label={labelForPreset(id)}
              active={id === range}
              quiet={id === 'this_month'}
              href={rangeHref(id, tab)}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1 space-y-4">
        <PageHeader title="Spending" />

        {/* A period with nothing charged shows the empty state alone, not a card of zeros. */}
        {!still && (
          <Card padding="standard">
            <Figure
              label={`Spent, ${labelForPreset(range).toLowerCase()}`}
              value={money(data.spentCents)}
              caption={caption}
              secondary={[
                { value: money(data.inCents), label: 'came in' },
                {
                  value: plural(data.chargeCount, 'charge', 'charges'),
                  label:
                    data.matchedCount > 0
                      ? `${data.matchedCount} tied to an order`
                      : 'none tied to an order',
                },
              ]}
            />
          </Card>
        )}

        <TabbedSections tabs={SPENDING_TABS} label="Spending">
          {tab === 'months' && <MonthFlowChart months={data.months} currency={currency} heldMonth={heldMonth} />}

          {tab !== 'months' && empty && (
            <EmptyState
              size="box"
              icon={ReceiptText}
              title="No charges in this period"
              description="Nothing was charged to your accounts in this range. Pick a longer range on the left."
            />
          )}

          {tab === 'categories' && !empty && (
            <Card padding="none">
              <ul className="divide-y divide-border">
                {data.categories.map((slice) => (
                  <li key={slice.label} className="px-4 py-3">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="truncate text-body font-medium text-ink">{slice.label}</span>
                      <span className="tabular shrink-0 text-body text-ink">{money(slice.cents)}</span>
                    </div>
                    {/* Ink, not the accent: green on this page reads as money back. */}
                    <Meter
                      fill="bg-ink-muted"
                      value={slice.cents}
                      max={data.categories[0].cents}
                      label={`${slice.label}: ${money(slice.cents)}`}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {tab === 'merchants' && !empty && (
            <Card padding="none">
              <MerchantList merchants={data.merchants} currency={currency} openKey={openMerchant} />
            </Card>
          )}

          {tab === 'charges' && !empty && (
            <Card padding="none">
              <ul className="divide-y divide-border">
                {data.largest.map((charge) => (
                  <ChargeRow key={charge.id} charge={charge} currency={currency} />
                ))}
              </ul>
            </Card>
          )}
        </TabbedSections>
        {dashToday}
      </div>
    </PageWide>
  );
}
