'use client';

import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { GoalOnMap } from '@/lib/learn/map/goals';
import { countText, mapHref } from '@/lib/learn/map/view';
import { usePick, viewOnClick } from './pick';

/**
 * The rail's card for your learning goals on Idea Space (plan #2187.2).
 *
 * Each open goal with what it holds. Pressing one draws its topics on the
 * sky as a constellation, ringed at their targets and joined where one
 * requires another; pressing it again, or another, lets it go, so the plain
 * sky is one press away. A row's next rung shows on hover and focus, and
 * stays under the goal chosen.
 */

export function GoalRail({
  goals,
  holdNext = null,
}: {
  /** Null when they could not be read; undefined where nothing loads them. */
  goals: readonly GoalOnMap[] | null | undefined;
  /** The gallery holds this goal's next rung open, as a pointer would. */
  holdNext?: string | null;
}) {
  const { params, set } = usePick();
  if (goals === undefined) return null;
  if (goals === null) {
    return (
      <Card padding="standard">
        <h2 className="text-ui font-semibold text-ink">Your goals</h2>
        <p className="mt-1 text-ui text-ink-muted">Your goals could not be read just now. Reload to try again.</p>
      </Card>
    );
  }
  if (goals.length === 0) return null;
  const chosen = goals.find((goal) => goal.id === params.goal) ?? null;
  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">
        Your goals
        <span className="tabular ml-2 font-normal text-ink-muted">{countText(goals.length)}</span>
      </h2>
      <ul className="mt-1 divide-y divide-border">
        {goals.map((goal) => {
          const on = goal.id === chosen?.id;
          const change = { goal: on ? null : goal.id, topic: null };
          return (
            <li key={goal.id}>
              <Link
                href={mapHref(params, change)}
                scroll={false}
                onClick={viewOnClick(() => set(change))}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'group block min-h-11 py-2 text-ui',
                  on ? 'text-accent' : 'text-ink hover:text-accent',
                )}
              >
                <span className={cn('block', on && 'font-semibold')}>{goal.name}</span>
                <span className="block text-small text-ink-muted">{goal.line}</span>
                {goal.next && (
                  <span
                    className={cn(
                      'text-small text-ink',
                      on || holdNext === goal.id ? 'block' : 'hidden group-hover:block group-focus-visible:block',
                    )}
                  >
                    {goal.next}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-small text-ink-muted">
        {chosen
          ? `${chosen.stars.length === 1 ? 'Its topic is' : `Its ${countText(chosen.stars.length)} topics are`} ringed on the sky, wider for a higher target, and joined where one needs another. Tap a ring to open the goal there, with what you are ready for. Press the goal again for the plain sky.`
          : 'Choose one to ring its topics on the sky.'}
      </p>
    </Card>
  );
}
