import { Repeat } from 'lucide-react';
import { Figure } from '@/components/ui/figure';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import { formatMoney } from '@/lib/money';
import type { RecurringPeriod } from '@/lib/recurring/extraction';
import type { MonthlyTotal, RecurringRow, RecurringView } from '@/lib/recurring/view';
import { PaymentRow, type PaymentChoice } from './payment-row';

/**
 * Everything the person pays for regularly (plan #1126): what it comes to a
 * month, then each payment by its next date, then the ones that stopped
 * charging and may have lapsed, then the cancelled.
 *
 * Presentational, so /preview photographs it with fixture rows; each row's
 * corrections (rename, merge, and the ones feature #1193 adds) live in PaymentRow.
 */

const PER: Record<RecurringPeriod, string> = {
  week: 'a week',
  month: 'a month',
  quarter: 'a quarter',
  year: 'a year',
};

function sameYear(a: string, b: string): boolean {
  return a.slice(0, 4) === b.slice(0, 4);
}

function day(date: string, today: string): string {
  return formatDay(date, !sameYear(date, today));
}

function totalLine(totals: readonly MonthlyTotal[]): string {
  return totals.map((t) => formatMoney(t.cents, t.currency)).join(' + ');
}

function Amount({ row }: { row: RecurringRow }) {
  if (row.amountCents == null) {
    return <p className="text-ui text-ink-ghost">Amount not known</p>;
  }
  const amount = formatMoney(row.amountCents, row.currency);
  return (
    <div className="shrink-0 text-right">
      <p className="tabular text-body font-medium text-ink">
        {amount}
        {row.period && <span className="font-normal text-ink-muted"> {PER[row.period]}</span>}
      </p>
      {row.period && row.period !== 'month' && row.monthlyCents != null && (
        <p className="tabular text-ui text-ink-muted">
          {formatMoney(row.monthlyCents, row.currency)} a month
        </p>
      )}
    </div>
  );
}

function Rise({ row, today }: { row: RecurringRow; today: string }) {
  if (!row.rise) return null;
  return (
    <p className="text-ui font-medium text-caution">
      Up from {formatMoney(row.rise.fromCents, row.currency)} on {day(row.rise.on, today)}
    </p>
  );
}

function Row({
  row,
  today,
  when,
  choices,
}: {
  row: RecurringRow;
  today: string;
  when: string;
  choices: readonly PaymentChoice[];
}) {
  return (
    <PaymentRow
      id={row.id}
      payee={row.payee}
      others={choices.filter((c) => c.id !== row.id)}
      details={
        <>
          <p className="text-ui text-ink-muted">
            {row.kind === 'bill' ? 'Bill' : 'Subscription'} · {when}
          </p>
          <Rise row={row} today={today} />
        </>
      }
      amount={<Amount row={row} />}
    />
  );
}

function nextLabel(row: RecurringRow, today: string, kind: 'active' | 'lapsed'): string {
  if (kind === 'lapsed') {
    const last = row.lastChargedOn ? `, last charged ${day(row.lastChargedOn, today)}` : '';
    return `Expected ${day(row.nextDate!, today)}${last}`;
  }
  if (!row.nextDate) return 'Next date not known';
  if (row.nextDate === today) return row.kind === 'bill' ? 'Due today' : 'Renews today';
  if (row.nextDate < today) return `Due ${day(row.nextDate, today)}, not charged yet`;
  return `${row.kind === 'bill' ? 'Due' : 'Renews'} ${day(row.nextDate, today)}`;
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        {note && <p className="text-ui text-ink-muted">{note}</p>}
      </div>
      <ul
        className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}
      >
        {children}
      </ul>
    </section>
  );
}

export function RecurringPaymentsView({ view, today }: { view: RecurringView; today: string }) {
  const count = view.active.length + view.lapsed.length + view.cancelled.length;
  if (count === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="Nothing found yet"
        description="Subscriptions and bills show here once receipts, renewal notices and statements for them are read from your mail."
        action={{ label: 'Inbox settings', href: '/shopping/settings#inboxes' }}
      />
    );
  }

  // Every payment, by name, for the merge picker on each row.
  const choices: PaymentChoice[] = [...view.active, ...view.lapsed, ...view.cancelled]
    .map((row) => ({ id: row.id, payee: row.payee }))
    .sort((a, b) => a.payee.localeCompare(b.payee));

  const uncounted = view.total.reduce((sum, t) => sum + t.uncounted, 0);
  const rises = [...view.active, ...view.lapsed].filter((row) => row.rise).length;
  const spread = view.active.some((row) => row.period && row.period !== 'month');
  const caption = [
    `${view.active.length} ${view.active.length === 1 ? 'payment' : 'payments'}${
      spread ? ', those not charged monthly spread evenly over the months' : ''
    }`,
    uncounted > 0
      ? `${uncounted} with no amount or no period ${uncounted === 1 ? 'is' : 'are'} left out`
      : null,
  ]
    .filter(Boolean)
    .join('; ');

  const secondary = [
    ...(view.lapsed.length > 0
      ? [
          {
            value: totalLine(view.lapsedTotal),
            label: `a month more if the ${view.lapsed.length} that stopped are still running`,
          },
        ]
      : []),
    ...(rises > 0
      ? [{ value: String(rises), label: rises === 1 ? 'price went up' : 'prices went up' }]
      : []),
  ];

  return (
    <div className="space-y-8">
      <Figure
        label="You pay each month"
        value={view.total.length > 0 ? totalLine(view.total) : formatMoney(0)}
        caption={caption}
        secondary={secondary}
      />

      {view.active.length > 0 && (
        <Section title="Coming up">
          {view.active.map((row) => (
            <Row
              key={row.id}
              row={row}
              today={today}
              when={nextLabel(row, today, 'active')}
              choices={choices}
            />
          ))}
        </Section>
      )}

      {view.lapsed.length > 0 && (
        <Section title="May have lapsed" note="A charge was expected and none has arrived since">
          {view.lapsed.map((row) => (
            <Row
              key={row.id}
              row={row}
              today={today}
              when={nextLabel(row, today, 'lapsed')}
              choices={choices}
            />
          ))}
        </Section>
      )}

      {view.cancelled.length > 0 && (
        <Section title="Cancelled">
          {view.cancelled.map((row) => (
            <Row
              key={row.id}
              row={row}
              today={today}
              when={
                row.lastChargedOn ? `Last charged ${day(row.lastChargedOn, today)}` : 'Cancelled'
              }
              choices={choices}
            />
          ))}
        </Section>
      )}
    </div>
  );
}
