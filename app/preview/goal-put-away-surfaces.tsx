'use client';

import { useEffect, useRef } from 'react';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { putAwayText } from '@/app/goals/put-away';
import { GoalsAllSurface, GoalTopSurface } from './goal-page-surfaces';

/**
 * Putting a goal away (plan #2097.1), drawn with its hidden parts showing:
 * the goal page's menu open from the heading button, Drop's confirm
 * naming the steps, the row menu on All goals, and the toast with Undo.
 */

const nothing = () => undefined;

/**
 * Opens the menu `trigger` names inside the box, then, when `item` is given,
 * presses that item in the open menu, which arms a confirm in place.
 */
function OpenMenu({
  trigger,
  item,
  children,
}: {
  trigger: string;
  item?: string;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(trigger)?.click();
    if (!item) return;
    const timer = window.setTimeout(() => {
      const items = document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]');
      [...items].find((el) => el.textContent?.trim() === item)?.click();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [trigger, item]);
  return <div ref={box}>{children}</div>;
}

const CARDS_MENU = 'button[aria-label="Pay off the credit cards actions"]';

/** The goal page's heading menu, open: Later and Drop at its foot (plan #1957.8). */
export function GoalPutAwayMenuSurface() {
  return (
    <OpenMenu trigger={CARDS_MENU}>
      <GoalTopSurface frameOnly />
    </OpenMenu>
  );
}

/** Drop pressed: the confirm in place names the goal's seven steps. */
export function GoalArchiveConfirmSurface() {
  return (
    <OpenMenu trigger={CARDS_MENU} item="Drop">
      <GoalTopSurface frameOnly />
    </OpenMenu>
  );
}

/** A goal's row menu on All goals, open: Later for an open goal, then Drop. */
export function GoalsAllPutAwayMenuSurface() {
  return (
    <OpenMenu trigger={CARDS_MENU}>
      <GoalsAllSurface notes />
    </OpenMenu>
  );
}

function PutAwayToast() {
  const toast = useToast();
  useEffect(() => {
    toast({
      text: putAwayText(1, 'park', 'Pay off the credit cards'),
      undo: nothing,
      duration: 600_000,
    });
  }, [toast]);
  return null;
}

/** Back on All goals after parking a goal from its page: the toast with Undo. */
export function GoalsAllPutAwayToastSurface() {
  return (
    <ToastProvider>
      <div className="pb-24">
        <GoalsAllSurface notes />
      </div>
      <PutAwayToast />
    </ToastProvider>
  );
}

/* ------------------------------------------- several at once (plan #2097.2) */

const THREE_TICKED = { selecting: true, ticked: ['g-cards', 'g-fund', 'g-run'] };

/** Select pressed on All goals and three goals ticked: the bar at the foot with Later and Drop. */
export function GoalsAllSelectSurface() {
  return <GoalsAllSurface notes select={THREE_TICKED} />;
}

/** Six goals ticked and Drop pressed: the bar asks before dropping more than five. */
export function GoalsAllSelectConfirmSurface() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = box.current?.querySelector('[role="toolbar"]');
    [...(bar?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.trim() === 'Drop')
      ?.click();
  }, []);
  return (
    <div ref={box}>
      <GoalsAllSurface
        notes
        more
        select={{
          selecting: true,
          ticked: ['g-cards', 'g-fund', 'g-job', 'g-paper', 'g-run', 'g-sleep'],
        }}
      />
    </div>
  );
}

function GroupToast() {
  const toast = useToast();
  useEffect(() => {
    toast({ text: putAwayText(3, 'park'), undo: nothing, duration: 600_000 });
  }, [toast]);
  return null;
}

/** Three goals parked together: one toast, one Undo for the three. */
export function GoalsAllSelectToastSurface() {
  return (
    <ToastProvider>
      <div className="pb-24">
        <GoalsAllSurface notes />
      </div>
      <GroupToast />
    </ToastProvider>
  );
}
