'use client';

import { useActionState, useState } from 'react';
import { Folder, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { ChipInput, ChipSelect, ComposeBody, ComposeBox } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { askDashAction, type AskDashState } from './home-actions';

/**
 * Ask Dash, under the briefing on the Goals home: words, and where they go.
 * On a goal they are an @dash comment on it, answered in the goal's thread
 * or by a run; as a new errand they are saved with a due date and handed to
 * Dash in the same press (saveErrandAndStart); as a new goal they are its
 * title, in the area chosen, handed to Dash the same way (saveGoalAndStart).
 * It replaces Add an errand.
 */

const ERRAND = 'errand';
const GOAL = 'goal';

export function AskDash({
  goals,
  areas,
  defaultAreaId,
  className,
}: {
  goals: { id: string; title: string }[];
  /** Your live areas, for a new errand; none leaves the errand choice out. */
  areas: { id: string; name: string; learn?: boolean }[];
  /** The area a new errand starts in (errandAreaDefault). */
  defaultAreaId: string | null;
  className?: string;
}) {
  const toast = useToast();
  const errandsOn = areas.length > 0 && defaultAreaId !== null;
  const goalsOn = areas.length > 0;
  const [target, setTarget] = useState<string>(
    goals[0]?.id ?? (goalsOn ? GOAL : errandsOn ? ERRAND : ''),
  );
  const [body, setBody] = useState('');
  // The area picked for a new goal or errand, null until the chip is changed.
  const [areaPick, setAreaPick] = useState<string | null>(null);
  const [state, ask, asking] = useActionState(async (prev: AskDashState, form: FormData) => {
    const next = await askDashAction(prev, form);
    if (next.done) {
      setBody('');
      toast({ text: next.message ?? 'Asked.' });
    }
    return next;
  }, {} as AskDashState);

  if (!target) return null;
  const errand = target === ERRAND;
  const goal = target === GOAL;
  // A new errand or goal is saved and handed to Dash; an ask on a goal is a reply.
  const handing = errand || goal;
  const areaId = areaPick ?? (errand ? defaultAreaId : areas[0]?.id) ?? null;
  // A goal added to the Learn area is placed and given a plan, which costs.
  const learnGoal = goal && areas.some((area) => area.id === areaId && area.learn);

  return (
    <form action={ask} className={cn('space-y-2', className)}>
      <label htmlFor="ask-dash" className="sr-only">
        Ask Dash
      </label>
      <ComposeBox>
        <ComposeBody
          id="ask-dash"
          name="body"
          required
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            errand
              ? 'A one-off job, such as find a birthday present for Sam'
              : goal
                ? 'An outcome that ends, such as pay off the credit cards'
                : 'Ask Dash to take something on: research, a draft, a plan for the week'
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2 pt-1.5">
          <ChipSelect
            name="target"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setAreaPick(null);
            }}
            icon={<Target className="size-3.5" strokeWidth={1.75} />}
            aria-label="What it is for"
          >
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
            {goalsOn && <option value={GOAL}>A new goal</option>}
            {errandsOn && <option value={ERRAND}>A new errand</option>}
          </ChipSelect>
          {errand && (
            <ChipInput
              type="date"
              name="due"
              icon="Due"
              required
              aria-label="The date it is due by"
            />
          )}
          {handing && (
            <ChipSelect
              // A new goal starts on the first area; an errand on errandAreaDefault's.
              name="areaId"
              value={areaId ?? undefined}
              onChange={(event) => setAreaPick(event.target.value)}
              icon={<Folder className="size-3.5" strokeWidth={1.75} />}
              aria-label="Which area it is for"
            >
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </ChipSelect>
          )}
          <span className="ml-auto flex items-center gap-2">
            {/* An ask on a goal is a reply from Dash; a new errand or goal starts a run, which is not metered here. */}
            {!handing && (
              <PaidHint
                action="app/goals/home-actions.ts#askDashAction"
                what="Cost of Dash's reply"
                align="end"
                className="self-center"
              />
            )}
            {learnGoal && (
              <PaidHint
                action="app/goals/home-actions.ts#askDashAction:new-goal"
                what="Cost of placing the goal and writing its plan"
                align="end"
                className="self-center"
              />
            )}
            <Button type="submit" size="sm" disabled={asking || !body.trim()}>
              {asking ? 'Asking Dash…' : handing ? 'Hand it to Dash' : 'Ask Dash'}
            </Button>
          </span>
        </div>
      </ComposeBox>
      {state.error && <p className="text-small text-danger">{state.error}</p>}
    </form>
  );
}
