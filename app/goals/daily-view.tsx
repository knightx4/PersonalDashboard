import Link from 'next/link';
import {
  ChevronRight,
  CircleHelp,
  Flag,
  ListChecks,
  ListTree,
  Repeat,
  Sparkles,
  User,
} from 'lucide-react';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { DailyGoal, DailyView as Daily, NextItem, WaitingItem } from '@/lib/goals/daily';
import { formatDay } from '@/lib/goals/dates';
import { VERDICT_LABELS, type GoalReview, type Verdict } from '@/lib/goals/reviews';
import { missedLine, progressLine, type HomeRhythm } from '@/lib/goals/rhythms';
import { STEP_KIND_LABELS } from '@/lib/goals/steps';
import type { Suggestion } from '@/lib/goals/suggestions';
import { GoalProgress } from './goal-progress';
import { SuggestionsList } from './suggestions-list';

/**
 * The daily view on the Goals home (plan #926).
 *
 * What is waiting on you comes first, because each of those holds something
 * else up. Then one card per active goal with its next one to three things,
 * yours first. Every row is a link into the goal's full tree, where the step
 * can be done, edited or broken down; the home itself only reads.
 *
 * Rhythms at risk this period (plan #928) sit between the two: they are
 * running out of days, which makes them more pressing than a goal's next step
 * and less than a question holding a branch up.
 *
 * After time away (plan #935) nothing is shown as overdue. A rhythm with
 * missed periods behind it gets one line saying how many, beside this
 * period's progress, and a step whose date has passed is listed as a plain
 * next item.
 *
 * The weekly run's suggestions (plan #934) come after the waiting list, with
 * their own going and not for me buttons: the one part of the home that
 * writes, because a reaction is quicker here than a trip into the tree.
 */

type View = Daily & { rhythms: HomeRhythm[]; suggestions: Suggestion[] };

const KIND_ICONS: Record<NextItem['kind'], typeof User> = { mine: User, claude: Sparkles };

const WAITING_ICONS: Record<WaitingItem['kind'], typeof User> = {
  question: CircleHelp,
  breakdown: ListChecks,
  goal: Flag,
  review: Sparkles,
};

const VERDICT_TONES: Record<Verdict, DevTone> = {
  on_track: 'positive',
  stalled: 'caution',
  waiting_on_you: 'caution',
};

function rhythmLine(rhythm: HomeRhythm): string {
  const left =
    !rhythm.atRisk || rhythm.period === 'day'
      ? null
      : rhythm.daysLeft === 1
        ? 'last day'
        : `${rhythm.daysLeft} days left`;
  return [
    progressLine(rhythm.period, { count: rhythm.count, target: rhythm.target }),
    left,
    rhythm.missed > 0 ? missedLine(rhythm.period, rhythm.missed) : null,
    rhythm.goalTitle,
  ]
    .filter(Boolean)
    .join(' · ');
}

function waitingLine(item: WaitingItem): string {
  switch (item.kind) {
    case 'question':
      return `Question to answer · ${item.goalTitle}`;
    case 'breakdown':
      return `${item.count} proposed ${item.count === 1 ? 'step' : 'steps'} to approve`;
    case 'goal':
      return 'Goal Claude proposed';
    case 'review':
      return `Claude’s result to read · ${item.goalTitle}`;
  }
}

export function DailyView({
  view,
  timeZone,
}: {
  view: View;
  /** The account's zone, for the times on the week's suggestions. */
  timeZone: string;
}) {
  if (view.goals.length === 0 && view.waiting.length === 0) {
    return (
      <EmptyState
        icon={Flag}
        title="No goals yet"
        description="Add the goals you are working towards, and the next few things for each will show here."
        action={{ label: 'Add a goal', href: '/goals/all' }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {view.waiting.length > 0 && (
        <section aria-labelledby="waiting-heading" className="space-y-2">
          <h2 id="waiting-heading" className="px-1 text-ui font-semibold text-ink">
            Waiting on you
          </h2>
          <Card>
            <ul className="divide-y divide-border">
              {view.waiting.map((item) => (
                <WaitingRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      {view.suggestions.length > 0 && <SuggestionsList suggestions={view.suggestions} timeZone={timeZone} />}

      {view.rhythms.length > 0 && (
        <section aria-labelledby="risk-heading" className="space-y-2">
          <h2 id="risk-heading" className="px-1 text-ui font-semibold text-ink">
            Rhythms to keep up
          </h2>
          <Card>
            <ul className="divide-y divide-border">
              {view.rhythms.map((rhythm) => (
                <li key={rhythm.id}>
                  <Link
                    href={`/goals/${rhythm.goalId}`}
                    className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
                  >
                    <Repeat
                      className="mt-0.5 size-4 shrink-0 text-ink-muted"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui break-words text-ink">{rhythm.title}</span>
                      <span className="block text-small break-words text-ink-muted">
                        {rhythmLine(rhythm)}
                      </span>
                    </span>
                    <ChevronRight
                      className="mt-0.5 size-4 shrink-0 text-ink-muted"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {view.goals.map((daily) => (
        <GoalCard key={daily.goal.id} daily={daily} />
      ))}
    </div>
  );
}

function WaitingRow({ item }: { item: WaitingItem }) {
  const Icon = WAITING_ICONS[item.kind];
  return (
    <li>
      <Link
        href={item.kind === 'review' ? `/goals/${item.goalId}#step-${item.id}` : `/goals/${item.goalId}`}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">{item.title}</span>
          <span className="block text-small break-words text-ink-muted">{waitingLine(item)}</span>
        </span>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </li>
  );
}

function GoalCard({ daily }: { daily: DailyGoal }) {
  const { goal, areaName, next, more, hasSteps, progress, review } = daily;
  const tree = `/goals/${goal.id}`;
  const headingId = `goal-${goal.id}`;
  const treeLabel = !hasSteps
    ? 'Break into steps'
    : more > 0
      ? `${more} more in the full tree`
      : 'Full tree';

  // A goal with nothing next gets no card, since the card would only say there
  // is nothing to show (law 1). The link to the tree moves under the heading.
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="px-1">
        <h2 id={headingId} className="text-ui font-semibold break-words text-ink">
          <Link href={tree} className="underline-offset-2 hover:underline">
            {goal.title}
          </Link>
        </h2>
        {/* The area leads the progress line rather than taking a line of its
            own, so a goal's heading is two lines, not three. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          <span className="text-small text-ink-muted">{areaName}</span>
          {progress && <GoalProgress progress={progress} label={goal.title} />}
        </div>
        {review && <ReviewLine review={review} />}
        {next.length === 0 && (
          <Link
            href={tree}
            className="mt-1 inline-flex items-center gap-1.5 text-small text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            <ListTree className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {treeLabel}
          </Link>
        )}
      </div>
      {next.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {next.map((item) => (
              <NextRow key={item.id} item={item} href={tree} />
            ))}
          </ul>
          <Link
            href={tree}
            className="card-pad-x row-pad flex items-center gap-1.5 border-t border-border text-small text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            <ListTree className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {treeLabel}
          </Link>
        </Card>
      )}
    </section>
  );
}

/**
 * The weekly run's newest verdict on the goal (plan #1018): the verdict and
 * why on one line, the next move on the next. A stalled goal's next move is
 * also a proposed step, which the waiting list above offers to approve.
 */
function ReviewLine({ review }: { review: GoalReview }) {
  const checked = formatDay(review.createdAt.slice(0, 10));
  return (
    <div className="space-y-0.5 pt-1 text-small break-words text-ink-muted">
      <p>
        <StateLabel
          glyph={null}
          word={VERDICT_LABELS[review.verdict]}
          tone={VERDICT_TONES[review.verdict]}
          title={`Weekly check, ${checked}`}
          className="mr-1.5 font-semibold"
        />
        {review.reason}
      </p>
      <p>Next: {review.nextMove}</p>
    </div>
  );
}

function NextRow({ item, href }: { item: NextItem; href: string }) {
  const Icon = KIND_ICONS[item.kind];
  // Whose step it is is the glyph's to say; the word is for a screen reader.
  // Printed as well, it was a second line under every row that repeated the
  // glyph beside it, and the only line under an undated step.
  const meta = [
    item.dueOn ? `Due ${formatDay(item.dueOn)}` : null,
    item.under ? `Under ${item.under}` : null,
  ].filter((line): line is string => line !== null);

  return (
    <li>
      <Link
        href={href}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">
            <span className="sr-only">{STEP_KIND_LABELS[item.kind]}: </span>
            {item.title}
          </span>
          {meta.length > 0 && (
            <span className="block text-small break-words text-ink-muted">{meta.join(' · ')}</span>
          )}
        </span>
      </Link>
    </li>
  );
}
