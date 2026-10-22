'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import type { GoalActivity } from '@/lib/goals/tree';
import { editGoal } from '../actions';

const OPTIONS: ReadonlyArray<{ value: GoalActivity; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'passive', label: 'Passive' },
];

export type ActivitySwitchDrawn = { saving?: boolean; error?: string };

/**
 * One segment. Passive chosen takes the accent tint, since it is the state
 * the person picked; Active chosen is how every goal starts, so it is marked
 * in plain ink on a neutral fill and does not outweigh the title.
 */
function segment(option: GoalActivity, on: boolean): string {
  if (!on || option === 'passive') return segmentClass(on);
  return cn(segmentClass(false), 'bg-sunken text-ink hover:bg-sunken');
}

/**
 * The goal's one line under its title, with the switch for whether the goal
 * is worked on or only kept in view at its end (plan #2503.2). It sits on that
 * line rather than beside the menu so the title keeps its width on a phone.
 * The new choice shows at once with "Saving…" beside it while the write runs;
 * a refused save puts it back and says why on a row of its own underneath.
 * Ask Dash makes the same change through change_goal.
 */
export function GoalActivitySwitch({
  goalId,
  activity,
  drawn = {},
  children,
}: {
  goalId: string;
  activity: GoalActivity;
  /** For the gallery: drawn mid-save, or with the error line showing. */
  drawn?: ActivitySwitchDrawn;
  /** The goal's line ("Goal, added 3 Oct"), which the switch sits at the end of. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [value, setValue] = useState<GoalActivity>(activity);
  const [error, setError] = useState<string | null>(drawn.error ?? null);
  const [pending, startSaving] = useTransition();
  const saving = pending || drawn.saving === true;

  function choose(next: GoalActivity) {
    if (next === value || saving) return;
    const before = value;
    setValue(next);
    setError(null);
    startSaving(async () => {
      const form = new FormData();
      form.set('id', goalId);
      form.set('activity', next);
      const result = await editGoal({}, form);
      if (result.error) {
        setValue(before);
        // The store's catch-all says nothing about what was being saved.
        setError(
          result.error.startsWith('The change could not be saved')
            ? `Could not make this goal ${next}. Try again.`
            : result.error,
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {children}
        <span className="flex items-center gap-2">
          {saving && (
            <span className="text-small text-ink-muted" aria-live="polite">
              Saving…
            </span>
          )}
          <span
            role="group"
            aria-label="Whether you are working on this goal"
            className={segmentedFrame}
          >
            {OPTIONS.map((option) => {
              const on = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={on}
                  disabled={saving}
                  onClick={() => choose(option.value)}
                  className={segment(option.value, on)}
                >
                  {option.label}
                </button>
              );
            })}
          </span>
        </span>
      </span>
      {error && (
        <span role="alert" className="text-small text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
