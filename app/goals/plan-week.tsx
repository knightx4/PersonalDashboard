'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Target } from 'lucide-react';
import { Button, PRESS_AREA } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from '@/components/ui/link';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  FOCUS_SUGGESTED,
  overSuggested,
  type PlanWeekGoal,
  type WeekRecap,
} from '@/lib/goals/focus';
import { planWeekAction } from './focus-actions';

/**
 * The Plan your week card and the focus line (docs/GOALS-SPEC.md, "The
 * week's focus").
 *
 * The home loads both with loadPlanWeek in lib/goals/focus-store.ts. It shows
 * the card while that says `needsPlanning`, or when the page is opened with
 * `?plan=1`, which is where the focus line's Change goes. Saving collapses
 * the card and drops `?plan=1` from the address, so a reload does not open
 * it again.
 */

/** The search param that opens the card again once the week is planned. */
export const PLAN_PARAM = 'plan';

export type PlanWeekProps = {
  /** Open goals that are not errands, in page order, with their focus now (PlanWeekData.goals). */
  goals: PlanWeekGoal[];
  /** Last week in numbers (PlanWeekData.recap). */
  recap: WeekRecap;
  /** Where "Dash's review of the week" goes. The app-wide review by default. */
  reviewHref?: string;
  /** Called once the plan is saved, after the card has collapsed. */
  onSaved?: () => void;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Last week in one sentence. */
export function recapLine({ stepsClosed, rhythmsKept, rhythmsMissed }: WeekRecap): string {
  const steps = `Last week you closed ${plural(stepsClosed, 'step', 'steps')}`;
  const periods = rhythmsKept + rhythmsMissed;
  if (periods === 0) return `${steps}.`;
  return `${steps} and met ${rhythmsKept} of ${plural(periods, 'rhythm target', 'rhythm targets')}.`;
}

export function PlanWeek({ goals, recap, reviewHref = '/home/week', onSaved }: PlanWeekProps) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(goals.filter((goal) => goal.focus).map((goal) => goal.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, startSaving] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  if (done) return null;

  function toggle(id: string) {
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setError(null);
    startSaving(async () => {
      // Page order, whatever order the chips were pressed in.
      const ids = goals.filter((goal) => picked.has(goal.id)).map((goal) => goal.id);
      const result = await planWeekAction(ids);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
      toast({
        text: ids.length > 0 ? "This week's focus is set." : 'No focus this week. Every goal counts.',
      });
      const params = new URLSearchParams(window.location.search);
      if (params.has(PLAN_PARAM)) {
        params.delete(PLAN_PARAM);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      }
      onSaved?.();
    });
  }

  const count = picked.size;

  return (
    <Card padding="standard">
      <h2 className="flex items-center gap-1.5 text-ui font-semibold text-ink">
        <Target className="size-4 text-accent" strokeWidth={1.75} aria-hidden />
        Plan your week
      </h2>
      <p className="mt-1 text-small text-ink-muted">
        {recapLine(recap)}{' '}
        <Link
          href={reviewHref}
          className="text-ink underline underline-offset-2 hover:text-accent"
        >
          Dash&apos;s review of the week
        </Link>
      </p>

      {goals.length === 0 ? (
        <p className="mt-3 text-small text-ink-muted">
          No open goal to choose from. Errands come through by their date.
        </p>
      ) : (
        <>
          <p className="mt-3 text-small text-ink">
            Which goals are you pushing this week? The rest wait until you pick them.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Open goals">
            {goals.map((goal) => {
              const on = picked.has(goal.id);
              return (
                <li key={goal.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(goal.id)}
                    disabled={saving}
                    className={cn(
                      'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-quick',
                      'max-sm:min-h-11',
                      on
                        ? 'bg-accent text-fill-ink'
                        : 'bg-sunken text-ink hover:bg-accent-tint hover:text-accent',
                    )}
                  >
                    {goal.title}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-small text-ink-muted" aria-live="polite">
            {overSuggested(count)
              ? `${count} picked. Three is the most that tends to work.`
              : `${count} of ${FOCUS_SUGGESTED} picked.`}
          </p>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={save} pending={saving}>
          {saving ? 'Saving…' : count > 0 ? "Set this week's focus" : 'Go without a focus'}
        </Button>
        {error && <p className="text-small text-danger">{error}</p>}
      </div>
    </Card>
  );
}

export type FocusLineProps = {
  /** The goals with focus now (PlanWeekData.focused). Empty reads as no focus this week. */
  goals: PlanWeekGoal[];
  /** Where Change goes. `?plan=1` on the current page by default, which the home reads to show the card. */
  changeHref?: string;
};

/** "This week: Goal A · Goal B  Change", for the home's header. */
export function FocusLine({ goals, changeHref = `?${PLAN_PARAM}=1` }: FocusLineProps) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-muted">
      <Target className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
      {goals.length > 0 ? (
        <span>
          This week:{' '}
          {goals.map((goal, index) => (
            <span key={goal.id}>
              {index > 0 && ' · '}
              <Link
                href={`/goals/${goal.id}`}
                className="text-ink underline-offset-2 hover:underline"
              >
                {goal.title}
              </Link>
            </span>
          ))}
        </span>
      ) : (
        <span>No focus this week. Every goal counts.</span>
      )}
      <Link
        href={changeHref}
        scroll={false}
        className={cn(PRESS_AREA, 'font-medium text-ink underline-offset-2 hover:text-accent hover:underline')}
      >
        {goals.length > 0 ? 'Change' : 'Choose a focus'}
      </Link>
    </p>
  );
}
