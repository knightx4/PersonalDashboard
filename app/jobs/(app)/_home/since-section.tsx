import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { loadActivitySince } from '@/lib/jobs/activity/load';
import { countReviewItems } from '@/lib/jobs/review/load';
import { formatDateTime } from '@/lib/jobs/applications/load';
import { SINCE_LIMIT, sinceOf, stoppedInboxes, FIRST_VISIT_DAYS } from '@/lib/jobs/home/since';
import { recordHomeVisit } from '@/lib/jobs/home/visits-store';
import { TONE_CHIP } from '@/components/jobs/activity/tone';
import { Card } from '@/components/ui/card';
import { HomeSection } from './home-section';

/**
 * What came in since your last visit (plan #1152). Second on Home, after the
 * summary.
 *
 * Opening Home records the visit (lib/jobs/home/visits-store.ts), and the list
 * starts at the visit before this sitting, or 7 days back on a first visit.
 * Two checks go above the changes because they stop the changes arriving at
 * all: imports waiting to be checked, and a mailbox that has stopped syncing.
 * The changes are the Activity tab's, newest first and at most eight, without
 * the mail This week already lists as waiting on you (`waitingEventIds`).
 */
export async function SinceSection({
  supabase,
  core,
  userId,
  timezone,
  waitingEventIds,
}: {
  supabase: AppSupabaseClient;
  core: CoreSupabaseClient;
  userId: string;
  timezone: string;
  waitingEventIds: readonly string[];
}) {
  const now = new Date();

  let visit;
  try {
    visit = await recordHomeVisit(supabase, { userId, now });
  } catch (error) {
    // Law 2: say it failed rather than showing an empty list as quiet.
    return (
      <HomeSection id="since" title="Since you last looked">
        <p className="px-1 text-small text-ink-muted">
          {error instanceof Error ? error.message : 'Could not read your last visit.'}
        </p>
      </HomeSection>
    );
  }

  const { since, firstVisit } = sinceOf(visit, now);

  const [activity, reviewCount, accountResult] = await Promise.all([
    loadActivitySince(supabase, userId, {
      since,
      limit: SINCE_LIMIT,
      excludeEventIds: waitingEventIds,
    }),
    countReviewItems(supabase, core, userId),
    core.from('email_accounts').select('id, email_address, status').eq('user_id', userId),
  ]);

  const stopped = stoppedInboxes(
    (accountResult.data ?? []).map((row) => ({
      id: row.id as string,
      emailAddress: row.email_address as string,
      status: row.status as string,
    })),
  );

  const more = activity.total - activity.entries.length;
  const quiet =
    stopped.length === 0 && reviewCount === 0 && activity.entries.length === 0 && !activity.error;
  const hint = firstVisit
    ? `The last ${FIRST_VISIT_DAYS} days`
    : `Since ${formatDateTime(since, timezone)}`;

  return (
    <HomeSection id="since" title="Since you last looked" hint={hint}>
      {quiet ? (
        <p className="px-1 text-small text-ink-muted">
          Nothing new since then.
        </p>
      ) : (
        <Card padding="standard" className="space-y-3">
          {(stopped.length > 0 || reviewCount > 0) && (
            <ul className="space-y-1.5">
              {stopped.map((account) => (
                <li key={account.id} className="rounded-lg bg-caution-tint px-3 py-2 text-small text-ink">
                  {account.emailAddress} has stopped syncing, so new mail is not coming in.{' '}
                  <Link href="/jobs/settings#inboxes" className="font-medium underline hover:text-accent">
                    {account.status === 'needs_reauth' ? 'Reconnect it' : 'Check the inbox settings'}
                  </Link>
                </li>
              ))}
              {reviewCount > 0 && (
                <li className="rounded-lg bg-caution-tint px-3 py-2 text-small text-ink">
                  {reviewCount === 1
                    ? '1 import is waiting to be checked.'
                    : `${reviewCount} imports are waiting to be checked.`}{' '}
                  <Link href="/jobs/review" className="font-medium underline hover:text-accent">
                    Check them
                  </Link>
                </li>
              )}
            </ul>
          )}

          {activity.entries.length > 0 && (
            <ul className="divide-y divide-border">
              {activity.entries.map((entry) => (
                <li key={entry.id} className="row-pad flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    className={cn(
                      'shrink-0 self-center rounded-full px-2 py-0.5 text-micro font-medium first-letter:uppercase',
                      TONE_CHIP[entry.tone],
                    )}
                  >
                    {entry.label}
                  </span>
                  {entry.subject &&
                    (entry.roleId ? (
                      <Link
                        href={`/jobs/roles/${entry.roleId}`}
                        className="text-ui text-ink transition-colors duration-quick hover:text-accent"
                      >
                        {entry.subject}
                      </Link>
                    ) : (
                      <span className="text-ui text-ink">{entry.subject}</span>
                    ))}
                  <span className="text-small text-ink-muted sm:ml-auto">
                    {formatDateTime(entry.at, timezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {activity.error && (
            <p className="text-small text-ink-muted">Could not load every change: {activity.error}</p>
          )}

          {(more > 0 || activity.entries.length > 0) && (
            <p className="text-small">
              <Link href="/jobs/activity" className="text-ink-muted transition-colors duration-quick hover:text-accent">
                {more > 0 ? `${more} more on the Activity tab` : 'Everything on the Activity tab'}
              </Link>
            </p>
          )}
        </Card>
      )}
    </HomeSection>
  );
}
