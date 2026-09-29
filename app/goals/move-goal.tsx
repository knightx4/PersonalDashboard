'use client';

import type { ActionMenuItem } from '@/components/ui/action-menu';
import { useToast } from '@/components/ui/toast';
import { editGoal } from './actions';

/**
 * Moving a goal to another area (plan #1160), from its row on All goals and
 * from its own page. The area is the one thing set when writing a goal that
 * could not be changed; the steps hang from the goal, so they go with it, and
 * the history trigger records the old and new area.
 */

/** A live area a goal can be moved to. */
export type Place = { id: string; name: string };

/**
 * One Move to item for each live area but the goal's own. A move says so in a
 * toast with an undo that moves it back, so it asks nothing first.
 */
export function useMoveToItems(
  goal: { id: string; title: string; areaId: string },
  places: Place[],
): ActionMenuItem[] {
  const toast = useToast();

  async function moveTo(form: FormData) {
    const result = await editGoal({}, form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    const to = places.find((place) => place.id === form.get('areaId'));
    toast({
      text: `Moved ${goal.title} to ${to?.name ?? 'another area'}.`,
      undo: async () => {
        const back = new FormData();
        back.set('id', goal.id);
        back.set('areaId', goal.areaId);
        const undone = await editGoal({}, back);
        if (undone.error) throw new Error(undone.error);
      },
    });
  }

  return places
    .filter((place) => place.id !== goal.areaId)
    .map((place) => ({
      id: `area-${place.id}`,
      label: `Move to ${place.name}`,
      formAction: moveTo,
      formFields: { id: goal.id, areaId: place.id },
    }));
}
