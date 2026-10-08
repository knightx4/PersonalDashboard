import { TabbedDetail } from '@/components/patterns/tabbed-detail';
import { goalCrumbs } from '@/lib/goals/crumbs';
import { GOAL_TABS } from '@/lib/goals/goal-page';
import type { GoalReview } from '@/lib/goals/reviews';
import { goalGlyph, type GoalProgress } from '@/lib/goals/status';
import type { Goal } from '@/lib/goals/tree';
import type { Place } from '../move-goal';
import { GoalAreaMenu } from './goal-area-menu';
import { GoalGlyph } from './goal-close';
import { GoalHeadingField } from './goal-heading';
import { GoalProperties } from './goal-properties';

/**
 * A goal's page frame (plan #1671): the tabbed detail pattern the feature
 * page on /dev/plan is built from. The path, the goal's hexagon and title,
 * its done-when, the menu that moves or closes it, the Overview, Steps and
 * Activity tabs, and the properties column. The page passes the open tab's
 * content as `children`; the gallery draws the same frame from fixtures.
 */
export function GoalDetail({
  goal,
  areaName,
  places,
  review,
  progress,
  timeZone,
  children,
}: {
  goal: Goal;
  areaName: string;
  /** The areas the goal can be moved to, for the menu. */
  places: Place[];
  review: GoalReview | null;
  progress: GoalProgress;
  timeZone: string;
  /** The open tab's content. */
  children: React.ReactNode;
}) {
  const closed = goal.status === 'done';
  const hexagon = goalGlyph(goal.status, progress);
  const open = progress.live - progress.done;
  const tabs = GOAL_TABS.map((t) => (t.id === 'steps' ? { ...t, count: open } : t));
  return (
    <TabbedDetail
      crumbs={goalCrumbs(goal, areaName, { open: !closed && goal.status !== 'dropped' })}
      title={
        <span className="flex items-center gap-2.5">
          <GoalGlyph glyph={hexagon.glyph} label={hexagon.label} closed={closed} />
          <GoalHeadingField goalId={goal.id} field="title" value={goal.title} />
        </span>
      }
      actions={
        <GoalAreaMenu
          goal={{
            id: goal.id,
            title: goal.title,
            areaId: goal.areaId,
            errand: goal.errand ?? false,
            dueOn: goal.dueOn ?? null,
            status: goal.status,
          }}
          places={places}
        />
      }
      description={
        <span className="block space-y-0.5">
          {/* Named only once there is one: the empty prompt already says it. */}
          {goal.acceptance && (
            <span className="block text-small font-semibold text-ink-muted">Done when</span>
          )}
          <GoalHeadingField goalId={goal.id} field="acceptance" value={goal.acceptance} />
        </span>
      }
      properties={
        <GoalProperties
          goal={goal}
          areaName={areaName}
          review={review}
          progress={progress}
          timeZone={timeZone}
        />
      }
      tabs={tabs}
      label="Goal"
      className="gap-y-2 lg:grid-rows-[auto_1fr] lg:gap-y-0"
    >
      {children}
    </TabbedDetail>
  );
}
