'use client';

import { useState, useTransition } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { ChipInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatDay } from '@/lib/goals/dates';
import type { GoalStatus } from '@/lib/goals/tree';
import { editGoal, settleGoalAction } from '../actions';
import { useMoveToItems, type Place } from '../move-goal';

/**
 * The goal's own menu beside its heading: move it to another area
 * (plan #1160), and turn it into an errand or back (plan #1261). An errand
 * always has a date it is due by, so turning a goal with no due date into
 * one asks for the date first, in a line beside the menu. An open goal can
 * be closed from here, and a closed or parked one taken back up (plan #1341),
 * with the same move Today and All goals use.
 */
export function GoalAreaMenu({
  goal,
  places,
}: {
  goal: {
    id: string;
    title: string;
    areaId: string;
    errand: boolean;
    dueOn: string | null;
    status: GoalStatus;
  };
  places: Place[];
}) {
  const toast = useToast();
  const moves = useMoveToItems(goal, places);
  const [asking, setAsking] = useState(false);
  const [due, setDue] = useState(goal.dueOn ?? '');
  const [pending, startTransition] = useTransition();

  async function setErrand(errand: boolean, dueOn: string | null) {
    const form = new FormData();
    form.set('id', goal.id);
    form.set('errand', String(errand));
    if (dueOn) form.set('due', dueOn);
    const result = await editGoal({}, form);
    if (result.error) {
      toast({ text: result.error });
      return false;
    }
    toast({ text: errand ? `${goal.title} is now an errand.` : `${goal.title} is a goal again.` });
    return true;
  }

  const errandItem: ActionMenuItem = goal.errand
    ? { id: 'errand-off', label: 'Make it a goal again', onSelect: () => void setErrand(false, null) }
    : goal.dueOn
      ? {
          id: 'errand-on',
          label: `Make it an errand, due ${formatDay(goal.dueOn)}`,
          onSelect: () => void setErrand(true, goal.dueOn),
        }
      : { id: 'errand-on', label: 'Make it an errand…', onSelect: () => setAsking(true) };

  async function settle(move: 'close' | 'reopen') {
    const form = new FormData();
    form.set('id', goal.id);
    form.set('move', move);
    const result = await settleGoalAction({}, form);
    const text = result.error ?? result.message;
    if (text) toast({ text });
  }

  const settleItems: ActionMenuItem[] =
    goal.status === 'open'
      ? [{ id: 'close', label: 'Close the goal', onSelect: () => void settle('close') }]
      : goal.status === 'done' || goal.status === 'parked'
        ? [{ id: 'reopen', label: 'Take it back up', onSelect: () => void settle('reopen') }]
        : [];

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {asking && (
        <form
          className="inline-flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              if (await setErrand(true, due)) setAsking(false);
            });
          }}
        >
          <ChipInput
            type="date"
            icon="Due"
            required
            autoFocus
            value={due}
            onChange={(event) => setDue(event.target.value)}
            aria-label={`When ${goal.title} is due`}
          />
          <Button type="submit" size="sm" pending={pending} disabled={!due}>
            Make it an errand
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </form>
      )}
      <ActionMenu label={`${goal.title} actions`} items={[...moves, errandItem, ...settleItems]} />
    </span>
  );
}
