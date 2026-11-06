import { DetailCard, DetailPart, TabbedDetail } from '@/components/patterns/tabbed-detail';
import { toRef } from '@/lib/core/refs';
import { goalCrumbs } from '@/lib/goals/crumbs';
import { GOAL_TAB_ADDRESS, GOAL_TABS } from '@/lib/goals/goal-page';
import { tabsWithLists, type ListView } from '@/lib/goals/goal-lists';
import type { GoalPace } from '@/lib/goals/pace';
import type { GoalReview } from '@/lib/goals/reviews';
import { goalGlyph, type GoalProgress } from '@/lib/goals/status';
import { toGoalActivity, type Goal } from '@/lib/goals/tree';
import type { Place } from '../move-goal';
import { GoalActivitySwitch, type ActivitySwitchDrawn } from './goal-activity-switch';
import { GoalAreaMenu } from './goal-area-menu';
import { GoalGlyph } from './goal-close';
import { GoalHeadingField } from './goal-heading';
import { GoalGlance, GoalProperties, goalDetailCount, goalLine } from './goal-properties';

/**
 * A goal's page frame (plan #1671): the tabbed detail pattern the feature
 * page on /dev/plan is built from. The path, the goal's hexagon and title,
 * the menu that moves or closes it, the Dashboard, Plan, Work & files and
 * History tabs (plan #2778.4), and the properties column. The page passes the open tab's
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
  metrics = null,
  lists = [],
  unreadFiles = 0,
  activityDrawn,
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
  /**
   * The goal's metrics under its facts (plan #2084.3), with how many facts
   * they add to the phone's fold; null where there is nothing to count.
   */
  metrics?: { node: React.ReactNode; count: number } | null;
  /**
   * The goal's lists (plan #2330.3). Three or more give each its own tab
   * after Steps; fewer leave the tabs as they are.
   */
  lists?: readonly ListView[];
  /** How many of the goal's files Dash wrote that are not read yet, counted on Work & files. */
  unreadFiles?: number;
  /** For the gallery: the active or passive switch drawn mid-save or failed. */
  activityDrawn?: ActivitySwitchDrawn;
  /** The open tab's content. */
  children: React.ReactNode;
}) {
  const closed = goal.status === 'done';
  const hexagon = goalGlyph(goal.status, progress);
  const open = progress.live - progress.done;
  const line = goalLine(goal, timeZone);
  const tabs = tabsWithLists(
    GOAL_TABS.map((t) =>
      // Each count says what it counts, as the approved mockup's '5 left' and
      // '2 unread' do (plan #2778.11).
      t.id === 'plan'
        ? { ...t, count: open, countWord: 'left' }
        : t.id === 'files'
          ? { ...t, count: unreadFiles, countWord: 'unread' }
          : t,
    ),
    lists,
  );
  return (
    <TabbedDetail
      subject={{
        ref: toRef('goals.items', goal.id),
        path: goalCrumbs(goal, areaName, { open: !closed && goal.status !== 'dropped' }),
      }}
      title={
        <span className="flex items-center gap-2.5">
          <GoalGlyph glyph={hexagon.glyph} label={hexagon.label} closed={closed} />
          <GoalHeadingField goalId={goal.id} field="title" value={goal.title} />
        </span>
      }
      // Title, one line under it, then the menu on the title's line, as on a
      // feature's page (plan #1688).
      description={
        // Active or passive (plan #2503.2) at the end of the one line, for a
        // goal still being kept: a closed one is neither worked on nor watched.
        goal.status === 'open' || goal.status === 'parked' ? (
          <GoalActivitySwitch
            goalId={goal.id}
            activity={toGoalActivity(goal.activity)}
            drawn={activityDrawn}
          >
            <span className="text-small">{line}</span>
          </GoalActivitySwitch>
        ) : (
          // The height the switch gave the line, so closing the goal does not
          // pull the page up under the ring (moment "A goal closing").
          <span className="flex min-h-[calc(var(--control-h)+2px)] items-center text-small">
            {line}
          </span>
        )
      }
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
            archivedAt: goal.archivedAt ?? null,
          }}
          places={places}
          steps={progress.live}
        />
      }
      glance={<GoalGlance goal={goal} review={review} progress={progress} pace={pace} />}
      detailCount={goalDetailCount(goal, progress, timeZone, pace, review) + (metrics?.count ?? 0)}
      properties={
        <>
          <GoalProperties
            goal={goal}
            areaName={areaName}
            review={review}
            progress={progress}
            timeZone={timeZone}
            pace={pace}
          />
          {metrics?.node}
        </>
      }
      tabs={tabs}
      address={GOAL_TAB_ADDRESS}
      label="Goal"
      titleSize="headline"
      className="gap-y-2 lg:grid-rows-[auto_1fr] lg:gap-y-0"
    >
      {children}
    </TabbedDetail>
  );
}

/**
 * The goal's done-when, at the top of its Dashboard on a card of its own (plan
 * #1686). It sat under the title on the page's background, which is bare text
 * the tabbed detail pattern no longer allows, and it is the Dashboard's to say
 * what the goal is for. Editable where it stands, as it was in the header.
 */
export function GoalDoneWhen({
  goal,
  children,
}: {
  goal: Pick<Goal, 'id' | 'acceptance'>;
  /** What sits under the sentence on the same card: the goal's list chips (plan #2330.3). */
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
