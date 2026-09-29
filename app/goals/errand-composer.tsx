'use client';

import { useActionState, useState } from 'react';
import { Folder } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipInput, ChipSelect, ComposeTitle } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { GOAL_TITLE_MAX } from '@/lib/goals/tree';
import { addErrand, type GoalsActionState } from './actions';

const initial: GoalsActionState = {};

/**
 * Add an errand from the Goals home (plan #1262): what it is, the date it is
 * due by and the area it goes in, saved and handed to Dash in one press. The
 * area starts on the one errandAreaDefault picks. What the save says, Dash
 * started or why it did not, comes back as a toast; a refusal stays beside
 * the button with the form still open.
 */
export function ErrandComposer({
  areas,
  defaultAreaId,
}: {
  areas: { id: string; name: string }[];
  defaultAreaId: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [state, add, adding] = useActionState(async (prev: GoalsActionState, form: FormData) => {
    const next = await addErrand(prev, form);
    if (next.done) {
      setOpen(false);
      if (next.message) toast({ text: next.message });
    }
    return next;
  }, initial);

  if (!open) return <AddTrigger label="Add an errand" onClick={() => setOpen(true)} />;

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
            name="title"
            required
            autoFocus
            maxLength={GOAL_TITLE_MAX}
            placeholder="An errand: a one-off job, such as find a birthday present for Sam"
            aria-label="What the errand is"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <ChipInput
            type="date"
            name="due"
            icon="Due"
            required
            aria-label="The date it is due by"
          />
          <ChipSelect
            name="areaId"
            defaultValue={defaultAreaId}
            icon={<Folder className="size-3.5" strokeWidth={1.75} />}
            aria-label="Which area it is for"
          >
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </ChipSelect>
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
              {adding ? 'Handing it to Dash…' : 'Hand it to Dash'}
            </Button>
          </span>
        </div>
      </form>
    </Card>
  );
}
