import Link from 'next/link';
import { ArrowUpRight, Mail, Minus, X } from 'lucide-react';
import { formatDateTime } from '@/lib/jobs/applications/load';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { ActivityTone } from '@/lib/jobs/activity/load';
import { Card } from '@/components/ui/card';
import { HomeSection } from './home-section';

/**
 * Each kind of change marked by a shape in ink rather than a tinted chip, so
 * the colour carries nothing on its own and nothing here reads as money.
 */
const TONE_ICON: Record<
  ActivityTone,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  good: ArrowUpRight,
  bad: X,
  info: Mail,
  muted: Minus,
};

/** Where the whole feed is, with the check-inbox button above it. */
export const ACTIVITY_HREF = '/jobs/activity';

/**
 * What came in since your last visit (plan #1152). Last on Today.
 *
 * Read by loadSinceView (lib/jobs/home/since-load.ts) and drawn here, so the
 * gallery can draw it from fixtures. The Activity tab is gone (plan #1591):
 * "See all" leads to the full feed and the button that checks the inbox now,
 * which are still at their own address.
 */
export function SinceList({ since, timezone }: { since: SinceView; timezone: string }) {
  if (since.state === 'failed') {
    return (
      <HomeSection
        id="since"
        title="Since you last looked"
        more={{ href: ACTIVITY_HREF, label: 'See all' }}
      >
        <p className="px-1 text-small text-ink-muted">{since.message}</p>
      </HomeSection>
    );
  }

  const quiet = since.stopped.length === 0 && since.entries.length === 0 && !since.error;

  return (
    <HomeSection
      id="since"
      title="Since you last looked"
      hint={since.hint}
      more={{
        href: ACTIVITY_HREF,
        label: since.more > 0 ? `See all · ${since.more} more` : 'See all',
      }}
    >
      {quiet ? (
        <p className="px-1 text-small text-ink-muted">Nothing new since then.</p>
      ) : (
        <Card padding="standard" className="space-y-3">
          {since.stopped.length > 0 && (
            <ul className="space-y-1.5">
              {since.stopped.map((account) => (
                <li
                  key={account.id}
                  className="rounded-lg bg-caution-tint px-3 py-2 text-small text-ink"
                >
                  {account.emailAddress} has stopped syncing, so new mail is not coming in.{' '}
                  <Link
                    href="/jobs/settings#inboxes"
                    className="font-medium underline hover:text-accent"
                  >
                    {account.status === 'needs_reauth'
                      ? 'Reconnect it'
                      : 'Check the inbox settings'}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {since.entries.length > 0 && (
            <ul className="divide-y divide-border">
              {since.entries.map((entry) => {
                const Icon = TONE_ICON[entry.tone];
                return (
                  <li
                    key={entry.id}
                    className="row-pad flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                  >
                    <span className="inline-flex shrink-0 items-center gap-1 self-center text-small text-ink-muted first-letter:uppercase">
                      <Icon className="size-3.5 text-ink" strokeWidth={1.75} aria-hidden />
                      <span className="first-letter:uppercase">{entry.label}</span>
                    </span>
                    {entry.subject &&
                      (entry.roleId ? (
                        <Link
                          href={`/jobs/roles/${entry.roleId}`}
                          className="press-area text-ui text-ink transition-colors duration-quick hover:text-accent"
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
                );
              })}
            </ul>
          )}

          {since.error && (
            <p className="text-small text-ink-muted">Could not load every change: {since.error}</p>
          )}
        </Card>
      )}
    </HomeSection>
  );
}
