import { ChevronRight, Clock, Landmark } from 'lucide-react';
import { CommentCount } from '@/components/dev/comment-count';
import { MainRail } from '@/components/patterns/main-rail';
import { RowLink } from '@/components/shell/back-link';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Figure, FigureDelta } from '@/components/ui/figure';
import Link from '@/components/ui/link';
import { Meter } from '@/components/ui/meter';
import { SectionLabel } from '@/components/ui/section-heading';
import { Tooltip } from '@/components/ui/tooltip';
import { sectionSubject } from '@/lib/core/section-path';
import { whenDate, whenMonth } from '@/lib/core/when';
import {
  accountHref,
  accountTitle,
  addDays,
  ageLabel,
  dueSoon,
  DUE_SOON_DAYS,
  grouped,
  isOwed,
  KIND_LABEL,
  netWorthChange,
  netWorthNow,
  percentLabel,
  SOURCE_LABEL,
  STALE_AFTER_DAYS,
  type AccountSummary,
  type DuePayment,
  type NetWorthPoint,
} from '@/lib/finances/accounts';
import type { AccountsRead } from '@/lib/finances/accounts-store';
import { formatMoney } from '@/lib/money';
import {
  LinkingProvider,
  SignInBanners,
  type LinkedInstitution,
} from '../settings/linked-accounts';
import { BalanceChart } from './balance-chart';

const UTC = { timeZone: 'UTC' } as const;
const dollars = (cents: number) => formatMoney(cents, 'USD', { showCents: false });

/** How far back the net worth figure measures its change. */
const CHANGE_DAYS = 30;

/**
 * Finances' Accounts page (plan #2593.6), in the list-and-detail pattern:
 * the header with its one action, net worth and how it has moved, then one
 * surface of rows grouped as cash, credit cards, investments and loans, then
 * the count. Each row shows the balance, where it comes from and how old it
 * is; a card adds its statement, due date and how much of its limit is used,
 * a loan its rate, payment and payoff month, a brokerage its gain on cost.
 * Pressing a row opens the account.
 *
 * The monthly review sits at the top of the main column (plan #2593.8.3),
 * passed in as `review` so the page can stream it, and the rail beside it
 * holds the card and loan payments due in the next two weeks (the
 * main-plus-rail pattern). On a phone the rail follows the accounts.
 *
 * Drawn from props, so the gallery draws it from fixtures. `chartActive` and
 * `staleOpenFor` hold a hidden part open for the gallery's shots.
 */
export function AccountsView({
  accounts,
  netWorth,
  today,
  needsSignIn = [],
  configured = true,
  chartActive,
  staleOpenFor,
  failed = [],
  review,
}: {
  accounts: readonly AccountSummary[];
  /** Net worth a day, oldest first (netWorthSeries). */
  netWorth: readonly NetWorthPoint[];
  today: string;
  /** Plaid links asking for a new sign-in, as the settings page lists links. */
  needsSignIn?: LinkedInstitution[];
  /** False until Plaid's keys are set. */
  configured?: boolean;
  chartActive?: number;
  staleOpenFor?: string;
  /** Reads behind the accounts that failed (loadAccountsPage). */
  failed?: readonly AccountsRead[];
  /** The monthly review, or nothing (app/finances/accounts/month-review.tsx). */
  review?: React.ReactNode;
}) {
  const header = (
    <PageHeader
      subject={sectionSubject('/finances/accounts', 'Accounts')}
      title="Accounts"
      actions={
        accounts.length > 0 ? (
          <Link
            href="/finances/settings"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Link account
          </Link>
        ) : undefined
      }
    />
  );

  const failure =
    failed.length > 0 ? (
      <Banner tone="bad" className="mb-4">
        <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span>
            <span className="font-medium">{failedSentence(failed)}</span>{' '}
            {failedConsequence(failed)}
          </span>
          <Link
            href="/finances/accounts"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Try again
          </Link>
        </p>
      </Banner>
    ) : null;

  const banners =
    needsSignIn.length > 0 ? (
      <LinkingProvider links={needsSignIn} itemsUsed={needsSignIn.length} configured={configured}>
        <div className="mb-4">
          <SignInBanners />
        </div>
      </LinkingProvider>
    ) : null;

  if (accounts.length === 0) {
    return (
      <PageColumn>
        {header}
        {banners}
        <EmptyState
          icon={Landmark}
          align="start"
          title="No accounts yet"
          description="Link Chase, your brokerage and your loan servicer, or import a statement for a card Plaid cannot reach, such as Apple Card. Each account then shows here with its balance, and net worth at the top."
          action={{ label: 'Link an account', href: '/finances/settings' }}
          secondaryAction={{ label: 'Import a statement', href: '/finances/settings#imports' }}
        />
      </PageColumn>
    );
  }

  // An account behind a link Plaid flagged has stopped updating, whatever
  // its last reading says.
  const flagged = new Map(needsSignIn.map((link) => [link.id, link.institutionName]));
  const groups = grouped(accounts);
  const noBalances = failed.includes('balances');
  const now = netWorthNow(accounts);
  const change = netWorthChange(netWorth, CHANGE_DAYS);
  const owed = accounts.reduce(
    (sum, a) => (isOwed(a.kind) && !a.closedOn ? sum + (a.balanceCents ?? 0) : sum),
    0,
  );
  const count = `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`;

  return (
    <MainRail
      main={
        <>
          {header}
          {failure}
          {banners}
          {review}
          {/* Without balances there is no net worth; the banner says so. */}
          {!noBalances && (
            <Card padding="standard" className="mb-6 space-y-4">
              <Figure
                label="Net worth"
                value={dollars(now)}
                aside={
                  change ? (
                    <FigureDelta
                      label={dollars(Math.abs(change.cents))}
                      direction={change.cents > 0 ? 'up' : change.cents < 0 ? 'down' : 'flat'}
                      suffix={`since ${whenDate(change.since, { ...UTC, year: 'auto', now: today })}`}
                    />
                  ) : undefined
                }
                caption={`${dollars(now + owed)} held, less ${dollars(owed)} owed on cards and loans`}
              />
              <BalanceChart
                points={netWorth}
                initialActive={chartActive ?? null}
                label={netWorthLabel(netWorth)}
              />
            </Card>
          )}

          <Card padding="none">
            <ul>
              {groups.map((group) => (
                <li key={group.id} className="border-b border-border last:border-b-0">
                  <div className="card-pad-x flex items-baseline justify-between gap-3 pb-1 pt-3">
                    <SectionLabel as="h2">{group.label}</SectionLabel>
                    <span className="tabular text-small text-ink-muted">
                      {group.accounts.every((a) => a.balanceCents === null)
                        ? '–'
                        : dollars(group.totalCents)}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {group.accounts.map((account) => (
                      <AccountRowItem
                        key={account.id}
                        account={account}
                        today={today}
                        signInAt={account.linkId ? flagged.get(account.linkId) : undefined}
                        staleOpen={staleOpenFor === account.id}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-3 text-small text-ink-muted">{count}</p>
        </>
      }
      rail={<DueSoon payments={dueSoon(accounts, today)} today={today} />}
    />
  );
}

/** The rail: card and loan payments due in the next two weeks, soonest first. */
function DueSoon({ payments, today }: { payments: readonly DuePayment[]; today: string }) {
  return (
    <section aria-labelledby="due-soon-heading" className="space-y-2">
      <h2 id="due-soon-heading" className="px-1 text-ui font-semibold text-ink">
        Due soon
      </h2>
      {payments.length === 0 ? (
        <p className="px-1 text-small text-ink-muted">
          No card or loan payment is due in the next {DUE_SOON_DAYS} days.
        </p>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {payments.map((payment) => (
              <li key={payment.account.id}>
                <RowLink
                  href={accountHref(payment.account.id)}
                  className="card-pad-x row-pad flex min-h-11 items-center gap-3 hover:bg-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-ink">
                      {accountTitle(payment.account)}
                    </span>
                    <span className="block text-small text-ink-muted">
                      {dueWhen(payment.dueOn, today)}
                    </span>
                  </span>
                  {payment.amountCents !== null && (
                    <span className="tabular shrink-0 text-ui text-ink">
                      {formatMoney(payment.amountCents)}
                    </span>
                  )}
                  <ChevronRight
                    aria-hidden
                    strokeWidth={1.75}
                    className="size-3.5 shrink-0 text-ink-muted"
                  />
                </RowLink>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** "Due today", "Due tomorrow", "Due Tue 3 Nov". */
function dueWhen(dueOn: string, today: string): string {
  if (dueOn === today) return 'Due today';
  if (dueOn === addDays(today, 1)) return 'Due tomorrow';
  return `Due ${whenDate(dueOn, { ...UTC, weekday: 'short', year: 'auto', now: today })}`;
}

/** "Balances and holdings could not be read." */
function failedSentence(failed: readonly AccountsRead[]): string {
  const names = failed.map((read) => (read === 'sign-ins' ? 'sign-in checks' : read));
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} could not be read.`;
}

/** What the page cannot show because of it. */
function failedConsequence(failed: readonly AccountsRead[]): string {
  if (failed.includes('balances'))
    return 'The accounts are listed without them, and net worth waits until they can be.';
  if (failed.includes('holdings')) return 'Brokerage gains are missing until they are.';
  return 'A bank asking you to sign in again may not be shown.';
}

function netWorthLabel(points: readonly NetWorthPoint[]): string {
  if (points.length < 2) return 'Net worth';
  const first = points[0];
  const last = points[points.length - 1];
  return `Net worth from ${dollars(first.cents)} on ${whenDate(first.day, UTC)} to ${dollars(last.cents)} on ${whenDate(last.day, UTC)}`;
}

/**
 * One account. The whole row opens it; the stale mark and the comment count
 * sit above the link so each can show its tip without a control nested in a
 * link. The name and the balance share the first line, the source and age
 * share the second with the limit bar, and a card's, a loan's or a
 * brokerage's facts take the full width under both, each fact kept whole.
 */
function AccountRowItem({
  account,
  today,
  signInAt,
  staleOpen,
}: {
  account: AccountSummary;
  today: string;
  /** The institution asking for a new sign-in, when this account's link is flagged. */
  signInAt?: string;
  staleOpen: boolean;
}) {
  const title = accountTitle(account);
  const facts = kindFacts(account, today);
  return (
    <li className="relative has-[a:hover]:bg-sunken">
      <RowLink href={accountHref(account.id)} className="absolute inset-0">
        <span className="sr-only">{title}</span>
      </RowLink>
      <div className="card-pad-x row-pad pointer-events-none relative min-h-11 space-y-0.5">
        <p className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui font-medium text-ink">{title}</span>
            <span className="pointer-events-auto">
              <CommentCount count={account.comments} />
            </span>
          </span>
          <span className="tabular shrink-0 text-ui font-medium text-ink">
            {account.balanceCents === null ? '–' : formatMoney(account.balanceCents)}
          </span>
        </p>
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-small text-ink-muted">
            <span className="truncate">
              {[
                account.institutionName ?? KIND_LABEL[account.kind],
                SOURCE_LABEL[account.source],
              ].join(' · ')}
            </span>
            <span aria-hidden>·</span>
            <Age account={account} open={staleOpen} signInAt={signInAt} />
          </p>
          {account.limitUsed !== null && (
            <Meter
              value={Math.min(1, account.limitUsed)}
              max={1}
              label={`${percentLabel(account.limitUsed)} of the limit used`}
              fill={account.limitUsed >= NEAR_LIMIT ? 'bg-caution' : 'bg-ink-ghost'}
              className="w-16 shrink-0"
            />
          )}
        </div>
        {facts.length > 0 && (
          <p className="text-small text-ink-muted">
            {facts.map((fact, index) => (
              <span key={index}>
                {index > 0 && ' · '}
                <span className="whitespace-nowrap">{fact}</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

/** Share of a card's limit from which its bar is drawn as needing attention. */
const NEAR_LIMIT = 0.5;

/**
 * How old the balance is; a stale one is marked and says when it was last
 * read. An account behind a flagged link is stale whatever its age.
 */
function Age({
  account,
  open,
  signInAt,
}: {
  account: AccountSummary;
  open: boolean;
  signInAt?: string;
}) {
  const label = ageLabel(account.ageDays);
  if (account.readOn === null && !signInAt)
    return <span className="whitespace-nowrap">Balance not read</span>;
  if (!account.stale && !signInAt) return <span className="whitespace-nowrap">{label}</span>;
  const limit = STALE_AFTER_DAYS[account.source];
  const read = account.readOn
    ? `Last read ${whenDate(account.readOn, UTC)}.`
    : 'No balance read yet.';
  const tip = signInAt
    ? `${read} ${signInAt} asks you to sign in again before it updates.`
    : account.source === 'plaid'
      ? `${read} A linked balance updates every morning, so this one has stopped.`
      : `${read} Add a new balance at least every ${limit} days.`;
  return (
    <Tooltip label={tip} defaultOpen={open} className="pointer-events-auto">
      <span
        tabIndex={0}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-control font-medium text-caution focus-visible:outline-2"
      >
        <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
        {label}
      </span>
    </Tooltip>
  );
}

/** The facts a card, a loan or a brokerage adds under its name, each kept whole. */
function kindFacts(account: AccountSummary, today: string): string[] {
  const day = (d: string) => whenDate(d, { ...UTC, year: 'auto', now: today });
  const parts: string[] = [];
  if (account.kind === 'credit_card') {
    if (account.statementBalanceCents !== null)
      parts.push(`Statement ${formatMoney(account.statementBalanceCents)}`);
    if (account.nextPaymentDueOn) parts.push(`due ${day(account.nextPaymentDueOn)}`);
    if (account.limitUsed !== null && account.creditLimitCents)
      parts.push(
        `${percentLabel(account.limitUsed)} of ${dollars(account.creditLimitCents)} limit`,
      );
  } else if (account.kind === 'loan') {
    if (account.interestRate !== null) parts.push(`${account.interestRate}%`);
    if (account.minimumPaymentCents !== null)
      parts.push(`${formatMoney(account.minimumPaymentCents)} a month`);
    const payoff = account.payoff;
    if (payoff?.kind === 'on')
      parts.push(`paid off ${whenMonth(payoff.month, { ...UTC, month: 'short' })}`);
    else if (payoff?.kind === 'never') parts.push('payment does not cover the interest');
    else if (payoff?.kind === 'paid') parts.push('paid off');
  } else if (
    account.kind === 'brokerage' &&
    account.investment?.gainCents != null &&
    account.investment.costCents
  ) {
    const { gainCents, costCents } = account.investment;
    const sign = gainCents >= 0 ? '+' : '−';
    parts.push(
      `${sign}${dollars(Math.abs(gainCents))} (${sign}${percentLabel(Math.abs(gainCents) / costCents)})`,
    );
    parts.push(`on ${dollars(costCents)} cost`);
  }
  if (parts.length > 0) parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts;
}
