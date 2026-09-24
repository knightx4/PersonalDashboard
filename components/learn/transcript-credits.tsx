import { CardSection } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import { projectedMonthEnd } from '@/lib/learn/youtube/budget';
import type { Usage } from '@/lib/learn/youtube/load';

/**
 * TranscriptAPI credits this month, against the plan.
 *
 * Shown on the YouTube library and on the Spend page, since it is money like
 * the model calls there, just counted in credits instead of dollars. The
 * count is this app's own ledger (`learn.transcript_calls`); calls made on the
 * same key from anywhere else are not in it, which the hint under the meter
 * says rather than leaving a number that looks like the balance.
 *
 * The meter turns to the danger colour at nine tenths: it is the one point
 * worth a colour, because past it the scheduled run starts rationing.
 */

const OUTCOME_WORDS: Record<string, string> = {
  fetched: 'fetched',
  'no-transcript': 'no captions',
  'out-of-credits': 'out of credits',
  'rate-limited': 'rate limited',
  unauthorized: 'key refused',
  error: 'failed',
};

function monthDay(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function when(instant: string): string {
  return new Date(instant).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function TranscriptCredits({ usage, now = new Date() }: { usage: Usage; now?: Date }) {
  const { credits, queue } = usage;
  const projected = projectedMonthEnd(credits, now);
  const nearlyOut = credits.allowance > 0 && credits.used >= credits.allowance * 0.9;
  const failures = Object.entries(usage.outcomes).filter(([outcome]) => outcome !== 'fetched');

  const waiting = [
    queue.queued > 0 ? `${queue.queued} queued` : null,
    queue.failed > 0 ? `${queue.failed} to retry` : null,
    queue.none > 0 ? `${queue.none} with no captions` : null,
    `${queue.fetched.toLocaleString('en-GB')} stored`,
  ].filter(Boolean);

  return (
    <CardSection
      title="TranscriptAPI credits"
      action={
        <span className="text-ui tabular-nums text-ink">
          {credits.used.toLocaleString('en-GB')} of {credits.allowance.toLocaleString('en-GB')}
        </span>
      }
    >
      <Meter
        value={credits.used}
        max={credits.allowance}
        label={`${credits.used} of ${credits.allowance} credits used this month`}
        fill={nearlyOut ? 'bg-danger' : 'bg-accent'}
        height="md"
      />
      <p className={cn('mt-2 text-small tabular-nums', nearlyOut ? 'text-danger' : 'text-ink-muted')}>
        {credits.remaining.toLocaleString('en-GB')} left · resets {monthDay(credits.resetsAt)}
        {projected !== null ? ` · on pace for ${projected.toLocaleString('en-GB')}` : ''}
      </p>
      <p className="mt-1 text-small text-ink-muted">
        {waiting.join(' · ')}. Counts what this app spent; the TranscriptAPI dashboard has the balance.
      </p>

      {usage.recent.length > 0 && (
        <Disclosure
          className="mt-3"
          title="Recent calls"
          meta={
            failures.length > 0
              ? failures.map(([outcome, count]) => `${count} ${OUTCOME_WORDS[outcome] ?? outcome}`).join(', ')
              : `${usage.recent.length} shown, all fetched`
          }
        >
          <ul className="mt-2 divide-y divide-border">
            {usage.recent.map((call) => (
              <li
                key={`${call.calledAt}-${call.videoId}`}
                className="flex items-baseline justify-between gap-3 py-1.5 text-small"
              >
                <span className="min-w-0 truncate">
                  <a
                    href={`/learn/youtube/v/${call.videoId}`}
                    className="text-ink hover:underline"
                  >
                    {call.videoId}
                  </a>
                  <span className="text-ink-muted">
                    {' '}
                    · {OUTCOME_WORDS[call.outcome] ?? call.outcome} · {call.trigger}
                    {call.detail && call.outcome !== 'fetched' ? ` · ${call.detail}` : ''}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {when(call.calledAt)} · {call.credits}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </CardSection>
  );
}
