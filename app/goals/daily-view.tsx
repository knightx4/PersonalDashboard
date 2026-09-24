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
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { DailyGoal, DailyView as Daily, NextItem, WaitingItem } from '@/lib/goals/daily';
import { missedLine, progressLine, type HomeRhythm } from '@/lib/goals/rhythms';
import { STEP_KIND_LABELS } from '@/lib/goals/steps';

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
 */

type View = Daily & { rhythms: HomeRhythm[] };

const KIND_ICONS: Record<NextItem['kind'], typeof User> = { mine: User, claude: Sparkles };

const WAITING_ICONS: Record<WaitingItem['kind'], typeof User> = {
  question: CircleHelp,
  breakdown: ListChecks,
  goal: Flag,
};

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

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
  }
}

export function DailyView({ view }: { view: View }) {
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
                    className="row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
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
        href={`/goals/${item.goalId}`}
        className="row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
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
  const { goal, areaName, next, more, hasSteps } = daily;
  const tree = `/goals/${goal.id}`;
  const headingId = `goal-${goal.id}`;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="px-1">
        <h2 id={headingId} className="text-ui font-semibold break-words text-ink">
          <Link href={tree} className="underline-offset-2 hover:underline">
            {goal.title}
          </Link>
        </h2>
        <p className="text-small text-ink-muted">{areaName}</p>
      </div>
      <Card>
        {next.length > 0 ? (
          <ul className="divide-y divide-border">
            {next.map((item) => (
              <NextRow key={item.id} item={item} href={tree} />
            ))}
          </ul>
        ) : (
          <p className="row-pad text-small text-ink-muted">
            {hasSteps ? 'Nothing to do next on this goal.' : 'No steps yet.'}
          </p>
        )}
        <Link
          href={tree}
          className="row-pad flex items-center gap-1.5 border-t border-border text-small text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ListTree className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {!hasSteps
            ? 'Break into steps'
            : more > 0
              ? `${more} more in the full tree`
              : 'Full tree'}
        </Link>
      </Card>
    </section>
  );
}

function NextRow({ item, href }: { item: NextItem; href: string }) {
  const Icon = KIND_ICONS[item.kind];
  const meta = [
    STEP_KIND_LABELS[item.kind],
    item.dueOn ? `Due ${formatDate(item.dueOn)}` : null,
    item.under ? `Under ${item.under}` : null,
  ].filter((line): line is string => line !== null);

  return (
    <li>
      <Link
        href={href}
        className="row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">{item.title}</span>
          <span className="block text-small break-words text-ink-muted">{meta.join(' · ')}</span>
        </span>
      </Link>
    </li>
  );
}
