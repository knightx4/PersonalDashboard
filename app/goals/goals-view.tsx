'use client';

import { useActionState, useState } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { IconButton } from '@/components/ui/icon-button';
import { useRouter } from 'next/navigation';
import { Archive, ChevronRight, CloudFog, Flag, ListFilter, ListTree, Repeat } from 'lucide-react';
import { ViewChips } from '@/components/plan-tree/view-chips';
import { PageHeader } from '@/components/shell/page-header';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { EmptyState } from '@/components/ui/empty-state';
import { PaidHint } from '@/components/ui/paid-hint';
import { ComposeBody, ComposeTitle, InlineInput, InlineTextarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import {
  ALL_GOALS_VIEWS,
  areaInView,
  areasInView,
  countAllGoalsView,
  type AllGoalsView,
  type AreaInView,
} from '@/lib/goals/all-goals';
import { VIEW_LABEL } from '@/lib/core/move';
import { goalViewHref } from '@/lib/goals/plan-rows';
import type { AreaRunView } from '@/lib/goals/shaping';
import type { GoalProgress as GoalProgressData } from '@/lib/goals/status';
import {
  AREA_NAME_MAX,
  AREA_NOTE_MAX,
  GOAL_ACCEPTANCE_MAX,
  GOAL_FOG_MAX,
  GOAL_TITLE_MAX,
  type AreaWithGoals,
  type Goal,
} from '@/lib/goals/tree';
import { cn } from '@/lib/cn';
import { reopenedGoal } from '@/lib/goals/optimistic';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { OrderedSiblings, useMoveSelf, type SiblingMove } from '@/lib/use-sibling-order';
import { approveGoalAction } from './[goalId]/shaping-actions';
import {
  addArea,
  addGoal,
  approveAreaAction,
  archiveAreaAction,
  archiveGoalAction,
  editGoal,
  moveAreaAction,
  moveGoalAction,
  renameAreaAction,
  setAreaNoteAction,
  settleGoalAction,
  type GoalsActionState,
} from './actions';
import { AreaPlanner } from './area-planner';
import { GoalProgress } from './goal-progress';
import { useMoveToItems, type Place } from './move-goal';
import { DashCredit } from '@/components/ui/dash-mark';
import { stepHref } from '@/lib/goals/all-goals';
import { areaCrumbs } from '@/lib/goals/crumbs';

/**
 * Areas and the goals under them (plan #924).
 *
 * Each area is a heading, a line saying what you want from it, and its goals
 * in a card beneath, then the rhythms inside those goals with this period's
 * progress, and Plan this area asking Dash to propose the goals it needs.
 * An area's name opens its own page (plan #1619), which draws the same
 * section alone with the area's name as its heading, and is where the area
 * is renamed, as a goal's title opens its tree, where it is renamed.
 * Everything else is edited where it stands (law 12): a note, a done-when or
 * a note of fog is an inline input saved on blur. Reordering and archiving sit in each
 * row's menu, which works the same with a thumb as with a mouse. Archiving
 * offers an undo, and the record of it stays in the history either way.
 *
 * Open, On you and Everything narrow the goals (plan #1158), with the chips a
 * goal's steps have. Everything is the one view with finished and archived
 * goals in it, and an archived goal there can be restored from its menu.
 */

const initial: GoalsActionState = {};

/** Each goal's bar and whose move it is, keyed by goal id; a goal with no steps is absent. */
type Progress = Record<string, GoalProgressData>;

/** Save on blur when the words changed. A required field cleared to nothing is put back. */
function commitOnBlur(before: string, { required = false }: { required?: boolean } = {}) {
  return (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value.trim();
    if (required && value === '') {
      event.target.value = before;
      return;
    }
    if (value !== before) event.target.form?.requestSubmit();
  };
}

function revertOnEscape(before: string) {
  return (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.currentTarget.value = before;
      event.currentTarget.blur();
    }
  };
}

/** Wrap a row action for the menu, so a refusal is said in a toast rather than lost. */
function useMenuAction() {
  const toast = useToast();
  return (action: (form: FormData) => Promise<GoalsActionState>) => async (form: FormData) => {
    const result = await action(form);
    if (result.error) toast({ text: result.error });
  };
}

function moveItems(
  run: (form: FormData) => Promise<void>,
  id: string,
  index: number,
  count: number,
): ActionMenuItem[] {
  return [
    {
      id: 'up',
      label: 'Move up',
      disabled: index === 0,
      formAction: run,
      formFields: { id, direction: 'up' },
    },
    {
      id: 'down',
      label: 'Move down',
      disabled: index === count - 1,
      formAction: run,
      formFields: { id, direction: 'down' },
    },
  ];
}

/** Move up or Move down on a goal, as the form its action reads. */
async function writeGoalMove(move: SiblingMove) {
  const form = new FormData();
  form.set('id', move.id);
  form.set('direction', move.direction);
  return moveGoalAction(form);
}

/** Reopen or Take it back up, as the form its action reads. */
async function writeReopen(id: string) {
  const form = new FormData();
  form.set('id', id);
  form.set('move', 'reopen');
  return settleGoalAction({}, form);
}

/** What each view says when it has no goal to show. */
const EMPTY_VIEW: Record<AllGoalsView, { title: string; description: string }> = {
  open: {
    title: 'No open goals',
    description: 'Every goal is finished or archived. Everything shows them all.',
  },
  you: {
    title: 'Nothing is waiting on you',
    description: 'No goal has a step, question or approval of yours right now.',
  },
  all: { title: 'No goals yet', description: 'Add a goal under an area.' },
};

export function GoalsView({
  areas: allAreas,
  view,
  onYou: onYouCounts,
  progress,
  areaRuns,
  rhythms = {},
  canRun,
  areaId,
  planCost = null,
}: {
  areas: AreaWithGoals[];
  /** Which goals show (plan #1158); in the address as `?view=`. */
  view: AllGoalsView;
  /** How many things on you each goal holds, keyed by goal id, from the Today list. */
  onYou: Record<string, number>;
  progress: Progress;
  /** Each area's latest Plan this area run, keyed by area id. */
  areaRuns: Record<string, AreaRunView>;
  /** Each area's rhythms, keyed by area id; an area with none is absent. */
  rhythms?: Record<string, AreaRhythm[]>;
  /** Whether this account can start a Claude run (the owner's only). */
  canRun: boolean;
  /** Draw this one area as its own page (plan #1619) rather than every area. */
  areaId?: string;
  /** The usual cost of one Plan this area run, for the hint beside its button; none draws no hint. */
  planCost?: CostEstimate | null;
}) {
  const onYou = new Map(Object.entries(onYouCounts));
  // Where a goal can be moved to: every live area, shown in this view or not.
  const places = allAreas.map((area) => ({ id: area.id, name: area.name }));
  const pageIndex = areaId ? allAreas.findIndex((area) => area.id === areaId) : -1;
  const pageArea = pageIndex >= 0 ? allAreas[pageIndex] : null;
  const counted = pageArea ? [pageArea] : allAreas;
  const chips = counted.length > 0 && (
    <div className="flex items-center gap-2">
      <ListFilter className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      <ViewChips
        view={view}
        chips={ALL_GOALS_VIEWS}
        labels={VIEW_LABEL}
        hrefOf={(candidate) =>
          goalViewHref(pageArea ? `/goals/area/${pageArea.id}` : '/goals/all', candidate)
        }
        counts={{
          open: countAllGoalsView(counted, 'open', onYou),
          you: countAllGoalsView(counted, 'you', onYou),
        }}
        scroll={false}
      />
    </div>
  );

  if (pageArea) {
    const area = areaInView(pageArea, view, onYou);
    return (
      <AreaSection
        area={area}
        index={pageIndex}
        count={allAreas.length}
        progress={progress}
        run={areaRuns[area.id] ?? null}
        rhythms={rhythms[area.id] ?? []}
        canRun={canRun}
        planCost={planCost}
        places={places}
        page={{
          chips,
          empty: area.goals.length === 0 && pageArea.goals.length > 0 ? EMPTY_VIEW[view] : null,
        }}
      />
    );
  }

  const areas = areasInView(allAreas, view, onYou);
  return (
    <div className="space-y-6">
      {chips}
      {allAreas.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="No areas yet"
          description="Start with the directions you care about, such as money, career or the city, then put goals under each."
        />
      ) : areas.length === 0 ? (
        <EmptyState icon={Flag} {...EMPTY_VIEW[view]} />
      ) : (
        areas.map((area, index) => (
          <AreaSection
            key={area.id}
            area={area}
            index={index}
            count={areas.length}
            progress={progress}
            run={areaRuns[area.id] ?? null}
            rhythms={rhythms[area.id] ?? []}
            canRun={canRun}
            planCost={planCost}
            places={places}
            view={view}
          />
        ))
      )}
      <AreaComposer />
    </div>
  );
}

function AreaSection({
  area,
  index,
  count,
  progress,
  run,
  rhythms,
  canRun,
  planCost,
  places,
  view = 'open',
  page,
}: {
  area: AreaInView;
  index: number;
  count: number;
  progress: Progress;
  run: AreaRunView | null;
  rhythms: AreaRhythm[];
  canRun: boolean;
  planCost: CostEstimate | null;
  places: Place[];
  /** The view All goals is on, which the area's link keeps. */
  view?: AllGoalsView;
  /**
   * Drawn as the area's own page: the name is the page's heading and is
   * renamed there, the view chips sit under the note, and a view that leaves
   * none of its goals says so.
   */
  page?: { chips: React.ReactNode; empty: { title: string; description: string } | null };
}) {
  const router = useRouter();
  const [renameState, rename, renaming] = useActionState(renameAreaAction, initial);
  const [noteState, saveNote, savingNote] = useActionState(setAreaNoteAction, initial);
  const menuAction = useMenuAction();
  const toast = useToast();
  // On All goals an area folds under its name (note 24a2055c); its own page does not.
  const [open, setOpen] = useState(true);
  const folded = !page && !open;

  async function archive(form: FormData) {
    const result = await archiveAreaAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    // An archived area has no page, so its own page goes back to All goals.
    if (page) router.push('/goals/all');
    toast({
      text: `Archived ${area.name}.`,
      undo: async () => {
        const restore = new FormData();
        restore.set('id', area.id);
        restore.set('restore', 'true');
        const back = await archiveAreaAction(restore);
        if (back.error) throw new Error(back.error);
      },
    });
  }

  const goalCount = area.goals.length;
  // The confirm counts every live goal the archive takes, shown in this view or not.
  const liveCount = area.liveCount;
  const items: ActionMenuItem[] = [
    ...moveItems(menuAction(moveAreaAction), area.id, index, count),
    {
      id: 'archive',
      label: 'Archive area',
      destructive: true,
      formAction: archive,
      formFields: { id: area.id },
      confirm:
        liveCount === 0
          ? `Archive ${area.name}?`
          : `Archive ${area.name} and its ${liveCount === 1 ? 'goal' : `${liveCount} goals`}?`,
    },
  ];

  const proposedCount = area.goals.filter((goal) => goal.status === 'proposed').length;
  // The rhythms of the goals this view shows, so On you does not list the rest.
  const shownGoals = new Set(area.goals.map((goal) => goal.id));
  const shownRhythms = rhythms.filter((rhythm) => shownGoals.has(rhythm.goalId));

  return (
    <section id={`area-${area.id}`} aria-label={area.name} className="scroll-mt-bar space-y-2">
      {page ? (
        <PageHeader
          crumbs={areaCrumbs(area)}
          title={
            <form action={rename}>
              <input type="hidden" name="id" value={area.id} />
              <InlineInput
                name="name"
                required
                maxLength={AREA_NAME_MAX}
                defaultValue={area.name}
                key={`name-${area.name}`}
                aria-label={`Rename ${area.name}`}
                disabled={renaming}
                onBlur={commitOnBlur(area.name, { required: true })}
                onKeyDown={revertOnEscape(area.name)}
                className="font-display text-title tracking-tight max-sm:min-h-11 sm:text-title"
              />
            </form>
          }
          actions={<ActionMenu label={`${area.name} actions`} items={items} />}
        />
      ) : (
        <div className="flex items-center gap-2">
          <IconButton
            label={open ? `Fold ${area.name}` : `Open ${area.name}`}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={`area-body-${area.id}`}
            className="-mr-1"
          >
            <ChevronRight
              className={cn('transition-transform duration-quick', open && 'rotate-90')}
              strokeWidth={1.75}
              aria-hidden
            />
          </IconButton>
          <Link
            href={goalViewHref(`/goals/area/${area.id}`, view)}
            // The size the rename field had here (InlineInput), so the area still heads its goals.
            // eslint-disable-next-line no-restricted-syntax -- text-base matches InlineInput's phone size.
            className="press-area min-w-0 flex-1 border border-transparent px-1 py-0.5 text-base font-semibold text-ink [overflow-wrap:anywhere] hover:underline sm:text-ui"
          >
            {area.name}
          </Link>
          {folded && (
            <span className="shrink-0 text-small text-ink-muted">
              {goalCount === 1 ? '1 goal' : `${goalCount} goals`}
            </span>
          )}
          <ActionMenu label={`${area.name} actions`} items={items} />
        </div>
      )}
      {renameState.error && <p className="px-1 text-small text-danger">{renameState.error}</p>}
      <div id={`area-body-${area.id}`} hidden={folded} className="space-y-2">
        {/* The area's sentence on a card rather than bare on the page (plan
            #1686). An area with no goals yet also holds the line offering to
            plan it, so the two share the card. An empty sentence beside goals
            stays one quiet prompt line with no card, which would otherwise
            read as an empty box above every area. */}
        <div
          className={
            goalCount === 0 || area.note
              ? cn(cardVariants({ padding: 'dense' }), 'space-y-2')
              : 'contents'
          }
        >
          <form action={saveNote}>
            <input type="hidden" name="id" value={area.id} />
            <InlineTextarea
              name="note"
              maxLength={AREA_NOTE_MAX}
              defaultValue={area.note ?? ''}
              key={`note-${area.note ?? ''}`}
              placeholder="What you want from this area, in a sentence"
              aria-label={`What you want from ${area.name}`}
              disabled={savingNote}
              onBlur={commitOnBlur(area.note ?? '')}
              onKeyDown={revertOnEscape(area.note ?? '')}
              className="text-ink-muted"
            />
          </form>
          {noteState.error && <p className="px-1 text-small text-danger">{noteState.error}</p>}
          {goalCount === 0 && (
            <AreaPlanner areaId={area.id} hasGoals={liveCount > 0} run={run} canRun={canRun} cost={planCost} />
          )}
        </div>
        {page?.chips && <div className="pt-2 pb-1">{page.chips}</div>}
        {page?.empty && <EmptyState icon={Flag} {...page.empty} />}

        {proposedCount > 1 && <ApproveArea areaId={area.id} count={proposedCount} />}
        {goalCount > 0 && (
          <Card>
            <ul className="divide-y divide-border">
              {/* The goals in the order the list holds, so Move up swaps a
                  goal before the server has answered (plan #1851). */}
              <OrderedSiblings items={area.goals} write={writeGoalMove}>
                {(ordered) =>
                  ordered.map((goal, i) => (
                    <GoalRow
                      key={goal.id}
                      goal={goal}
                      index={i}
                      count={goalCount}
                      steps={progress[goal.id]}
                      places={places}
                    />
                  ))
                }
              </OrderedSiblings>
            </ul>
          </Card>
        )}
        {shownRhythms.length > 0 && <AreaRhythms areaId={area.id} rhythms={shownRhythms} />}
        {goalCount > 0 && (
          <AreaPlanner areaId={area.id} hasGoals={liveCount > 0} run={run} canRun={canRun} cost={planCost} />
        )}
        <GoalComposer areaId={area.id} areaName={area.name} learn={area.learn ?? false} />
      </div>
    </section>
  );
}

function GoalRow({
  goal: served,
  index,
  count,
  steps,
  places,
}: {
  goal: Goal;
  index: number;
  count: number;
  steps: GoalProgressData | undefined;
  places: Place[];
}) {
  // Reopen and Take it back up open the goal on the row when pressed, and
  // put it back with the reason in a toast if refused (plan #1851).
  const { shown: goal, run: reopen } = useOptimisticWrite<Goal, 'reopen'>({
    value: served,
    apply: (current) => reopenedGoal(current),
    write: () => writeReopen(served.id),
  });
  const moveSelf = useMoveSelf(served.id, writeGoalMove);
  const [editState, edit, editing] = useActionState(editGoal, initial);
  // Fog is shown when the goal has some, or once you choose to add it.
  const [addingFog, setAddingFog] = useState(false);
  const toast = useToast();
  const showFog = goal.fog !== null || addingFog;

  async function archive(form: FormData) {
    const result = await archiveGoalAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    toast({
      text: `Archived ${goal.title}.`,
      undo: async () => {
        const restore = new FormData();
        restore.set('id', goal.id);
        restore.set('restore', 'true');
        const back = await archiveGoalAction(restore);
        if (back.error) throw new Error(back.error);
      },
    });
  }

  async function restore(form: FormData) {
    form.set('restore', 'true');
    const result = await archiveGoalAction(form);
    if (result.error) toast({ text: result.error });
  }

  const moveToItems = useMoveToItems(goal, places);

  // An archived goal, shown only under Everything, is restored or left be.
  const archived = Boolean(goal.archivedAt);
  const items: ActionMenuItem[] = archived
    ? [{ id: 'restore', label: 'Restore goal', formAction: restore, formFields: { id: goal.id } }]
    : [
        {
          id: 'up',
          label: 'Move up',
          disabled: index === 0,
          onSelect: () => moveSelf('up'),
        },
        {
          id: 'down',
          label: 'Move down',
          disabled: index === count - 1,
          onSelect: () => moveSelf('down'),
        },
        ...(showFog
          ? []
          : [
              { id: 'fog', label: 'Say what is not known yet', onSelect: () => setAddingFog(true) },
            ]),
        ...moveToItems,
        {
          id: 'archive',
          label: 'Archive goal',
          destructive: true,
          formAction: archive,
          formFields: { id: goal.id },
        },
      ];

  return (
    <li className="card-pad-x row-pad flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {/* The name opens the tree, where it is renamed; editing it here
            took the click meant for opening the goal. */}
        <Link
          href={`/goals/${goal.id}`}
          className="press-area flex items-center gap-1.5 px-1 py-0.5 font-medium text-ink hover:underline"
        >
          {goal.title}
        </Link>
        {/* The done-when opens the tree too, where it is edited beside the
            name; editing it here took the click meant for opening the goal. */}
        {goal.acceptance && (
          <Link
            href={`/goals/${goal.id}`}
            // ui-ok: the done-when is itself the link to the goal, and a link cannot hold links.
            className="press-area block px-1 py-0.5 whitespace-pre-line text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {goal.acceptance}
          </Link>
        )}
        {showFog && (
          <form action={edit} className="flex items-start gap-1">
            <input type="hidden" name="id" value={goal.id} />
            <CloudFog
              className="mt-1.5 ml-1 size-3.5 shrink-0 text-ink-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <InlineTextarea
              name="fog"
              maxLength={GOAL_FOG_MAX}
              defaultValue={goal.fog ?? ''}
              key={`fog-${goal.fog ?? ''}`}
              autoFocus={addingFog && goal.fog === null}
              placeholder="What is not known yet"
              aria-label={`What is not known yet about ${goal.title}`}
              disabled={editing}
              onBlur={(event) => {
                if (event.target.value.trim() === '' && goal.fog === null) setAddingFog(false);
                commitOnBlur(goal.fog ?? '')(event);
              }}
              onKeyDown={revertOnEscape(goal.fog ?? '')}
              className="text-ink-muted"
            />
          </form>
        )}
        {/* The bar first and the way into the tree after it, on one line
            that wraps, rather than a line for each. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5">
          {/* `contents`, so its parts wrap in this line beside Full tree rather than
              as a block of their own: at 390 a goal's meta then takes two lines. */}
          {steps && <GoalProgress progress={steps} label={goal.title} className="contents" />}
          <Link
            href={`/goals/${goal.id}`}
            className={cn('press-area inline-flex items-center gap-1 text-small', linkVariants({ tone: 'quiet' }))}
          >
            <ListTree className="size-3.5" strokeWidth={1.75} aria-hidden />
            {goal.status === 'proposed'
              ? 'See what Dash proposed'
              : steps
                ? 'Full tree'
                : 'Break into steps'}
          </Link>
        </div>
        {archived && (
          <p className="flex items-center gap-1 px-1 pt-0.5 text-small text-ink-muted">
            <Archive className="size-3.5" strokeWidth={1.75} aria-hidden />
            Archived. Restore it from its menu to work on it again.
          </p>
        )}
        {!archived && goal.status === 'proposed' && (
          <SettleProposedGoal goalId={goal.id} onTurnDown={archive} />
        )}
        {!archived && (goal.status === 'parked' || goal.status === 'done') && (
          <TakeBackUp status={goal.status} onReopen={() => reopen('reopen')} />
        )}
        {editState.error && <p className="px-1 text-small text-danger">{editState.error}</p>}
      </div>
      <ActionMenu label={`${goal.title} actions`} items={items} />
    </li>
  );
}

/**
 * Approve or turn down a goal Claude proposed, where it stands. Approving
 * opens it with the steps proposed under it; turning it down archives it,
 * with an undo, and Claude does not propose it again.
 */
function SettleProposedGoal({
  goalId,
  onTurnDown,
}: {
  goalId: string;
  onTurnDown: (form: FormData) => Promise<void>;
}) {
  const [state, approve, approving] = useActionState(approveGoalAction, {});
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
      <form action={approve}>
        <input type="hidden" name="goalId" value={goalId} />
        <Button type="submit" size="sm" variant="secondary" pending={approving}>
          Approve
        </Button>
      </form>
      <form action={onTurnDown}>
        <input type="hidden" name="id" value={goalId} />
        <Button type="submit" size="sm" variant="ghost" disabled={approving}>
          Turn down
        </Button>
      </form>
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </div>
  );
}

/**
 * A parked or closed goal says so where it stands, with the one move back
 * (plan #1084). Taking it back up opens it again and counts as keeping it
 * open, so it is not offered for parking again for three weeks.
 */
function TakeBackUp({
  status,
  onReopen,
}: {
  status: 'parked' | 'done';
  onReopen: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
      <span className="text-small text-ink-muted">{status === 'parked' ? 'Parked' : 'Closed'}</span>
      <Button type="button" size="sm" variant="ghost" onClick={onReopen}>
        {status === 'parked' ? 'Take it back up' : 'Reopen'}
      </Button>
    </div>
  );
}

/** A rhythm as an area lists it: its name, the goal it serves, and this period's progress in one line. */
export type AreaRhythm = { id: string; title: string; goalId: string; line: string };

/**
 * The rhythms inside the area's goals, with this period's progress and the
 * periods missed behind it. Each opens the goal it lives in, where it is
 * edited and counted.
 */
function AreaRhythms({ areaId, rhythms }: { areaId: string; rhythms: AreaRhythm[] }) {
  const headingId = `area-${areaId}-rhythms`;
  return (
    <section aria-labelledby={headingId} className="space-y-1 pt-1">
      <h3 id={headingId} className="px-1 text-small font-semibold text-ink-muted">
        Rhythms
      </h3>
      <Card>
        <ul className="divide-y divide-border">
          {rhythms.map((rhythm) => (
            <li key={rhythm.id}>
              <Link
                href={stepHref(rhythm.goalId, rhythm.id)}
                className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-quick hover:bg-sunken"
              >
                <Repeat className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui break-words text-ink">{rhythm.title}</span>
                  <span className="block text-small break-words text-ink-muted">{rhythm.line}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** Approve every goal Dash proposed in the area at once: the heading says who proposed them, the button sits at its right. */
export function ApproveArea({ areaId, count }: { areaId: string; count: number }) {
  const [state, approve, approving] = useActionState(approveAreaAction, initial);
  const headingId = `area-${areaId}-proposed`;
  return (
    <form action={approve} aria-labelledby={headingId} className="px-1 pt-1">
      <input type="hidden" name="id" value={areaId} />
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="min-w-0 text-small font-semibold text-ink-muted">
          <DashCredit />
          Proposed by Dash
        </h3>
        <Button type="submit" size="sm" variant="secondary" pending={approving}>
          Approve all {count}
        </Button>
      </div>
      {state.error && <p className="pt-1 text-small text-danger">{state.error}</p>}
    </form>
  );
}

/**
 * A new goal: a title, and either a done-when or a note of what is not known
 * yet. A goal you cannot describe yet still goes in, with fog in place of the
 * done-when.
 */
function GoalComposer({
  areaId,
  areaName,
  learn,
}: {
  areaId: string;
  areaName: string;
  /** The Learn area, where a new goal is placed and given a plan, which costs. */
  learn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [vague, setVague] = useState(false);
  const [state, add, adding] = useActionState(async (prev: GoalsActionState, form: FormData) => {
    const next = await addGoal(prev, form);
    if (next.done) {
      setOpen(false);
      setVague(false);
    }
    return next;
  }, initial);

  if (!open) return <AddTrigger label="New goal" onClick={() => setOpen(true)} />;

  return (
    <Card>
      <form
        action={add}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <input type="hidden" name="areaId" value={areaId} />
        <div className="space-y-3 px-3 py-3">
          <ComposeTitle
            name="title"
            required
            autoFocus
            maxLength={GOAL_TITLE_MAX}
            placeholder="A goal: an outcome that ends, such as pay off the credit cards"
            aria-label={`New goal in ${areaName}`}
          />
          {vague ? (
            <ComposeBody
              key="fog"
              name="fog"
              rows={1}
              maxLength={GOAL_FOG_MAX}
              placeholder="What is not known yet, such as whether this means strength or endurance"
              aria-label="What is not known yet"
            />
          ) : (
            <ComposeBody
              key="acceptance"
              name="acceptance"
              rows={1}
              maxLength={GOAL_ACCEPTANCE_MAX}
              placeholder="Done when… (optional)"
              aria-label="When it is done"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setVague(!vague)}>
            {vague ? 'I know when it is done' : 'Not sure yet'}
          </Button>
          {state.error && <span className="text-small text-danger">{state.error}</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={adding}>
              {adding ? 'Adding…' : 'Add goal'}
            </Button>
            {learn && (
              <PaidHint
                action="app/goals/actions.ts#addGoal"
                what="Cost of placing the goal and writing its plan"
                align="end"
              />
            )}
          </span>
        </div>
      </form>
    </Card>
  );
}

function AreaComposer() {
  const [open, setOpen] = useState(false);
  const [state, add, adding] = useActionState(async (prev: GoalsActionState, form: FormData) => {
    const next = await addArea(prev, form);
    if (next.done) setOpen(false);
    return next;
  }, initial);

  if (!open) return <AddTrigger label="New area" onClick={() => setOpen(true)} />;

  return (
    <Card>
      <form
        action={add}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <div className="px-3 py-3">
          <ComposeTitle
            name="name"
            required
            autoFocus
            maxLength={AREA_NAME_MAX}
            placeholder="An area: a direction that never finishes, such as Career or The city"
            aria-label="New area"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          {state.error && <span className="text-small text-danger">{state.error}</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={adding}>
              {adding ? 'Adding…' : 'Add area'}
            </Button>
          </span>
        </div>
      </form>
    </Card>
  );
}
