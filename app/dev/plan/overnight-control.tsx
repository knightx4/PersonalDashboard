'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownRight, Moon, Pause, Play, Square } from 'lucide-react';

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
  type FeatureProgress,
} from '@/lib/digest/night';
import { elapsedSince, remainingUntil } from '@/lib/plan/elapsed';
import { commitSubject, silenceReads, type StoredPush } from '@/lib/plan/liveness';
import { readyFeaturesLine } from '@/lib/plan/overnight-choice';
import {
  OVERNIGHT_DEFAULT_FEATURES,
  OVERNIGHT_DEFAULT_HOURS,
  OVERNIGHT_FEATURE_CAP,
  OVERNIGHT_HOUR_CHOICES,
  OVERNIGHT_NO_LIMIT,
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
function OnFeature({
  fire,
  now,
  progress,
}: {
  fire: NonNullable<DigestNight['lastFire']>;
  now: number;
  progress: FeatureProgress | null;
}) {
  return (
    <>
      <p className="text-small text-ink-muted">
        On <span className="tabular text-ink">{fire.ref}</span>{' '}
        <span className="text-ink">{fire.title}</span>
        {now > 0 && (
          <>
            {' · '}
            <span className="tabular">{elapsedSince(fire.at, now)}</span>
          </>
        )}
        {progress && (
          <>
            {' · '}
            <span className="tabular">
              {progress.done} of {progress.total} steps done
            </span>
          </>
        )}
      </p>
      {/* The step under it that a session has claimed, hung off the feature
          as a branch the way the plan page draws a child -- note 84482e92.
          Nothing is drawn between a fire and the session's first claim. */}
      {fire.step && (
        <p className="flex min-w-0 items-baseline gap-1.5 pl-2 text-small text-ink-muted">
          <CornerDownRight
            className="size-3 shrink-0 translate-y-0.5 text-ink-ghost"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="sr-only">Working on</span>
          <span className="tabular text-ink">{fire.step.ref}</span>
          <span className="min-w-0 truncate text-ink">{fire.step.title}</span>
        </p>
      )}
    </>
  );
}

/**
 * A warning when the session has gone silent, read with the same marks the
 * plan page uses for a claim. Counted from the last push, or from the fire if
 * nothing has been pushed since. Says nothing while it is still pushing.
 */
function Silence({
  fire,
  push,
  now,
}: {
  fire: NonNullable<DigestNight['lastFire']>;
  push: StoredPush | null;
  now: number;
}) {
  if (now === 0) return null;
  const since = Math.max(new Date(fire.at).getTime(), push ? new Date(push.at).getTime() : 0);
  const reads = silenceReads((now - since) / 60_000);
  if (reads === 'working') return null;
  const quiet = elapsedSince(new Date(since).toISOString(), now);

  return (
    <p className="text-small text-caution">
      {reads === 'quiet'
        ? `Nothing pushed for ${quiet}. The session may have stalled.`
        : `Nothing pushed for ${quiet}. The session has most likely ended without finishing.`}
    </p>
  );
}

/**
 * The last thing that moved in the repository since the night started.
 *
 * The subject rather than the sha, because a sha is not something anybody
 * reads: what you want to know at a glance is what the last session actually
 * got done. Cut through `commitSubject` rather than printed as stored -- the
 * column takes five hundred characters and this line has room for one clause.
 *
 * Read off the reading stored on the run row (#568), which the route the page
 * calls refreshes (#569), so nothing here waits on GitHub. That reading keeps
 * the commit rather than the branch it landed on, so a push GitHub would not
 * give a subject for falls back to the short sha -- which is at least a thing
 * you can look up -- and a row from before the subject was stored falls back to
 * how long ago it was.
 */
function LastPush({ push, now }: { push: StoredPush; now: number }) {
  const said = push.subject ? commitSubject(push.subject) : null;
  const sha = push.sha ? push.sha.slice(0, 7) : null;
  // Nothing to name and no clock to date it by, which is the pre-mount render.
  if (!said && !sha && now === 0) return null;

  return (
    <p className="min-w-0 text-small text-ink-muted">
      Last push{' '}
      {said ? (
        <span className="text-ink">&ldquo;{said}&rdquo;</span>
      ) : sha ? (
        <span className="font-mono text-ink">{sha}</span>
      ) : (
        <span className="tabular text-ink">{elapsedSince(push.at, now)} ago</span>
      )}
    </p>
  );
}

/**
 * When the last night ended, and why, for a runner that is not running.
 *
 * The reason is the sentence on the row, verbatim, for the reason given at the
 * top of this file. How long ago goes first because it is what decides whether
 * the rest is still news.
 */
function Ended({ night, now, said }: { night: DigestNight; now: number; said: string }) {
  if (!night.endedAt) return null;
  const ago = now > 0 ? elapsedSince(night.endedAt, now) : null;

  return (
    <p className="text-small text-ink-muted">
      {ago && (
        <span className="tabular text-ink">
          {ago === 'just now' ? 'Ended just now.' : `Ended ${ago} ago.`}
        </span>
      )}{' '}
      {said}
    </p>
  );
}

/**
 * The steps the night left blocked on you, each with what it asked for.
 *
 * Open rather than folded, unlike the closed steps: a blocked step is waiting
 * on the reader, and hiding it behind a count is how it stays blocked.
 */
function BlockedSteps({ night }: { night: DigestNight }) {
  const blocked = nightRows(night.blocked);
  const n = night.blocked.length;

  return (
    <div className="space-y-1">
      <p className="text-small text-caution">
        {n} {n === 1 ? 'step' : 'steps'} blocked on you
      </p>
      <ul className="space-y-1">
        {blocked.shown.map((step) => (
          <li key={step.ref} className="flex flex-wrap items-baseline gap-2">
            <span className="tabular shrink-0 text-small text-ink-ghost">{step.ref}</span>
            <span className="min-w-0 flex-1 text-small text-ink">
              {step.title}
              {step.ask && <span className="text-ink-muted"> · {step.ask}</span>}
            </span>
          </li>
        ))}
        {blocked.more > 0 && (
          <li className="text-small text-ink-muted">{blocked.more} more on the plan.</li>
        )}
      </ul>
    </div>
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
  ready,
  label = 'Overnight',
  bare = false,
  progress = null,
  refreshReadings = false,
}: {
  run: OvernightRun | null;
  canSend: boolean;
  /**
   * How many features the runner could pick up now, as `readyFeatureCount`
   * counts them: features rather than steps, and only the ones handed to
   * Claude that nothing is holding.
   *
   * Required rather than optional because it is the other half of the glance
   * -- a night with budget left and nothing ready stops on its next tick --
   * and every caller of this card has already built the tree it is counted
   * from.
   */
  ready: number;
  /**
   * What to call the runner here.
   *
   * "Overnight" on the plan, where it is the night you set going before bed.
   * On Dash it is one row of a Status panel standing beside the notes routine,
   * and there the useful name is the queue it works rather than the hour it
   * usually works it -- a runner you started at ten in the morning is still
   * this one.
   */
  label?: string;
  /**
   * Drop the card around it, for a caller that is already a card.
   *
   * The Status panel on Dash holds a row per routine, and a card inside a card
   * is the outer one saying "these belong together" with the inner one arguing
   * (law 11).
   */
  bare?: boolean;
  /**
   * Progress through the feature the night is on, as `featureProgress` reads
   * it. Passed by the Status panel on Dash; the plan page shows the steps
   * themselves and leaves it out.
   */
  progress?: FeatureProgress | null;
  /**
   * Ask GitHub for fresh push readings once the page has drawn, while a night
   * is live, and redraw with them. The plan page does its own asking for every
   * claimed step; Dash has nothing else that does, and without it the silence
   * warning would be read off whatever the plan page last wrote down.
   */
  refreshReadings?: boolean;
  /**
   * The night so far, as `nightFrom` reads it, or the last night once it has
   * stopped, as `lastNightFrom` reads it. Null when there is nothing to say.
   *
   * The plan page passes only a live night and goes back to its resting shape
   * when the night stops. The Status panel on Dash passes the stopped one too,
   * so the row still says what the last run did when nothing is running.
   */
  night: DigestNight | null;
  /**
   * The last thing pushed since the night started, as the run rows have it, or
   * null when nothing was pushed and when nobody has asked GitHub yet.
   *
   * Why GitHub is refusing, when it is, is not said here: it is one setting and
   * it stops every run on the page being readable at once, so #566 says it once
   * in the banner above the plan rather than on each thing it emptied.
   */
  push: StoredPush | null;
}) {
  const now = useClockNow();
  const standing = overnightStanding(run);
  const live = standing === 'running' || standing === 'paused';

  const router = useRouter();
  useEffect(() => {
    if (!refreshReadings || standing !== 'running') return;
    const leaving = new AbortController();
    fetch('/api/plan/runs', { method: 'POST', signal: leaving.signal })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      // A failed ask leaves the readings the page drew with.
      .catch(() => {});
    return () => leaving.abort();
  }, [refreshReadings, standing, router]);

  // Held here rather than left to the form, because the features field is
  // rendered out of existence when the answer is "until I stop it".
  const [hours, setHours] = useState<number>(OVERNIGHT_DEFAULT_HOURS);
  const keepGoing = hours === OVERNIGHT_NO_LIMIT;

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
      className={cn(!bare && cardVariants({ padding: 'dense' }), 'space-y-2')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-ui font-medium text-ink">
          <Moon className="size-4 text-ink-muted" aria-hidden />
          {label}
        </span>
        <OvernightState standing={standing} />
        {/* The totals are the headline while a night is on; a night that is
            over or has never run has none, and says what it is doing instead. */}
        {night && (live || night.features.length > 0) ? (
          <Totals night={night} />
        ) : (
          <p className="text-small text-ink-muted">{overnightLine(run, now)}</p>
        )}
        {/* What there is left for it to pick up, which nothing else on the card
            can say: the budget counts what a night has spent, and a night with
            three features left in it and nothing ready stops on its next tick.
            In features because that is what a tick fires and what the budget is
            spent in -- the ask on note 2721ff74 was "features (not steps)".
            Said in both states, because before bed it is what decides whether
            to start a night at all. */}
        <p className="text-small text-ink-muted">{readyFeaturesLine(ready)}</p>

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
              {/* The features field goes away on "until I stop it" rather than
                  greying out: a cap that does not apply is a number to wonder
                  about, and the sentence reads as one thing either way. */}
              {!keepGoing && (
                <>
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
                </>
              )}
              {keepGoing && <span className="text-small text-ink-muted">Run</span>}
              <Select
                name="hours"
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
                aria-label="How long it may run for"
                className="w-auto"
              >
                {/* First, because it is the default and the ordinary press. */}
                <option value={OVERNIGHT_NO_LIMIT}>until I stop it</option>
                {OVERNIGHT_HOUR_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice === 1 ? '1 hour' : `${choice} hours`}
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
            <OnFeature fire={night.lastFire} now={now} progress={progress} />
          ) : (
            <p className="text-small text-ink-muted">{overnightLine(run, now)}</p>
          )}

          {/* The held sentence is worth saying even when a feature is named,
              because "on #494" and "nothing new is being fired" are both true
              of a night somebody paused mid-feature. */}
          {standing === 'paused' && night.lastFire && (
            <p className="text-small text-ink-muted">{overnightLine(run, now)}</p>
          )}

          {push && <LastPush push={push} now={now} />}

          {standing === 'running' && night.lastFire && (
            <Silence fire={night.lastFire} push={push} now={now} />
          )}

          {night.blocked.length > 0 && <BlockedSteps night={night} />}

          <StopsIn run={run} now={now} />

          {night.closed.length > 0 && <WhichSteps night={night} />}
        </div>
      )}

      {/* The last night, once it is over: when it ended and why, what it left
          on you, and what it closed. The reason moves down here from the
          header, where the totals now stand. */}
      {standing === 'stopped' && night && (
        <div className="space-y-1">
          {/* A night that fired nothing has no totals, so its reason is
              already in the header where the totals would be. */}
          <Ended
            night={night}
            now={now}
            said={night.features.length > 0 ? (night.endedReason ?? '') : 'It fired nothing.'}
          />
          {night.blocked.length > 0 && <BlockedSteps night={night} />}
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
