'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ListTree } from 'lucide-react';
import { Progress, SectionTally } from '@/components/plan-tree/counts';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { goalCatalog, goalRows, numberSteps } from '@/lib/goals/plan-rows';
import { countAside } from '@/lib/goals/shaping';
import type { GoalMap } from '@/lib/goals/steps-store';
import { GoalRow, type GoalRowContext } from './goal-row';
import { StepComposer } from './step-parts';

/**
 * A goal's full tree (plan #925), drawn as the dev plan draws a module
 * (plan #982).
 *
 * One card: a heading with the plan's count of steps by state and its banded
 * bar, the column header, and a row per step from the plan's shared tree.
 * Steps from other goals that count towards this one follow in a second card,
 * each under the goal it comes from.
 */
export function StepTree({
  map,
  todoOn,
  unfolded = true,
  opened = false,
}: {
  map: GoalMap;
  todoOn: boolean;
  /** Start with every step's sub-steps showing. */
  unfolded?: boolean;
  /** Start with every step opened. A seam for the gallery; nothing in the app passes it. */
  opened?: boolean;
}) {
  const [showAside, setShowAside] = useState(false);
  const aside = countAside(map.steps);

  const { own, linked, context } = useMemo(() => {
    const numbers = numberSteps([map.steps, ...map.linked.map((entry) => [entry.step])]);
    const options = { numbers, threads: map.threads, showAside };
    const context: GoalRowContext = {
      goalTitle: map.goal.title,
      todoOn,
      rhythms: map.rhythms,
      information: map.information,
      linksOf: map.linksOf,
      otherGoals: map.otherGoals,
      catalog: goalCatalog(map.steps, numbers),
      unfolded,
      opened,
    };
    return {
      own: goalRows(map.steps, options),
      linked: map.linked.map((entry) => ({
        entry,
        row: goalRows([entry.step], options).rows[0],
      })),
      context,
    };
  }, [map, todoOn, showAside, unfolded, opened]);

  const substeps = own.rows.filter((row) => row.kind !== 'decision');

  return (
    <div className="space-y-6">
      <section aria-label="Steps" className="space-y-2">
        {map.steps.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title="No steps yet"
            description="Break the goal into the things that have to happen. Any step can hold sub-steps of its own."
          />
        ) : (
          <div className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <h2 className="text-body font-semibold text-ink">Steps</h2>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <SectionTally tally={own.tally} label={map.goal.title} />
                <Progress label={map.goal.title} progress={own.progress} bands={own.bands} />
              </span>
            </div>
            <ul className="divide-y divide-border">
              <ColumnHeader priority="When" />
              {own.rows.map((row) => (
                <GoalRow
                  key={row.id}
                  node={row}
                  trail={[]}
                  context={context}
                  index={substeps.indexOf(row)}
                  count={substeps.length}
                />
              ))}
            </ul>
            {/* Inside the card, under a rule, as the plan's "Add a step" sits
                at the foot of a module (plan #983). */}
            <div className="border-t border-border px-3 py-2">
              <StepComposer parentId={map.goal.id} label="Add a step" />
            </div>
          </div>
        )}
        {aside > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={showAside}
            onClick={() => setShowAside(!showAside)}
          >
            {showAside
              ? 'Hide the questions put aside'
              : `Show ${aside === 1 ? 'the question' : `the ${aside} questions`} put aside`}
          </Button>
        )}
        {map.steps.length === 0 && <StepComposer parentId={map.goal.id} label="Add a step" />}
      </section>

      {linked.length > 0 && (
        <section
          aria-labelledby="linked-heading"
          className={cn(cardVariants({ padding: 'none' }), 'overflow-hidden')}
        >
          <h2
            id="linked-heading"
            className="border-b border-border px-3 py-2.5 text-body font-semibold text-ink"
          >
            Also counts towards this goal
          </h2>
          <ul className="divide-y divide-border">
            <ColumnHeader priority="When" />
            {linked.map(({ entry, row }) => [
              <li key={`from-${entry.linkId}`} className="px-3 pt-2 text-small text-ink-muted">
                From{' '}
                <Link href={`/goals/${entry.fromGoal.id}`} className="underline">
                  {entry.fromGoal.title}
                </Link>
              </li>,
              row && (
                <GoalRow
                  key={entry.linkId}
                  node={row}
                  trail={[]}
                  context={context}
                  index={0}
                  count={1}
                  unlinkId={entry.linkId}
                />
              ),
            ])}
          </ul>
        </section>
      )}
    </div>
  );
}
