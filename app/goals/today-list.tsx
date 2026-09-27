'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/field';
import { formatDay } from '@/lib/goals/dates';
import { RHYTHM_SOURCE_LINKS } from '@/lib/goals/rhythms';
import type { TodayItem, TodayKind } from '@/lib/goals/today';
import { countRhythmAction, setStepStatusAction } from './[goalId]/actions';
import { addGoalComment } from './[goalId]/comment-actions';
import { settleGoalAction } from './actions';
import { answerFlagAction } from './[goalId]/flag-actions';
import { answerGoalQuestion } from './[goalId]/tree-actions';
import { reactToSuggestionAction, recordAttendedAction } from './suggestion-actions';

/**
 * Today on the Goals home (plan #1077): the five things most worth doing,
 * ranked by lib/goals/today.ts, each with one button that does it here or
 * opens where it is done. The rest of what is on you folds underneath in the
 * same order, so nothing that was on the old home's lists is out of reach.
 *
 * Each kind's button is the write that already exists for it:
 *
 * - a question: the answer, as the goal page's question takes it
 * - a Claude step asking you something: a comment on the step, which the next
 *   run reads and unblocks the step from
 * - a flag: the answer, as the goal page's flag takes it
 * - "Did you go?": yes, with a quiet No beside it
 * - a rhythm behind for the period: one more logged against it, or, for one
 *   that counts itself from the job search, a link to where it is counted
 * - a step of yours: done
 * - a suggestion: going, which puts it on Todo, with a quiet Not for me
 * - proposed steps or goals: a link to where they are approved
 * - a goal whose done-when is met: close it, with a quiet Keep it open
 * - a goal nothing has moved on for three weeks: park it, with the same
 *   quiet Keep it open
 *
 * The two quiet second buttons are the answers the old home's lists had, kept
 * so that saying no is not something only the database can do.
 */

type State = { error?: string; message?: string; done?: number };

const initial: State = {};

/** The kinds answered in words, and the field each action reads them from. */
const ANSWER_FIELD: Partial<Record<TodayKind, string>> = {
  question: 'answer',
  ask: 'body',
  flag: 'body',
};

/** The field and value the one button posts, for the kinds whose action reads one. */
const PRIMARY_VALUE: Partial<Record<TodayKind, [string, string]>> = {
  went: ['went', 'yes'],
  step: ['status', 'done'],
  suggestion: ['reaction', 'going'],
  close: ['move', 'close'],
  park: ['move', 'park'],
};

/** The quiet second answer, where the old home offered one. */
const SECOND: Partial<Record<TodayKind, [string, string, string]>> = {
  went: ['went', 'no', 'No'],
  suggestion: ['reaction', 'not_for_me', 'Not for me'],
  close: ['move', 'keep', 'Keep it open'],
  park: ['move', 'keep', 'Keep it open'],
};

/** What each kind says once its button has worked, where the row stays to say it. */
const DONE_WORDS: Partial<Record<TodayKind, string>> = {
  ask: 'Sent. Dash reads it on its next run.',
};

function act(kind: TodayKind, form: FormData): Promise<State> {
  switch (kind) {
    case 'question':
      return answerGoalQuestion({}, form);
    case 'ask':
      return addGoalComment({}, form);
    case 'flag':
      return answerFlagAction({}, form);
    case 'went':
      return recordAttendedAction({}, form);
    case 'rhythm':
      return countRhythmAction(form);
    case 'step':
      return setStepStatusAction(form);
    case 'suggestion':
      return reactToSuggestionAction({}, form);
    case 'close':
    case 'park':
      return settleGoalAction({}, form);
    case 'breakdown':
    case 'plan':
      return Promise.resolve({ error: 'Open it to look it over.' });
  }
}

/** Where a row's title and a link-only button go. */
function hrefFor(item: TodayItem): string {
  switch (item.kind) {
    case 'plan':
      return `/goals/all#area-${item.id}`;
    case 'flag':
      return `/goals/${item.goalId}#flag-${item.id}`;
    case 'question':
    case 'ask':
    case 'step':
    case 'rhythm':
      return `/goals/${item.goalId}#step-${item.id}`;
    default:
      return `/goals/${item.goalId}`;
  }
}

export function TodayList({ today, later }: { today: TodayItem[]; later: TodayItem[] }) {
  return (
    <section aria-labelledby="today-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="today-heading" className="text-ui font-semibold text-ink">
          Today
        </h2>
        {today.length > 0 && (
          <span className="tabular text-small text-ink-muted">
            {today.length} {today.length === 1 ? 'thing' : 'things'}
          </span>
        )}
      </div>
      {today.length === 0 ? (
        <p className="px-1 text-small text-ink-muted">Nothing is waiting on you today.</p>
      ) : (
        <Card>
          <ol className="divide-y divide-border">
            {today.map((item, index) => (
              <TodayRow key={`${item.kind}:${item.id}`} item={item} rank={index + 1} />
            ))}
          </ol>
        </Card>
      )}
      {later.length > 0 && (
        <Disclosure
          title="Also on you"
          meta={`${later.length} more, in the same order`}
          className="px-1"
        >
          <Card>
            <ul className="divide-y divide-border">
              {later.map((item) => (
                <TodayRow key={`${item.kind}:${item.id}`} item={item} rank={null} />
              ))}
            </ul>
          </Card>
        </Disclosure>
      )}
    </section>
  );
}

function TodayRow({ item, rank }: { item: TodayItem; rank: number | null }) {
  const [state, action, pending] = useActionState(
    (_prev: State, form: FormData) => act(item.kind, form),
    initial,
  );
  const answered = !state.error && (state.message !== undefined || state.done !== undefined);
  const field = ANSWER_FIELD[item.kind];
  const primary = PRIMARY_VALUE[item.kind];
  const second = SECOND[item.kind];
  const href = hrefFor(item);
  const meta = [item.on ? formatDay(item.on) : null, item.detail].filter(Boolean).join(' · ');
  const counted = item.countsFrom ? RHYTHM_SOURCE_LINKS[item.countsFrom] : null;

  return (
    <li className="card-pad-x row-pad flex items-start gap-3">
      {rank !== null && (
        <span className="tabular w-4 shrink-0 text-body font-semibold text-ink-ghost" aria-hidden>
          {rank}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1 text-body font-semibold break-words text-ink underline-offset-2 hover:underline"
          >
            {item.title}
            <ExternalLink className="mt-1.5 size-3 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
          </a>
        ) : (
          <Link
            href={href}
            className="block text-body font-semibold break-words text-ink underline-offset-2 hover:underline"
          >
            {item.title}
          </Link>
        )}
        {meta && <p className="text-small break-words text-ink-muted">{meta}</p>}
        <p className="text-small break-words">
          <Link
            href={`/goals/${item.goalId}`}
            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {item.goalTitle}
          </Link>
          {item.unblocks > 1 && (
            <span className="text-ink-muted"> · frees {item.unblocks} steps</span>
          )}
        </p>
        {answered ? (
          <p className="text-small text-positive" role="status">
            {DONE_WORDS[item.kind] ?? state.message ?? 'Done.'}
          </p>
        ) : counted || item.kind === 'breakdown' || item.kind === 'plan' ? (
          <div className="pt-1">
            <Link href={counted?.href ?? href} className={buttonVariants({ variant: 'primary' })}>
              {item.action}
            </Link>
          </div>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-2 pt-1">
            <input type="hidden" name="id" value={item.id} />
            {item.startsOn && <input type="hidden" name="startsOn" value={item.startsOn} />}
            {field && (
              <Input
                name={field}
                required
                aria-label={`Your answer: ${item.title}`}
                placeholder="Your answer"
                className="w-full sm:w-64"
              />
            )}
            <Button
              type="submit"
              name={primary?.[0]}
              value={primary?.[1]}
              pending={pending}
            >
              {item.action}
            </Button>
            {second && (
              <Button
                type="submit"
                name={second[0]}
                value={second[1]}
                variant="ghost"
                pending={pending}
              >
                {second[2]}
              </Button>
            )}
            {state.error && <span className="text-small text-danger">{state.error}</span>}
          </form>
        )}
      </div>
    </li>
  );
}
