'use client';

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CloseButton } from '@/components/inbox/close-button';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { LIFECYCLE_GLYPH, LIFECYCLE_VERB } from '@/lib/core/lifecycle';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  bringBackGoals,
  putAwayGoals,
  putAwayText,
  type PutAway,
  type PutAwayGoal,
} from './put-away';

/**
 * Putting several goals away at once (plan #2097.2). Select on the list turns
 * a tick box on at the left of every goal that can still be put away; once
 * one is ticked a bar at the foot of the screen counts them and offers Later
 * (park) and Drop (archive), the closing words of plan #1957.8. Each goal is
 * written with the same action its own menu uses, one after another, and the
 * toast's one Undo brings back every goal that went. Dropping more than five
 * asks first, in the bar.
 */

/** Archiving more goals than this at once asks first. */
export const ARCHIVE_CONFIRM_OVER = 5;

/** The goals Park takes from a selection: only open ones can be parked. */
export function parkable(goals: readonly PutAwayGoal[]): PutAwayGoal[] {
  return goals.filter((goal) => goal.status === 'open' && !goal.archivedAt);
}

/** The bar's confirm before archiving more than five goals. */
export function archiveManyConfirm(count: number): string {
  return `Drop ${count} goals and their steps?`;
}

type GoalSelect = {
  selecting: boolean;
  setSelecting: (on: boolean) => void;
  isTicked: (id: string) => boolean;
  toggle: (id: string) => void;
  /** The ticked goals still on the list, in list order. */
  ticked: PutAwayGoal[];
  clear: () => void;
};

const GoalSelectContext = createContext<GoalSelect | null>(null);

/** Null outside the list, so a goal row draws no tick box elsewhere. */
export function useGoalSelect(): GoalSelect | null {
  return useContext(GoalSelectContext);
}

/**
 * Holds which goals are ticked, over the goals the list shows. A ticked goal
 * that leaves the list (put away, or narrowed out by the view) stops counting
 * on the render it leaves. `initial` is for the gallery.
 */
export function GoalSelectProvider({
  goals,
  initial,
  children,
}: {
  /** The goals the list shows that can be put away, in list order. */
  goals: readonly PutAwayGoal[];
  initial?: { selecting?: boolean; ticked?: string[] };
  children: React.ReactNode;
}) {
  const [selecting, setSelectingState] = useState(initial?.selecting ?? false);
  const [stored, setStored] = useState<ReadonlySet<string>>(() => new Set(initial?.ticked ?? []));

  const value = useMemo<GoalSelect>(() => {
    const ticked = goals.filter((goal) => stored.has(goal.id));
    return {
      selecting,
      setSelecting: (on) => {
        setSelectingState(on);
        if (!on) setStored(new Set());
      },
      isTicked: (id) => stored.has(id),
      toggle: (id) =>
        setStored((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      ticked,
      clear: () => setStored(new Set()),
    };
  }, [goals, selecting, stored]);

  return <GoalSelectContext.Provider value={value}>{children}</GoalSelectContext.Provider>;
}

/** Select, and Done once selecting: turns the tick boxes on and off. */
export function SelectGoalsToggle() {
  const select = useGoalSelect();
  if (!select) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant={select.selecting ? 'secondary' : 'ghost'}
      onClick={() => select.setSelecting(!select.selecting)}
      className="shrink-0"
    >
      {select.selecting ? 'Done' : 'Select'}
    </Button>
  );
}

/** A goal row's tick box, drawn only while selecting. */
export function GoalTick({ id, title }: { id: string; title: string }) {
  const select = useGoalSelect();
  if (!select?.selecting) return null;
  return (
    // 44 pixels square for a thumb, pulled back by its margins so the box sits on the title's line.
    <label className="-my-2.5 -mr-1 -ml-3 flex size-11 shrink-0 cursor-pointer items-center justify-center self-start">
      <Checkbox
        checked={select.isTicked(id)}
        onChange={() => select.toggle(id)}
        aria-label={`Select ${title}`}
      />
    </label>
  );
}

/**
 * The bar at the foot of the screen while goals are ticked: the count, then
 * Later and Drop. Later counts the open goals when some ticked are not open,
 * since only those can be parked. Dropping more than five turns the bar into
 * its confirm. Fixed above the tab bar on a phone, as the toast is, and the
 * toast takes its place once the goals have gone.
 */
export function GoalSelectBar() {
  const select = useGoalSelect();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  if (!select?.selecting || select.ticked.length === 0) return null;

  const { ticked, setSelecting } = select;
  const park = parkable(ticked);

  function run(how: PutAway, goals: readonly PutAwayGoal[]) {
    setConfirming(false);
    start(async () => {
      const result = await putAwayGoals(
        goals.map((goal) => goal.id),
        how,
      );
      if (result.done.length === 0) {
        toast({ text: result.error ?? 'That did not work.' });
        return;
      }
      setSelecting(false);
      const done = result.done;
      const title = goals.find((goal) => goal.id === done[0])?.title;
      toast({
        text: result.error
          ? `${putAwayText(done.length, how, title)} One refused.`
          : putAwayText(done.length, how, title),
        undo: () => bringBackGoals(done, how),
      });
    });
  }

  const count = ticked.length;
  return (
    <>
      {/* Room under the last goal, so the bar never sits on it. */}
      <div aria-hidden className="h-[calc(var(--dock-h)+4rem)] lg:h-16" />
      <div
        role="toolbar"
        aria-label="Actions for the selected goals"
        className={cn(
          'fixed inset-x-4 z-status',
          'bottom-[calc(var(--dock-h)+0.75rem+env(safe-area-inset-bottom))] lg:bottom-10',
          'sm:inset-x-auto sm:left-1/2 sm:w-[26rem] sm:-translate-x-1/2',
        )}
      >
        <Card
          padding="none"
          className="flex min-h-12 items-center gap-2 border border-border-strong py-2 pr-2 pl-4 shadow-lg"
        >
          {confirming ? (
            <>
              <span className="min-w-0 flex-1 text-ui text-ink">{archiveManyConfirm(count)}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <CloseButton
                lifecycle="dropped"
                variant="danger"
                autoFocus
                onClick={() => run('archive', ticked)}
              />
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 text-ui font-medium text-ink" aria-live="polite">
                {count} selected
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={park.length === 0}
                pending={pending}
                onClick={() => run('park', park)}
              >
                <StatusGlyph glyph={LIFECYCLE_GLYPH.later} />
                {park.length === count || park.length === 0
                  ? LIFECYCLE_VERB.later
                  : `${LIFECYCLE_VERB.later} (${park.length})`}
              </Button>
              <CloseButton
                lifecycle="dropped"
                variant="danger"
                disabled={pending}
                onClick={() =>
                  count > ARCHIVE_CONFIRM_OVER ? setConfirming(true) : run('archive', ticked)
                }
              />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
