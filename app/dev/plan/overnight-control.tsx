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
  type DigestNightRef,
  type FeatureProgress,
  type OnNow,
} from '@/lib/digest/night';
import { elapsedSince, remainingUntil } from '@/lib/plan/elapsed';
import { commitSubject, type StoredPush } from '@/lib/plan/liveness';
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

/** How long the runner may go without a tick before the page says so. */
const TICK_SILENT_AFTER_MINUTES = 15;

/**
 * What the runner last decided, in its own words, and when.
 *
 * The tick writes this on every pass of a running night (migration 0098):
 * waiting on the sessions it has running, or waiting until something is
 * ready and why. That is the answer to "is it stuck", read off the runner
 * rather than guessed. The one thing said as a warning is a runner that has
 * stopped checking in at all, because that is the only state in which nothing
 * will move without somebody looking.
 */
function TickNote({ run, now }: { run: OvernightRun; now: number }) {
  if (!run.lastTickAt || !run.lastTickNote || now === 0) return null;
  const ago = elapsedSince(run.lastTickAt, now);
  const silent = (now - new Date(run.lastTickAt).getTime()) / 60_000 >= TICK_SILENT_AFTER_MINUTES;

  if (silent) {
    return (
      <p className="text-small text-caution">
        The runner has not checked in for {ago}. Its clock may have stopped, and nothing new will
        start until it runs again.
      </p>
    );
  }
  // A fire is already on the line above, as the feature it is on.
  if (run.lastTickNote.startsWith('Started #')) return null;

  return (
    <p className="text-small text-ink-muted">
      {run.lastTickNote}{' '}
      <span className="tabular">
        {ago === 'just now' ? 'Checked just now.' : `Checked ${ago} ago.`}
      </span>
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

/** How long the night has been going, and how much clock it has left. */
function Clock({ run, now }: { run: OvernightRun; now: number }) {
  if (now === 0) return null;
  const going = run.startedAt ? elapsedSince(run.startedAt, now) : null;
  const stops =
    run.stopBy === null
      ? 'no stop time'
      : new Date(run.stopBy).getTime() <= now
        ? 'its stop time has passed'
        : `stops in ${remainingUntil(run.stopBy, now)}`;

  return (
    <p className="tabular text-small text-ink-muted">
      {going && <>{going === 'just now' ? 'Started just now' : `Started ${going} ago`} · </>}
      {stops}
    </p>
  );
}

/**
 * The features the next ticks would fire, in order, so "1 feature ready" says
 * which one. Features a session is already on are left out.
 */
function NextUp({ next }: { next: readonly DigestNightRef[] }) {
  return (
    <p className="min-w-0 text-small text-ink-muted">
      Next up{' '}
      {next.map((feature, index) => (
        <span key={feature.ref}>
          {index > 0 && ', then '}
          <span className="tabular text-ink">{feature.ref}</span>{' '}
          <span className="text-ink">{feature.title}</span>
        </span>
      ))}
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
  showBlocked = true,
  progress = null,
  refreshReadings = false,
  on = [],
  next = [],
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
   * List the steps the night left blocked on you. Dash leaves it off: the same
   * steps are the first rows of its "waiting on you" list a little further
   * down, and the status card saying it again was note 7a08286c.
   */
  showBlocked?: boolean;
  /**
   * Progress through the night's last fire, as `featureProgress` reads it,
   * for the fallback line drawn when no run is going. Each line in `on`
   * carries its own.
   */
  progress?: FeatureProgress | null;
  /**
   * Every row a session is on right now, as `onNow` reads the runs still
   * going (note 39576272). With sessions running in parallel each gets its own
   * "On" line; with none, the card falls back to the night's last fire. Both
   * pages pass it, from `runnerCard`, so they name the same sessions.
   */
  on?: readonly (OnNow & { progress?: FeatureProgress | null })[];
  /**
   * The features the next ticks would fire, as `runnerCard` reads them. Named
   * under the ready count so it says which ones.
   */
  next?: readonly DigestNightRef[];
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
   * Both pages pass the stopped one too, from `runnerCard`, so the card still
   * says what the last run did when nothing is running.
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
          {on.length > 0 ? (
            on.map((fire) => (
              <OnFeature
                key={fire.ref}
                fire={fire}
                now={now}
                progress={fire.progress ?? (fire.ref === night.lastFire?.ref ? progress : null)}
              />
            ))
          ) : night.lastFire ? (
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

          {standing === 'running' && <TickNote run={run} now={now} />}

          {showBlocked && night.blocked.length > 0 && <BlockedSteps night={night} />}

          <Clock run={run} now={now} />

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
          {showBlocked && night.blocked.length > 0 && <BlockedSteps night={night} />}
          {night.closed.length > 0 && <WhichSteps night={night} />}
        </div>
      )}

      {next.length > 0 && standing !== 'paused' && <NextUp next={next} />}

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
