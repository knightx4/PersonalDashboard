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
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError, Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  nightBudgetLine,
  nightClosedLine,
  nightRows,
  type DigestNight,
} from '@/lib/digest/night';
import { elapsedSince, remainingUntil } from '@/lib/plan/elapsed';
import type { PushedCommit } from '@/lib/plan/liveness';
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
 * What it says, in the order it is wanted. What the night has got through,
 * because that is the glance: features fired out of the budget, and steps
 * closed. Then the feature it is on and how long it has been on it. Then what
 * was last pushed. Then the clock, which is the only thing left that is about
 * what is to come rather than what has happened. And the buttons, which change
 * with the state rather than standing there greyed out -- there is no Resume on
 * a night that is running and no Hold on one that is not, so the row never
 * offers a press that would be refused.
 *
 * It used to lead with what was *left* -- "2 of 6 features left" and a stop
 * time -- and that is what #633 was: a night working through its list and a
 * night that fell over on its first feature print exactly the same budget and
 * the same clock, so the card could not tell you the one thing you open it to
 * find out. Leading with the totals is what fixes that, and naming the feature
 * and the last commit is what makes a stuck night visible: the elapsed time
 * next to the feature is the number that looks wrong.
 *
 * The night itself is `nightFrom`'s, the same reading the morning digest is
 * written from, down to `nightBudgetLine`'s words. A second way of working out
 * how many features a night fired would be a second answer to it, and the page
 * and the report would disagree about the night you were asleep for.
 *
 * Every word it prints about a stopped night is the sentence on the row,
 * verbatim. Five different things can end a night and each one writes its own
 * reason -- the budget, the clock, your hand, nothing being ready, nothing
 * getting anywhere -- and the value of writing them as sentences is lost the
 * moment something rewords them on the way out.
 *
 * Every clock-derived figure here is left out entirely before the browser's own
 * clock arrives (`now` of 0) rather than drawn from it, so the lines do not
 * change shape under the reader on hydration -- a remaining time measured from
 * the epoch would read "56y" for the first half second after the page landed.
 */

/** What the night has got through: the whole of the glance, in one line. */
function Totals({ night }: { night: DigestNight }) {
  return (
    <p className="text-small text-ink-muted">
      <span className="tabular font-semibold text-ink">{nightBudgetLine(night)}</span>
      {' · '}
      <span className="tabular">{nightClosedLine(night)}</span>
    </p>
  );
}

/**
 * The feature being built, and how long it has been on it.
 *
 * `lastFire` rather than the last of `features`: a runner that came back to an
 * earlier feature is working that feature, and the deduplicated list is in the
 * order the night first reached each one. See the field's note in `night.ts`.
 */
function OnFeature({ fire, now }: { fire: NonNullable<DigestNight['lastFire']>; now: number }) {
  return (
    <p className="text-small text-ink-muted">
      On <span className="tabular text-ink">{fire.ref}</span>{' '}
      <span className="text-ink">{fire.title}</span>
      {now > 0 && (
        <>
          {' · '}
          <span className="tabular">{elapsedSince(fire.at, now)}</span>
        </>
      )}
    </p>
  );
}

/**
 * The last thing that moved in the repository since the night started.
 *
 * The subject rather than the sha, because a sha is not something anybody
 * reads: what you want to know at a glance is what the last session actually
 * got done. A push GitHub would not give a subject for falls back to the
 * branch, which at least says which session it was.
 */
function LastPush({ push }: { push: PushedCommit }) {
  return (
    <p className="min-w-0 text-small text-ink-muted">
      Last push{' '}
      {push.subject ? (
        <span className="text-ink">&ldquo;{push.subject}&rdquo;</span>
      ) : (
        <span className="font-mono text-ink">{push.ref}</span>
      )}
    </p>
  );
}

/** How much clock is left, or that there is none. */
function StopsIn({ run, now }: { run: OvernightRun; now: number }) {
  if (run.stopBy === null || now === 0) return null;
  const past = new Date(run.stopBy).getTime() <= now;

  return (
    <p className="text-small text-ink-muted">
      {past ? 'Its stop time has passed.' : `stops in ${remainingUntil(run.stopBy, now)}`}
    </p>
  );
}

/**
 * The step numbers, reachable and out of the line.
 *
 * "6 steps closed" is the fact; `#601 #604 #607 #609 #612 #615` is a list you
 * have to parse to get back to the same fact. So the numbers fold, and the
 * count above the fold is what tells you whether to open it -- law 10.
 *
 * Cut at the same ten rows the morning report cuts at, through the same
 * helper: a night that closed thirty steps is a list rather than a glance
 * either way round.
 */
function WhichSteps({ night }: { night: DigestNight }) {
  const closed = nightRows(night.closed);

  return (
    <Disclosure title="Which steps" meta={nightClosedLine(night)}>
      <ul className="space-y-1">
        {closed.shown.map((step) => (
          <li key={step.ref} className="flex flex-wrap items-baseline gap-2">
            <span className="tabular shrink-0 text-small text-ink-ghost">{step.ref}</span>
            <span className="min-w-0 flex-1 text-small text-ink">{step.title}</span>
          </li>
        ))}
        {closed.more > 0 && (
          <li className="text-small text-ink-muted">{closed.more} more on the changelog.</li>
        )}
      </ul>
    </Disclosure>
  );
}

export function OvernightControl({
  run,
  /** Whether the deployment has the token the runner fires through at all. */
  canSend,
  night,
  push,
  pushError,
}: {
  run: OvernightRun | null;
  canSend: boolean;
  /**
   * The night so far, as `nightFrom` reads it. Null when there is no night
   * running -- a stopped night's account is the morning digest's job, and this
   * card goes back to its resting shape.
   */
  night: DigestNight | null;
  /** The last thing pushed since the night started, or null when nothing was. */
  push: PushedCommit | null;
  /** Why GitHub could not be asked, in its own sentence. */
  pushError: string | null;
}) {
  const now = useClockNow();
  const standing = overnightStanding(run);
  const live = standing === 'running' || standing === 'paused';

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
        {/* The totals are the headline while a night is on; a night that is
            over or has never run has none, and says what it is doing instead. */}
        {night ? (
          <Totals night={night} />
        ) : (
          <p className="text-small text-ink-muted">{overnightLine(run, now)}</p>
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

      {/* What the night has actually been doing, under the totals: the feature
          it is on, the last thing it pushed, and then the clock. A night that
          has fired nothing says so in the runner's own sentence rather than
          leaving the block empty and reading like one that is working. */}
      {live && run && night && (
        <div className="space-y-0.5">
          {night.lastFire ? (
            <OnFeature fire={night.lastFire} now={now} />
          ) : (
            <p className="text-small text-ink-muted">{overnightLine(run, now)}</p>
          )}

          {/* The held sentence is worth saying even when a feature is named,
              because "on #494" and "nothing new is being fired" are both true
              of a night somebody paused mid-feature. */}
          {standing === 'paused' && night.lastFire && (
            <p className="text-small text-ink-muted">{overnightLine(run, now)}</p>
          )}

          {push && <LastPush push={push} />}

          {/* Law 2, and the convention #566 set for this key: a refusal from
              GitHub is a sentence naming the permission, said where the thing
              it would have filled in should have been. */}
          {pushError && (
            <p className="text-small text-caution">Could not read what was pushed. {pushError}</p>
          )}

          <StopsIn run={run} now={now} />

          {night.closed.length > 0 && <WhichSteps night={night} />}
        </div>
      )}

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
