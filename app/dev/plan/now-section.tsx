'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/auth/client';
import Link from '@/components/ui/link';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { FoldDetails } from '@/components/ui/fold-details';
import { cn } from '@/lib/cn';
import { LiveDot } from '@/components/ui/live-dot';
import { LinkedText } from '@/components/ui/linked-text';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { RunAnswer } from '@/components/runs/run-answer';
import { exactTime, shortWhen } from '@/lib/comments/when';
import { useClockNow } from '@/lib/use-clock-now';
import { isStale, withoutTitle, type NowFinished, type NowList, type NowSession } from '@/lib/plan/now';
import { answerPlanRunAction } from './run-actions';

/** Several changes close together refresh once. */
const SETTLE_MS = 750;
/** How often the page is read again when Realtime cannot be reached. */
const FALLBACK_POLL_MS = 60_000;

/**
 * Read the page again when a session reports or a run changes, while it is
 * open (plan #2800.3). core.session_progress and plan_runs are both in the
 * Realtime publication, and Realtime reads each event through your RLS, so
 * only your own sessions are heard. If the channel cannot open, the page is
 * read again every minute instead, which still meets "within a minute or two".
 */
function useNowRefresh(live: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, SETTLE_MS);
    };
    const channel = supabase
      .channel(`session-progress:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'core', table: 'session_progress' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'plan_runs' }, refresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (poll) clearInterval(poll);
          poll = null;
        } else if (!poll && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
          poll = setInterval(() => router.refresh(), FALLBACK_POLL_MS);
        }
      });
    return () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [live, router]);
}

/**
 * What is running now, at the top of a project's page and Dev's plan (plan
 * #2800.3): each session going, what it last did and how long ago, and
 * anything it is waiting on you for, answered here when its run asked a
 * question with choices. Rows come from lib/plan/now.ts, which puts the
 * sessions' own reports first and keeps the push-based reading for runs that
 * have not reported.
 *
 * `now` is for the gallery, which draws fixed fixtures; the page leaves it
 * out and reads the shared clock, and `live` off stops the subscription.
 */
export function NowSection({
  list,
  now: fixedNow,
  live = true,
}: {
  list: NowList;
  now?: number;
  live?: boolean;
}) {
  useNowRefresh(live);
  const clock = useClockNow();
  const now = fixedNow ?? clock;
  const { sessions, finished } = list;

  const waiting = sessions.filter((session) => session.state === 'waiting').length;
  const stale = sessions.filter((session) => isStale(session, now)).length;
  // What the folded line says, so it still tells you whether to open it.
  const meta = [
    sessions.length > 0 ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}` : null,
    waiting > 0 ? `${waiting} waiting on you` : null,
    stale > 0 ? `${stale} quiet` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card padding="none" data-slot="section">
      {/* Folds by its heading, kept in this browser, as every list box does. */}
      <FoldDetails remember="dev.fold.Now" defaultOpen className="group/now">
        <summary
          className={cn(
            'press card-pad-x flex cursor-pointer list-none items-center py-(--card-p-dense)',
            'focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden',
          )}
        >
          <h2 className="flex flex-wrap items-baseline gap-2 text-ui font-semibold text-ink">
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0 translate-y-0.5 text-ink-ghost transition-transform duration-quick group-open/now:rotate-90"
            />
            Now
            {meta && <span className="tabular text-small font-normal text-ink-muted">{meta}</span>}
          </h2>
        </summary>
        {sessions.length === 0 ? (
          <NothingRunning finished={finished} now={now} />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {sessions.map((session) => (
              <NowRow key={session.key} session={session} now={now} />
            ))}
          </ul>
        )}
      </FoldDetails>
    </Card>
  );
}

function Age({ at, now }: { at: string; now: number }) {
  return (
    <time dateTime={at} title={exactTime(at)} className="tabular shrink-0 text-small text-ink-muted">
      {now === 0 ? '' : shortWhen(at, now)}
    </time>
  );
}

function StepName({ session }: { session: NowSession }) {
  if (session.step) {
    return (
      <Link
        href={session.step.href}
        title={`${session.step.ref} ${session.step.title}`}
        className="press-area block min-w-0 truncate text-ui font-semibold text-ink transition-colors duration-quick hover:text-accent"
      >
        <span className="tabular text-ink-muted">{session.step.ref}</span> {session.step.title}
      </Link>
    );
  }
  return (
    <span className="block min-w-0 truncate text-ui font-semibold text-ink">
      {session.project ? `A session on ${session.project}` : 'A session on no step'}
    </span>
  );
}

function NowRow({ session, now }: { session: NowSession; now: number }) {
  const waiting = session.state === 'waiting';
  const stale = isStale(session, now);

  return (
    <li className="card-pad-x row-pad grid min-w-0 grid-cols-[14px_minmax(0,1fr)] gap-x-2 gap-y-1">
      {/* One column for the mark, so every line under the title starts where the title does. */}
      <span className="flex h-[1lh] items-center justify-center text-ui">
        {waiting ? (
          <StatusGlyph glyph="question" size={14} className="text-caution" />
        ) : (
          <LiveDot tone={stale ? 'caution' : 'accent'} still={stale} />
        )}
      </span>
      {/* Two lines a session at any width (law 9): the step, then its latest
          line with the age after it; the full text is in each line's title
          and on the step's own page. */}
      <StepName session={session} />
      <p className="col-start-2 flex min-w-0 items-baseline gap-1.5 text-ui text-ink">
        <span className="min-w-0 truncate" title={withoutTitle(session.action, session.step?.title)}>
          <LinkedText text={withoutTitle(session.action, session.step?.title)} />
        </span>
        <span aria-hidden className="shrink-0 text-small text-ink-muted">·</span>
        <Age at={session.at} now={now} />
      </p>
      {(stale || session.source === 'guess') && !waiting && (
        <p className="col-start-2 text-small text-ink-muted">
          {stale && <span className="text-caution">No report for over 20 minutes. </span>}
          {session.source === 'guess' && 'Read from its pushes; this session does not report.'}
        </p>
      )}
      {waiting && <WaitingOnYou session={session} />}
    </li>
  );
}

function WaitingOnYou({ session }: { session: NowSession }) {
  const question = session.question;
  return (
    <div className="col-start-2 space-y-1">
      <p className="text-small font-semibold text-caution">Waiting on you</p>
      {session.needs && (
        <p className="text-ui break-words whitespace-pre-wrap text-ink">
          <LinkedText text={session.needs} />
        </p>
      )}
      {question ? (
        <RunAnswer runId={question.runId} options={question.options} action={answerPlanRunAction} />
      ) : session.step ? (
        <Link href={session.step.href} className="press-area text-small font-semibold text-accent hover:underline">
          Answer on {session.step.ref}
        </Link>
      ) : (
        <p className="text-small text-ink-muted">Answer it in the session it came from.</p>
      )}
    </div>
  );
}

/** "2h ago", "just now", or "on 3 Oct" past a week, from shortWhen's figure. */
function agoText(at: string, now: number): string {
  const short = shortWhen(at, now);
  if (short === 'now') return 'just now';
  return /^\d+[mhd]$/.test(short) ? `${short} ago` : `on ${short}`;
}

function NothingRunning({ finished, now }: { finished: NowFinished | null; now: number }) {
  return (
    <div className="card-pad-x space-y-1 border-t border-border row-pad">
      <p className="text-ui text-ink">No session is running.</p>
      {finished && (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-small text-ink-muted">
          <span>{finished.state === 'done' ? 'Last finished' : 'Last stopped'}</span>
          {now !== 0 && <span className="tabular">{agoText(finished.at, now)}</span>}
          {finished.step && (
            <Link href={finished.step.href} className="press-area text-ink hover:text-accent">
              {finished.step.ref} {finished.step.title}
            </Link>
          )}
          <span className="basis-full break-words">{withoutTitle(finished.action, finished.step?.title)}</span>
        </p>
      )}
    </div>
  );
}
