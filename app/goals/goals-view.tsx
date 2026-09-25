'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { CloudFog, Flag, ListTree } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ComposeBody, ComposeTitle, InlineInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
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
  type GoalsActionState,
} from './actions';
import { AreaPlanner } from './area-planner';
import { GoalProgress } from './goal-progress';

/**
 * Areas and the goals under them (plan #924).
 *
 * Each area is a heading, a line saying what you want from it, and its goals
 * in a card beneath, with Plan this area asking Claude to propose the goals
 * it needs. Everything is
 * edited where it stands (law 12): a name, a title, a done-when or a note of
 * fog is an inline input saved on blur. Reordering and archiving sit in each
 * row's menu, which works the same with a thumb as with a mouse. Archiving
 * offers an undo, and the record of it stays in the history either way.
 */

const initial: GoalsActionState = {};

/** Each goal's bar and whose move it is, keyed by goal id; a goal with no steps is absent. */
type Progress = Record<string, GoalProgressData>;

/** Save on blur when the words changed. A required field cleared to nothing is put back. */
function commitOnBlur(before: string, { required = false }: { required?: boolean } = {}) {
  return (event: React.FocusEvent<HTMLInputElement>) => {
    const value = event.target.value.trim();
    if (required && value === '') {
      event.target.value = before;
      return;
    }
    if (value !== before) event.target.form?.requestSubmit();
  };
}

function revertOnEscape(before: string) {
  return (event: React.KeyboardEvent<HTMLInputElement>) => {
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

export function GoalsView({
  areas,
  progress,
  areaRuns,
  canRun,
}: {
  areas: AreaWithGoals[];
  progress: Progress;
  /** Each area's latest Plan this area run, keyed by area id. */
  areaRuns: Record<string, AreaRunView>;
  /** Whether this account can start a Claude run (the owner's only). */
  canRun: boolean;
}) {
  return (
    <div className="space-y-6">
      {areas.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="No areas yet"
          description="Start with the directions you care about, such as money, career or the city, then put goals under each."
        />
      ) : (
        areas.map((area, index) => (
          <AreaSection
            key={area.id}
            area={area}
            index={index}
            count={areas.length}
            progress={progress}
            run={areaRuns[area.id] ?? null}
            canRun={canRun}
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
  canRun,
}: {
  area: AreaWithGoals;
  index: number;
  count: number;
  progress: Progress;
  run: AreaRunView | null;
  canRun: boolean;
}) {
  const [renameState, rename, renaming] = useActionState(renameAreaAction, initial);
  const [noteState, saveNote, savingNote] = useActionState(setAreaNoteAction, initial);
  const menuAction = useMenuAction();
  const toast = useToast();

  async function archive(form: FormData) {
    const result = await archiveAreaAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
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
  const items: ActionMenuItem[] = [
    ...moveItems(menuAction(moveAreaAction), area.id, index, count),
    {
      id: 'archive',
      label: 'Archive area',
      destructive: true,
      formAction: archive,
      formFields: { id: area.id },
      confirm:
        goalCount === 0
          ? `Archive ${area.name}?`
          : `Archive ${area.name} and its ${goalCount === 1 ? 'goal' : `${goalCount} goals`}?`,
    },
  ];

  const proposedCount = area.goals.filter((goal) => goal.status === 'proposed').length;

  return (
    <section id={`area-${area.id}`} aria-label={area.name} className="scroll-mt-16 space-y-2">
      <div className="flex items-center gap-2">
        <form action={rename} className="min-w-0 flex-1">
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
            className="font-semibold"
          />
        </form>
        <ActionMenu label={`${area.name} actions`} items={items} />
      </div>
      {renameState.error && <p className="px-1 text-small text-danger">{renameState.error}</p>}
      <form action={saveNote}>
        <input type="hidden" name="id" value={area.id} />
        <InlineInput
          name="note"
          maxLength={AREA_NOTE_MAX}
          defaultValue={area.note ?? ''}
          key={`note-${area.note ?? ''}`}
          placeholder="What you want from this, in a sentence"
          aria-label={`What you want from ${area.name}`}
          disabled={savingNote}
          onBlur={commitOnBlur(area.note ?? '')}
          onKeyDown={revertOnEscape(area.note ?? '')}
          className="text-ink-muted"
        />
      </form>
      {noteState.error && <p className="px-1 text-small text-danger">{noteState.error}</p>}

      {proposedCount > 1 && <ApproveArea areaId={area.id} count={proposedCount} />}
      {goalCount > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {area.goals.map((goal, i) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                index={i}
                count={goalCount}
                steps={progress[goal.id]}
              />
            ))}
          </ul>
        </Card>
      )}
      <AreaPlanner areaId={area.id} hasGoals={goalCount > 0} run={run} canRun={canRun} />
      <GoalComposer areaId={area.id} areaName={area.name} />
    </section>
  );
}

function GoalRow({
  goal,
  index,
  count,
  steps,
}: {
  goal: Goal;
  index: number;
  count: number;
  steps: GoalProgressData | undefined;
}) {
  const [editState, edit, editing] = useActionState(editGoal, initial);
  // Fog is shown when the goal has some, or once you choose to add it.
  const [addingFog, setAddingFog] = useState(false);
  const menuAction = useMenuAction();
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

  const items: ActionMenuItem[] = [
    ...moveItems(menuAction(moveGoalAction), goal.id, index, count),
    ...(showFog
      ? []
      : [{ id: 'fog', label: 'Say what is not known yet', onSelect: () => setAddingFog(true) }]),
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
        <form action={edit}>
          <input type="hidden" name="id" value={goal.id} />
          <InlineInput
            name="title"
            required
            maxLength={GOAL_TITLE_MAX}
            defaultValue={goal.title}
            key={`title-${goal.title}`}
            aria-label={`Rename ${goal.title}`}
            disabled={editing}
            onBlur={commitOnBlur(goal.title, { required: true })}
            onKeyDown={revertOnEscape(goal.title)}
            className="font-medium"
          />
        </form>
        <form action={edit}>
          <input type="hidden" name="id" value={goal.id} />
          <InlineInput
            name="acceptance"
            maxLength={GOAL_ACCEPTANCE_MAX}
            defaultValue={goal.acceptance ?? ''}
            key={`acceptance-${goal.acceptance ?? ''}`}
            placeholder="Done when…"
            aria-label={`When ${goal.title} is done`}
            disabled={editing}
            onBlur={commitOnBlur(goal.acceptance ?? '')}
            onKeyDown={revertOnEscape(goal.acceptance ?? '')}
            className="text-ink-muted"
          />
        </form>
        {showFog && (
          <form action={edit} className="flex items-start gap-1">
            <input type="hidden" name="id" value={goal.id} />
            <CloudFog
              className="mt-1.5 ml-1 size-3.5 shrink-0 text-ink-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <InlineInput
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
          {steps && <GoalProgress progress={steps} label={goal.title} />}
          <Link
            href={`/goals/${goal.id}`}
            className="inline-flex items-center gap-1 text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            <ListTree className="size-3" strokeWidth={1.75} aria-hidden />
            {goal.status === 'proposed' ? 'See what Claude proposed' : steps ? 'Full tree' : 'Break into steps'}
          </Link>
        </div>
        {goal.status === 'proposed' && <SettleProposedGoal goalId={goal.id} onTurnDown={archive} />}
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

/** Approve every goal Claude proposed in the area at once. */
function ApproveArea({ areaId, count }: { areaId: string; count: number }) {
  const [state, approve, approving] = useActionState(approveAreaAction, initial);
  return (
    <form action={approve} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <input type="hidden" name="id" value={areaId} />
      <p className="min-w-0 flex-1 text-small text-ink-muted">
        Claude proposed {count} goals here. Approve the ones you want, or all of them.
      </p>
      <Button type="submit" size="sm" variant="secondary" pending={approving}>
        Approve all {count}
      </Button>
      {state.error && <span className="w-full text-small text-danger">{state.error}</span>}
    </form>
  );
}

/**
 * A new goal: a title, and either a done-when or a note of what is not known
 * yet. A goal you cannot describe yet still goes in, with fog in place of the
 * done-when.
 */
function GoalComposer({ areaId, areaName }: { areaId: string; areaName: string }) {
  const [open, setOpen] = useState(false);
  const [vague, setVague] = useState(false);
  const [state, add, adding] = useActionState(
    async (prev: GoalsActionState, form: FormData) => {
      const next = await addGoal(prev, form);
      if (next.done) {
        setOpen(false);
        setVague(false);
      }
      return next;
    },
    initial,
  );

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
            placeholder="A goal, such as pay off the credit cards"
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
          </span>
        </div>
      </form>
    </Card>
  );
}

function AreaComposer() {
  const [open, setOpen] = useState(false);
  const [state, add, adding] = useActionState(
    async (prev: GoalsActionState, form: FormData) => {
      const next = await addArea(prev, form);
      if (next.done) setOpen(false);
      return next;
    },
    initial,
  );

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
            placeholder="An area, such as money or the city"
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
