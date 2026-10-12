import { DetailCard, DetailPart, TabbedDetail } from '@/components/patterns/tabbed-detail';
import { goalCrumbs } from '@/lib/goals/crumbs';
import { GOAL_TABS } from '@/lib/goals/goal-page';
import type { GoalPace } from '@/lib/goals/pace';
import type { GoalReview } from '@/lib/goals/reviews';
import { goalGlyph, type GoalProgress } from '@/lib/goals/status';
import type { Goal } from '@/lib/goals/tree';
import type { Place } from '../move-goal';
import { GoalAreaMenu } from './goal-area-menu';
import { GoalGlyph } from './goal-close';
import { GoalHeadingField } from './goal-heading';
import { GoalGlance, GoalProperties, goalDetailCount, goalLine } from './goal-properties';

/**
 * A goal's page frame (plan #1671): the tabbed detail pattern the feature
 * page on /dev/plan is built from. The path, the goal's hexagon and title,
 * the menu that moves or closes it, the Overview, Steps and
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
  pace = null,
  children,
}: {
  goal: Goal;
  areaName: string;
  /** The areas the goal can be moved to, for the menu. */
  places: Place[];
  review: GoalReview | null;
  progress: GoalProgress;
  timeZone: string;
  /** The goal's usual pace, for the properties (plan #1737). */
  pace?: GoalPace | null;
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
      // Title, one line under it, then the menu on the title's line, as on a
      // feature's page (plan #1688).
      description={<span className="text-small">{goalLine(goal, timeZone)}</span>}
      actions={
        <GoalAreaMenu
          goal={{
            id: goal.id,
            title: goal.title,
            areaId: goal.areaId,
            errand: goal.errand ?? false,
            dueOn: goal.dueOn ?? null,
            duePrecision: goal.duePrecision,
            status: goal.status,
          }}
          places={places}
        />
      }
      glance={<GoalGlance goal={goal} review={review} progress={progress} pace={pace} />}
      detailCount={goalDetailCount(goal, progress, timeZone, pace, review)}
      properties={
        <GoalProperties
          goal={goal}
          areaName={areaName}
          review={review}
          progress={progress}
          timeZone={timeZone}
          pace={pace}
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

/**
 * The goal's done-when, at the top of its Overview on a card of its own (plan
 * #1686). It sat under the title on the page's background, which is bare text
 * the tabbed detail pattern no longer allows, and it is the Overview's to say
 * what the goal is for. Editable where it stands, as it was in the header.
 */
export function GoalDoneWhen({
  goal,
  children,
}: {
  goal: Pick<Goal, 'id' | 'acceptance'>;
  /** What is not settled yet about the goal, its fog, on the same card. */
  children?: React.ReactNode;
}) {
  return (
    <DetailCard>
      <DetailPart label="Done when">
        <GoalHeadingField goalId={goal.id} field="acceptance" value={goal.acceptance} />
      </DetailPart>
      {children}
    </DetailCard>
  );
}
