import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { netWorthSeries, summarize } from '@/lib/finances/accounts';
import { loadAccountsPage } from '@/lib/finances/accounts-store';
import { isPlaidConfigured } from '@/lib/finances/plaid/env';
import { loadReviewPanel } from '@/lib/finances/review/page-load';
import { REVIEW_SEEN_COOKIE, reviewStartsOpen } from '@/lib/finances/review/seen';
import { todayIn } from '@/lib/todo/tasks/model';
import { AccountsView } from './accounts-view';
import { MonthReview } from './month-review';
import { MonthReviewSkeleton } from './month-review-skeleton';

export const metadata = { title: 'Accounts' };

// Try again on a failed review waits on one Sonnet call (actions.ts).
export const maxDuration = 120;

/**
 * Every account they hold, grouped, with net worth over time (plan #2593.6),
 * under the newest monthly review (plan #2593.8.3), which streams in after
 * the accounts.
 */
export default async function AccountsPage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);
  const today = todayIn(settings.timezone);
  const client = await createClient();
  const data = await loadAccountsPage(client, user.id, today);
  const accounts = summarize(data.accounts, data.readings, data.holdings, today, data.comments);

  return (
    <AccountsView
      accounts={accounts}
      netWorth={netWorthSeries(data.accounts, data.readings, today)}
      today={today}
      configured={isPlaidConfigured()}
      failed={data.failed}
      needsSignIn={data.needsSignIn.map((link) => ({
        id: link.id,
        institutionId: link.institutionId,
        institutionName: link.institutionName,
        needsUpdate: true,
        lastError: null,
        linkedAt: link.lastSyncedAt ?? today,
        lastSyncedAt: link.lastSyncedAt,
        accounts: [],
      }))}
      review={
        accounts.length > 0 ? (
          <Suspense fallback={<MonthReviewSkeleton />}>
            <Review userId={user.id} today={today} />
          </Suspense>
        ) : null
      }
    />
  );
}

/** The newest review, read on its own so the accounts do not wait for it. */
async function Review({ userId, today }: { userId: string; today: string }) {
  const { panel, thread } = await loadReviewPanel(await createClient(), userId, today, true).catch(
    (error: unknown) => {
      // The review is a reading aid on top of the accounts: a failed read leaves it off.
      console.error('Accounts: reading the month review failed', error);
      return { panel: null, thread: [] };
    },
  );
  if (!panel) return null;
  const seen = (await cookies()).get(REVIEW_SEEN_COOKIE)?.value;
  const month = panel.kind === 'review' ? panel.review.month : '';
  return (
    <MonthReview
      panel={panel}
      thread={thread}
      defaultOpen={reviewStartsOpen(month, seen)}
      today={today}
    />
  );
}
