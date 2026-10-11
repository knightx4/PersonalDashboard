'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { addUnitToPlan, moveUnitInPlan, removeUnitFromPlan, type PlanEditState } from './actions';

/**
 * Changing a goal's plan in place (plan #1144, LEARN-LESSONS-SPEC "Changing
 * a plan"). Each unit has a menu to move it a place up or down, or remove it;
 * the foot of the plan has one line to add a unit by name.
 *
 * Moving is reversible, so it does not confirm. Removing takes the unit's
 * pieces and anything handed in for them, so it confirms in place, and a
 * unit with a passed piece offers no remove at all.
 */

export function UnitMenu({
  subjectId,
  unit,
  first,
  last,
  passed,
  pieces,
}: {
  subjectId: string;
  unit: { id: string; title: string };
  first: boolean;
  last: boolean;
  /** Pieces of the unit passed; a unit with any cannot be removed. */
  passed: number;
  pieces: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const fields = { subjectId, unitId: unit.id };

  async function run(action: (formData: FormData) => Promise<PlanEditState>, formData: FormData) {
    setError(null);
    const result = await action(formData);
    if (result.error) setError(result.error);
  }

  const items: ActionMenuItem[] = [
    {
      id: 'up',
      label: 'Move up',
      disabled: first,
      formFields: { ...fields, direction: 'up' },
      formAction: (formData) => run(moveUnitInPlan, formData),
    },
    {
      id: 'down',
      label: 'Move down',
      disabled: last,
      formFields: { ...fields, direction: 'down' },
      formAction: (formData) => run(moveUnitInPlan, formData),
    },
  ];
  if (passed === 0) {
    items.push({
      id: 'remove',
      label: 'Remove from the plan',
      destructive: true,
      confirm:
        pieces > 0
          ? `Remove this unit and its ${pieces === 1 ? 'piece' : `${pieces} pieces`}? Anything handed in for them goes too.`
          : 'Remove this unit from the plan?',
      formFields: fields,
      formAction: (formData) => run(removeUnitFromPlan, formData),
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end">
      <ActionMenu label={`${unit.title} actions`} items={items} />
      {error && (
        <p role="alert" className="mt-1 max-w-64 text-right text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" pending={pending}>
      <Plus className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Adding…' : 'Add unit'}
    </Button>
  );
}

/** One line at the foot of the plan: a unit's name, added at the end. */
export function AddUnitForm({ subjectId }: { subjectId: string }) {
  const [state, formAction] = useActionState<PlanEditState, FormData>(addUnitToPlan, {});
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && !state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        submitted.current = true;
        return formAction(formData);
      }}
      className="mt-3"
    >
      <input type="hidden" name="subjectId" value={subjectId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="title"
          required
          maxLength={80}
          placeholder="A unit to add, by name"
          aria-label="A unit to add to the plan, by name"
          className="min-w-0 flex-1"
        />
        <AddButton />
        <PaidHint action="app/learn/s/[id]/actions.ts#addUnitToPlan" what="Cost of writing what the unit covers" />
      </div>
      <p className="mt-1 text-small text-ink-muted">
        It goes at the end, where you can move it, and Dash writes what it covers. Its pieces are written when the plan reaches it.
      </p>
      {state.error && <p className="mt-2 text-ui text-danger">{state.error}</p>}
    </form>
  );
}
