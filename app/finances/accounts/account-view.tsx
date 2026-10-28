import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { Thread } from '@/components/thread/thread';
import { Card } from '@/components/ui/card';
import { SectionHeading } from '@/components/ui/section-heading';
import type { DevComment } from '@/lib/comments/load';
import { whenDate, whenMonth } from '@/lib/core/when';
import {
  accountHref,
  accountTitle,
  ageLabel,
  balanceSeries,
  currentHoldings,
  KIND_LABEL,
  percentLabel,
  SOURCE_LABEL,
  type AccountSummary,
  type Holding,
  type NetWorthPoint,
  type Reading,
} from '@/lib/finances/accounts';
import type { AccountTransaction } from '@/lib/finances/accounts-store';
import { formatMoney, formatNumber } from '@/lib/money';
import { threadRef } from '@/lib/thread/subjects';
import { BalanceChart } from './balance-chart';

const UTC = { timeZone: 'UTC' } as const;
const dollars = (cents: number) => formatMoney(cents, 'USD', { showCents: false });

/**
 * One account (plan #2593.6), in the list-and-detail pattern: the header,
 * the facts its kind has (a card's statement, due date and limit; a loan's
 * rate, payment and payoff; a brokerage's value and gain on cost), then its
 * balance over time, its holdings for a brokerage, its recent transactions,
 * and its thread.
 *
 * Drawn from props, so the gallery draws it from fixtures.
 */
export function AccountView({
  account,
  readings,
  holdings,
  transactions,
  moreTransactions,
  thread,
  today,
  subject,
}: {
  account: AccountSummary;
  readings: readonly Reading[];
  holdings: readonly Holding[];
  transactions: readonly AccountTransaction[];
  moreTransactions: boolean;
  thread: DevComment[];
  today: string;
  /** The path from the catalogue (rowSubject); the gallery passes none and gets one built here. */
  subject?: Subject;
}) {
  const title = accountTitle(account);
  const day = (d: string) => whenDate(d, { ...UTC, year: 'auto', now: today });
  const series = balanceSeries(readings, account.id);
  const held = account.kind === 'brokerage' ? currentHoldings(holdings) : [];

  const header = (
    <PageHeader
      title={title}
      description={
        account.officialName && account.officialName !== account.name
          ? account.officialName
          : undefined
      }
      subject={
        subject ?? {
          ref: `finances.accounts:${account.id}`,
          path: [
            { label: 'Finances', href: '/finances/accounts' },
            { label: 'Accounts', href: '/finances/accounts' },
            { label: title, href: accountHref(account.id) },
          ],
        }
      }
    />
  );

  const balance = account.balanceCents === null ? '–' : formatMoney(account.balanceCents);
  const facts: React.ReactNode[] = [
    <Property
      key="balance"
      label={account.kind === 'credit_card' || account.kind === 'loan' ? 'Owed' : 'Balance'}
      value={balance}
    />,
    <Property
      key="age"
      label="Updated"
      value={
        account.stale ? (
          <span className="font-medium text-caution">{ageLabel(account.ageDays)}</span>
        ) : (
          ageLabel(account.ageDays)
        )
      }
      hint={account.readOn ? `Last read ${whenDate(account.readOn, UTC)}` : undefined}
    />,
    <Property key="source" label="From" value={SOURCE_LABEL[account.source]} />,
    <Property
      key="held"
      label="Held at"
      value={account.institutionName ?? KIND_LABEL[account.kind]}
    />,
  ];

  if (account.kind === 'credit_card') {
    facts.push(
      <Property
        key="statement"
        label="Statement"
        value={
          account.statementBalanceCents === null ? '–' : formatMoney(account.statementBalanceCents)
        }
      />,
      <Property
        key="due"
        label="Due"
        value={account.nextPaymentDueOn ? day(account.nextPaymentDueOn) : '–'}
      />,
      <Property
        key="limit"
        label="Limit used"
        value={
          account.limitUsed !== null && account.creditLimitCents
            ? `${percentLabel(account.limitUsed)} of ${dollars(account.creditLimitCents)}`
            : '–'
        }
      />,
      <Property
        key="minimum"
        label="Minimum"
        value={
          account.minimumPaymentCents === null ? '–' : formatMoney(account.minimumPaymentCents)
        }
      />,
    );
  } else if (account.kind === 'loan') {
    const payoff = account.payoff;
    facts.push(
      <Property
        key="rate"
        label="Rate"
        value={account.interestRate === null ? '–' : `${account.interestRate}%`}
      />,
      <Property
        key="payment"
        label="Monthly payment"
        value={
          account.minimumPaymentCents === null ? '–' : formatMoney(account.minimumPaymentCents)
        }
      />,
      <Property
        key="payoff"
        label="Paid off"
        value={
          payoff?.kind === 'on'
            ? whenMonth(payoff.month, { ...UTC, month: 'short' })
            : payoff?.kind === 'never'
              ? 'Never at this payment'
              : payoff?.kind === 'paid'
                ? 'Paid'
                : '–'
        }
        hint={payoff?.kind === 'on' ? `${payoff.months} more payments` : undefined}
      />,
      <Property
        key="next"
        label="Next payment"
        value={account.nextPaymentDueOn ? day(account.nextPaymentDueOn) : '–'}
      />,
    );
  } else if (account.kind === 'brokerage' && account.investment) {
    const { costCents, gainCents } = account.investment;
    facts.push(
      <Property key="cost" label="Cost" value={costCents === null ? '–' : dollars(costCents)} />,
      <Property
        key="gain"
        label="Gain"
        value={
          gainCents === null || !costCents
            ? '–'
            : `${gainCents >= 0 ? '+' : '−'}${dollars(Math.abs(gainCents))} (${percentLabel(Math.abs(gainCents) / costCents)})`
        }
      />,
    );
  }

  return (
    <DetailPage header={header} details={<DetailFacts>{facts}</DetailFacts>}>
      <section aria-labelledby="account-history" className="space-y-2">
        <SectionHeading id="account-history" title="Balance over time" />
        <Card padding="standard">
          {series.length >= 2 ? (
            <BalanceChart
              points={series}
              label={`${title}: balance over time`}
              summary={historySummary(series)}
            />
          ) : (
            <p className="text-ui text-ink-muted">
              {series.length === 1
                ? `One balance so far, ${balance} on ${whenDate(series[0].day, UTC)}. The line starts with the next.`
                : 'No balance read yet.'}
            </p>
          )}
        </Card>
      </section>

      {account.kind === 'brokerage' && (
        <section aria-labelledby="account-holdings" className="space-y-2">
          <SectionHeading
            id="account-holdings"
            title="Holdings"
            count={held.length > 0 ? `as of ${day(held[0].asOf)}` : undefined}
          />
          {held.length === 0 ? (
            <Card padding="standard">
              <p className="text-ui text-ink-muted">
                No holdings read yet. They arrive with the next sync.
              </p>
            </Card>
          ) : (
            <Card padding="none">
              <ul className="divide-y divide-border">
                {held.map((h) => (
                  <HoldingRow key={`${h.ticker ?? h.securityName}`} holding={h} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      <section aria-labelledby="account-transactions" className="space-y-2">
        <SectionHeading
          id="account-transactions"
          title="Recent transactions"
          count={
            transactions.length > 0
              ? moreTransactions
                ? `latest ${transactions.length}`
                : transactions.length
              : undefined
          }
        />
        {transactions.length === 0 ? (
          <Card padding="standard">
            <p className="text-ui text-ink-muted">
              {account.source === 'plaid'
                ? 'None yet. They arrive with the next morning’s sync.'
                : 'None yet. They arrive when a statement is imported.'}
            </p>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {transactions.map((t) => (
                <TransactionRow key={t.id} transaction={t} today={today} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <Card padding="dense" aria-label="Comments" role="region">
        <Thread
          subject={threadRef('account', account.id)}
          turns={thread}
          placeholder="A note on this account, or a question for Dash."
        />
      </Card>
    </DetailPage>
  );
}

function TransactionRow({
  transaction: t,
  today,
}: {
  transaction: AccountTransaction;
  today: string;
}) {
  const name = t.merchant ?? t.description;
  return (
    <li className="card-pad-x row-pad flex min-h-11 items-start gap-3">
      <span className="tabular w-14 shrink-0 pt-px text-small text-ink-muted">
        {whenDate(t.postedOn, { ...UTC, year: 'auto', now: today })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-ink">{name}</span>
        {(t.category || t.pending) && (
          <span className="block truncate text-small text-ink-muted">
            {[t.pending ? 'Pending' : null, t.category].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span className="tabular shrink-0 text-ui text-ink">
        {t.amountCents > 0 ? `+${formatMoney(t.amountCents)}` : formatMoney(t.amountCents)}
      </span>
    </li>
  );
}

function HoldingRow({ holding: h }: { holding: Holding }) {
  const gain = h.costBasisCents === null ? null : h.valueCents - h.costBasisCents;
  return (
    <li className="card-pad-x row-pad flex min-h-11 items-start gap-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-ink">
          {h.ticker ? `${h.ticker} · ` : ''}
          {h.securityName}
        </span>
        <span className="tabular block text-small text-ink-muted">
          {formatNumber(h.quantity)} {h.quantity === 1 ? 'share' : 'shares'}
          {gain !== null && h.costBasisCents
            ? ` · ${gain >= 0 ? '+' : '−'}${dollars(Math.abs(gain))} on ${dollars(h.costBasisCents)}`
            : ''}
        </span>
      </span>
      <span className="tabular shrink-0 text-ui text-ink">{dollars(h.valueCents)}</span>
    </li>
  );
}

/** "Down $2,716 since 20 Oct 2025, from 13 balances": what the line shows. */
function historySummary(series: readonly NetWorthPoint[]): string {
  const first = series[0];
  const last = series[series.length - 1];
  const change = last.cents - first.cents;
  const since = `since ${whenDate(first.day, UTC)}, from ${series.length} balances`;
  if (change === 0) return `No change ${since}`;
  return `${change > 0 ? 'Up' : 'Down'} ${dollars(Math.abs(change))} ${since}`;
}
