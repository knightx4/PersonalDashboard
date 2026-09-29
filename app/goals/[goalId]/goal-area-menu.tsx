'use client';

import { ActionMenu } from '@/components/ui/action-menu';
import { useMoveToItems, type Place } from '../move-goal';

/**
 * The goal's own menu beside its heading: move it to another area
 * (plan #1160). Drawn only when there is another live area to move it to.
 */
export function GoalAreaMenu({
  goal,
  places,
}: {
  goal: { id: string; title: string; areaId: string };
  places: Place[];
}) {
  const items = useMoveToItems(goal, places);
  if (items.length === 0) return null;
  return <ActionMenu label={`${goal.title} actions`} items={items} />;
}
