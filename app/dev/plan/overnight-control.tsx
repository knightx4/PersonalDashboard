'use client';

import { useActionState } from 'react';
import { Moon, Pause, Play, Square } from 'lucide-react';

import {
  pauseOvernightRunner,
  resumeOvernightRunner,
  startOvernightRunner,
  stopOvernightRunner,
  type PlanActionState,
} from './actions';
import { OvernightState } from '@/components/dev/overnight-state';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { remainingUntil } from '@/lib/plan/elapsed';
import {
  OVERNIGHT_DEFAULT_FEATURES,
  OVERNIGHT_DEFAULT_HOURS,
  OVERNIGHT_FEATURE_CAP,
  OVERNIGHT_HOUR_CHOICES,
  overnightLine,
  overnightStanding,
  type OvernightRun,
} from '@/lib/plan/overnight';
import { useClockNow } from '@/lib/use-clock-now';

/**
 * Setting the runner going, and holding it.
 *
 * The one control on the plan that is about the plan as a whole rather than
 * about a row in it, which is why it sits above the summary strip instead of
 * inside the tree: what it starts works its way down the whole page.
 *
 * Three things, in the order they are wanted. What it is doing, because that
 * is what you open the page for at seven in the morning. What is left of the
 * budget and the clock, because that is what tells you whether it is worth
 * leaving alone. And the buttons, which change with the state rather than
 * standing there greyed out -- there is no Resume on a night that is running
 * and no Hold on one that is not, so the row never offers a press that would
 * be refused.
 *
 * Every word it prints about a stopped night is the sentence on the row,
 * verbatim. Five different things can end a night and each one writes its own
 * reason -- the budget, the clock, your hand, nothing being ready, nothing
 * getting anywhere -- and the value of writing them as sentences is lost the
 * moment something rewords them on the way out.
 */

/**
 * What the night has left, once it has started.
 *
 * Both brakes on one line, because they are one question -- how much more of
 * this is there -- and either of them can be the one that ends it.
 *
 * The clock half is left out entirely before the browser's own clock arrives
 * (`now` of 0), rather than drawn from it: a remaining time measured from the
 * epoch would read "56y" for the first half second after the page landed.
 */
function BudgetLeft({ run, now }: { run: OvernightRun; now: number }) {
  const past = run.stopBy !== null && now > 0 && new Date(run.stopBy).getTime() <= now;

  return (
    <p className="text-small text-ink-muted">
      <span className="tabular font-semibold text-ink">{run.featuresLeft}</span> of{' '}
      <span className="tabular">{run.featuresBudget}</span>{' '}
      {run.featuresBudget === 1 ? 'feature' : 'features'} left
      {run.stopBy !== null &&
        now > 0 &&
        (past ? ' · its stop time has passed' : ` · stops in ${remainingUntil(run.stopBy, now)}`)}
    </p>
  );
}

export function OvernightControl({
  run,
  /** Whether the deployment has the token the runner fires through at all. */
  canSend,
}: {
  run: OvernightRun | null;
  canSend: boolean;
}) {
  const now = useClockNow();
  const standing = overnightStanding(run);

  const [startState, startAction, starting] = useActionState(
    startOvernightRunner,
    {} as PlanActionState,
  );
  const [pauseState, pauseAction, pausing] = useActionState(
    pauseOvernightRunner,
    {} as PlanActionState,
  );
  const [resumeState, resumeAction, resuming] = useActionState(
    resumeOvernightRunner,
    {} as PlanActionState,
  );
  const [stopState, stopAction, stopping] = useActionState(
    stopOvernightRunner,
    {} as PlanActionState,
  );

  // Each form keeps its own last answer and nothing records which spoke most
  // recently, so the one shown is the latest in the order the buttons can be
  // pressed in: you start a night, then hold or carry it on, then stop it.
  // The row above it is the truth either way -- every one of these actions
  // revalidates the page -- so this is the press being acknowledged, not the
  // state being reported.
  const said = [stopState, resumeState, pauseState, startState].find(
    (state) => state.error ?? state.message,
  );

  return (
    <section
      aria-label="The overnight runner"
      className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-ui font-medium text-ink">
          <Moon className="size-4 text-ink-muted" aria-hidden />
          Overnight
        </span>
        <OvernightState standing={standing} />
        <p className="text-small text-ink-muted">{overnightLine(run, now)}</p>
        {run && (standing === 'running' || standing === 'paused') && (
          <BudgetLeft run={run} now={now} />
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {standing === 'running' && (
            <form action={pauseAction}>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                pending={pausing}
                title="Fire nothing more. What is already building finishes and commits."
              >
                <Pause className="size-3.5" aria-hidden />
                {pausing ? 'Holding…' : 'Hold'}
              </Button>
            </form>
          )}

          {standing === 'paused' && (
            <form action={resumeAction}>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                pending={resuming}
                title="Carry on from wherever the plan now is, on what is left of the budget and the clock"
              >
                <Play className="size-3.5" aria-hidden />
                {resuming ? 'Resuming…' : 'Resume'}
              </Button>
            </form>
          )}

          {(standing === 'running' || standing === 'paused') && (
            <form action={stopAction}>
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                pending={stopping}
                title="End the night. What is already building still finishes; nothing follows it."
              >
                <Square className="size-3.5" aria-hidden />
                {stopping ? 'Stopping…' : 'Stop'}
              </Button>
            </form>
          )}

          {/* The start form is the whole of the resting state, so it stands
              open rather than behind a trigger: two fields with their defaults
              already right is not a compose box, and the press this control
              exists for is the one made on the way to bed. */}
          {(standing === 'off' || standing === 'stopped') && (
            <form action={startAction} className="flex flex-wrap items-center gap-2">
              <span className="text-small text-ink-muted">Up to</span>
              <Input
                type="number"
                name="features"
                min={1}
                max={OVERNIGHT_FEATURE_CAP}
                step={1}
                defaultValue={OVERNIGHT_DEFAULT_FEATURES}
                aria-label="Features it may fire"
                className="w-16"
              />
              <span className="text-small text-ink-muted">features, over</span>
              <Select
                name="hours"
                defaultValue={OVERNIGHT_DEFAULT_HOURS}
                aria-label="How long it may run for"
                className="w-auto"
              >
                {OVERNIGHT_HOUR_CHOICES.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours === 1 ? '1 hour' : `${hours} hours`}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" pending={starting} disabled={!canSend}>
                {starting ? 'Starting…' : 'Start'}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Law 2: a runner that cannot fire says so where the button is, rather
          than starting a night that writes a row and then sends nothing. */}
      {!canSend && (
        <p className="text-small text-ink-muted">
          Needs the plan routine&apos;s token on the deployment before it can fire anything.
        </p>
      )}

      {said && (
        <p className="text-small">
          <FieldError>{said.error}</FieldError>
          {!said.error && <span className="text-ink-muted">{said.message}</span>}
        </p>
      )}
    </section>
  );
}
