import Link from 'next/link';
import {
  BookOpenText,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  FilePen,
  Flag,
  Hourglass,
  ListChecks,
  Megaphone,
  ListTree,
  Repeat,
  Sparkles,
  User,
} from 'lucide-react';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import type { CatchUp } from '@/lib/goals/catch-up';
import {
  WAITING_GROUP,
  type DailyGoal,
  type DailyView as Daily,
  type DashQueue,
  type NextItem,
  type WaitingGroup,
  type WaitingItem,
} from '@/lib/goals/daily';
import { formatDay, formatInstant } from '@/lib/goals/dates';
import { VERDICT_LABELS, type GoalReview, type Verdict } from '@/lib/goals/reviews';
import { missedLine, progressLine, type HomeRhythm } from '@/lib/goals/rhythms';
import { JOB_LABELS, type RunListing } from '@/lib/goals/runs';
import { STEP_KIND_LABELS } from '@/lib/goals/steps';
import type { SinceEntry, SinceVisit } from '@/lib/goals/since-visit';
import type { Suggestion } from '@/lib/goals/suggestions';
import { GoalProgress } from './goal-progress';
import { DidYouGoList, SuggestionsList } from './suggestions-list';

/**
 * The daily view on the Goals home (plan #926), sorted by whose move it is.
 *
 * Your move comes first, because each thing in it holds something else up.
 * It is grouped by what it asks of you: decide (a question, or something a
 * run flagged, plan #1015), approve (goals Claude proposed, one row per area,
 * and proposed steps), read (a result Claude produced, and the context and
 * drafts it found for a goal) and do (the next steps of yours across every
 * goal, with the rhythms running out of days, plan #928). Every row opens
 * where the thing can be done; the home itself only reads.
 *
 * Dash is on it comes second: the runs going now, the Claude steps the next
 * run will work, and the ones held until you approve what they sit under. So
 * nothing Claude will do is listed as yours, and nothing waiting on your
 * approval looks like it is under way.
 *
 * Then the goals themselves, each with its bar and the weekly verdict
 * (plan #1018) and a way into its tree.
 *
 * After time away (plan #935) nothing is shown as overdue. A rhythm with
 * missed periods behind it gets one line saying how many, beside this
 * period's progress, and a step whose date has passed is listed as a plain
 * next item.
 *
 * The weekly run's suggestions (plan #934) come after Dash, with their own
 * going and not for me buttons: the one part of the home that writes,
 * because a reaction is quicker here than a trip into the tree. Above them,
 * from the day after an event you said you were going to, the home asks
 * whether you went (plan #1020).
 *
 * On the day you come back from five or more days away (plan #1019) the page
 * leads with a catch-up instead: the runs Claude finished while you were
 * gone, your move, and one next step per goal. Everything else is folded
 * under it, closed.
 *
 * On any other day, when runs ended since your last sitting (plan #1010), the
 * page opens with them: what each did, or why it failed, each a link to the
 * goal it was on. The next sitting clears the list.
 */

type View = Daily & {
  rhythms: HomeRhythm[];
  suggestions: Suggestion[];
  /** Events you said you were going to whose day has passed (plan #1020). */
  didYouGo?: Suggestion[];
  catchUp?: CatchUp | null;
  sinceVisit?: SinceVisit | null;
};

const KIND_ICONS: Record<NextItem['kind'], typeof User> = { mine: User, claude: Sparkles };

const WAITING_ICONS: Record<WaitingItem['kind'], typeof User> = {
  question: CircleHelp,
  breakdown: ListChecks,
  plan: Flag,
  review: Sparkles,
  flag: Megaphone,
  context: BookOpenText,
  drafts: FilePen,
};

const GROUP_LABELS: Record<WaitingGroup | 'do', string> = {
  decide: 'Decide',
  approve: 'Approve',
  read: 'Read',
  do: 'Do',
};

/** The most of your own next steps the home lists; the rest are in each goal's tree. */
const DO_SHOWN = 8;

const VERDICT_TONES: Record<Verdict, DevTone> = {
  on_track: 'positive',
  stalled: 'caution',
  waiting_on_you: 'caution',
};

function rhythmLine(rhythm: HomeRhythm): string {
  const left =
    !rhythm.atRisk || rhythm.period === 'day'
      ? null
      : rhythm.daysLeft === 1
        ? 'last day'
        : `${rhythm.daysLeft} days left`;
  return [
    progressLine(rhythm.period, { count: rhythm.count, target: rhythm.target }),
    left,
    rhythm.missed > 0 ? missedLine(rhythm.period, rhythm.missed) : null,
    rhythm.goalTitle,
  ]
    .filter(Boolean)
    .join(' · ');
}

function waitingLine(item: WaitingItem): string {
  switch (item.kind) {
    case 'question':
      return `Question to answer · ${item.goalTitle}`;
    case 'breakdown':
      return `${item.count} proposed ${item.count === 1 ? 'step' : 'steps'} to approve`;
    case 'plan':
      return item.count === 1
        ? `Goal Claude proposed · ${item.goalTitle}`
        : `${item.count} goals Claude proposed: ${item.goals.map((g) => g.title).join(', ')}`;
    case 'review':
      return `Claude’s result to read · ${item.goalTitle}`;
    case 'flag':
      return `Claude flagged this · ${item.goalTitle}`;
    case 'context':
      return `${plural(item.count, 'thing')} Claude found in your other modules`;
    case 'drafts':
      return `${plural(item.count, 'draft')} Claude filled in, to confirm`;
  }
}

function waitingHref(item: WaitingItem): string {
  switch (item.kind) {
    case 'review':
      return `/goals/${item.goalId}#step-${item.id}`;
    case 'flag':
      return `/goals/${item.goalId}#flag-${item.id}`;
    case 'plan':
      return item.count === 1 ? `/goals/${item.goalId}` : `/goals/all#area-${item.id}`;
    case 'context':
      return `/goals/${item.goalId}#context-heading`;
    default:
      return `/goals/${item.goalId}`;
  }
}

export function DailyView({
  view,
  timeZone,
}: {
  view: View;
  /** The account's zone, for the times on the week's suggestions. */
  timeZone: string;
}) {
  const lately = view.sinceVisit && view.sinceVisit.entries.length > 0 && (
    <SinceVisitView sinceVisit={view.sinceVisit} timeZone={timeZone} />
  );

  const hasDash =
    view.dash.ready.length + view.dash.held.length + (view.dash.running?.length ?? 0) > 0;
  if (view.goals.length === 0 && view.waiting.length === 0 && !lately && !hasDash) {
    return (
      <EmptyState
        icon={Flag}
        title="No goals yet"
        description="Add the goals you are working towards, and the next few things for each will show here."
        action={{ label: 'Add a goal', href: '/goals/all' }}
      />
    );
  }

  // The catch-up lists one next step per goal itself, so its Your move leaves Do out.
  const yourMove = (
    <YourMove
      waiting={view.waiting}
      goals={view.catchUp ? [] : view.goals}
      rhythms={view.catchUp ? [] : view.rhythms}
    />
  );

  const didYouGo = view.didYouGo ?? [];
  const rest = (
    <>
      <DashSection dash={view.dash} />

      {didYouGo.length > 0 && <DidYouGoList suggestions={didYouGo} timeZone={timeZone} />}

      {view.suggestions.length > 0 && (
        <SuggestionsList suggestions={view.suggestions} timeZone={timeZone} />
      )}

      {view.goals.length > 0 && (
        <section aria-labelledby="goals-heading" className="space-y-2">
          <h2 id="goals-heading" className="px-1 text-ui font-semibold text-ink">
            Your goals
          </h2>
          <div className="space-y-4">
            {byArea(view.goals).map(({ areaId, areaName, goals }) => (
              <div key={areaId} className="space-y-1">
                <h3 className="px-1 text-small font-semibold text-ink-muted">
                  <Link href={`/goals/area/${areaId}`} className="underline-offset-2 hover:text-ink hover:underline">
                    {areaName}
                  </Link>
                </h3>
                <Card>
                  <ul className="divide-y divide-border">
                    {goals.map((daily) => (
                      <GoalRow key={daily.goal.id} daily={daily} />
                    ))}
                  </ul>
                </Card>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );

  if (view.catchUp) {
    const folded = [
      hasDash ? 'what Dash has in hand' : null,
      view.goals.length > 0 ? plural(view.goals.length, 'goal') : null,
      didYouGo.length > 0 ? plural(didYouGo.length, 'past event') : null,
      view.suggestions.length > 0 ? plural(view.suggestions.length, 'suggestion') : null,
    ].filter(Boolean);
    return (
      <div className="space-y-6">
        <CatchUpView catchUp={view.catchUp} timeZone={timeZone} waiting={yourMove} />
        {folded.length > 0 && (
          <SectionFold title="Everything else" hint={folded.join(', ')} defaultOpen={false}>
            <div className="space-y-6">{rest}</div>
          </SectionFold>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {lately}
      {yourMove}
      {rest}
    </div>
  );
}

/**
 * Everything that is yours to move, grouped by what it asks: decide,
 * approve, read, do. Do is your own next steps across every goal, earliest
 * due first, then the rhythms running out of days.
 */
function YourMove({
  waiting,
  goals,
  rhythms,
}: {
  waiting: WaitingItem[];
  goals: DailyGoal[];
  rhythms: HomeRhythm[];
}) {
  const groups: Record<WaitingGroup, WaitingItem[]> = { decide: [], approve: [], read: [] };
  for (const item of waiting) groups[WAITING_GROUP[item.kind]].push(item);
  const steps = goals.flatMap((daily) =>
    daily.next.map((item) => ({ item, goalId: daily.goal.id, goalTitle: daily.goal.title })),
  );
  const shown = steps.slice(0, DO_SHOWN);
  const empty = waiting.length === 0 && steps.length === 0 && rhythms.length === 0;

  return (
    <section aria-labelledby="move-heading" className="space-y-2">
      <h2 id="move-heading" className="px-1 text-ui font-semibold text-ink">
        Your move
      </h2>
      {empty ? (
        <p className="px-1 text-small text-ink-muted">Nothing is waiting on you.</p>
      ) : (
        <div className="space-y-4">
          {(['decide', 'approve', 'read'] as const).map(
            (group) =>
              groups[group].length > 0 && (
                <MoveGroup key={group} group={group}>
                  {groups[group].map((item) => (
                    <WaitingRow key={`${item.kind}-${item.id}`} item={item} />
                  ))}
                </MoveGroup>
              ),
          )}
          {(steps.length > 0 || rhythms.length > 0) && (
            <MoveGroup group="do">
              {shown.map(({ item, goalId, goalTitle }) => (
                <NextRow
                  key={item.id}
                  item={{ ...item, under: item.under ? `${goalTitle} · ${item.under}` : goalTitle }}
                  href={`/goals/${goalId}`}
                />
              ))}
              {rhythms.map((rhythm) => (
                <RhythmRow key={rhythm.id} rhythm={rhythm} />
              ))}
              {steps.length > shown.length && (
                <li className="card-pad-x row-pad text-small text-ink-muted">
                  {plural(steps.length - shown.length, 'more step')} in your goals’ trees
                </li>
              )}
            </MoveGroup>
          )}
        </div>
      )}
    </section>
  );
}

function MoveGroup({ group, children }: { group: WaitingGroup | 'do'; children: React.ReactNode }) {
  const id = `move-${group}`;
  return (
    <div className="space-y-1">
      <h3 id={id} className="px-1 text-small font-semibold text-ink-muted">
        {GROUP_LABELS[group]}
      </h3>
      <Card>
        <ul aria-labelledby={id} className="divide-y divide-border">
          {children}
        </ul>
      </Card>
    </div>
  );
}

function RhythmRow({ rhythm }: { rhythm: HomeRhythm }) {
  return (
    <li>
      <Link
        href={`/goals/${rhythm.goalId}`}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Repeat className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">{rhythm.title}</span>
          <span className="block text-small break-words text-ink-muted">{rhythmLine(rhythm)}</span>
        </span>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      </Link>
    </li>
  );
}

/**
 * What Dash has in hand: the runs going now, the Claude steps the next run
 * will work, and the ones held until you approve what they sit under.
 */
function DashSection({ dash }: { dash: DashQueue }) {
  const running = dash.running ?? [];
  const empty = running.length + dash.ready.length + dash.held.length === 0;
  return (
    <section aria-labelledby="dash-heading" className="space-y-2">
      <h2 id="dash-heading" className="px-1 text-ui font-semibold text-ink">
        Dash is on it
      </h2>
      {empty ? (
        <p className="px-1 text-small text-ink-muted">
          Nothing queued. Work on this on a goal gives Dash something to do.
        </p>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {running.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/goals/runs/${run.id}`}
                  className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
                >
                  <span className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui break-words text-ink">
                      {run.on ? `${run.label} · ${run.on}` : run.label}
                    </span>
                    <span className="block text-small break-words text-accent">
                      Working now{run.progress ? ` · ${run.progress}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                </Link>
              </li>
            ))}
            {dash.ready.map((step) => (
              <li key={step.id}>
                <Link
                  href={`/goals/${step.goalId}#step-${step.id}`}
                  className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
                >
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui break-words text-ink">{step.title}</span>
                    <span className="block text-small break-words text-ink-muted">
                      Next morning run · {step.goalTitle}
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                </Link>
              </li>
            ))}
            {dash.held.map((held) => (
              <li key={`${held.on}-${held.goalId}`}>
                <Link
                  href={`/goals/${held.goalId}`}
                  className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
                >
                  <Hourglass className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui break-words text-ink">
                      {plural(held.count, 'step')} on {held.goalTitle}
                    </span>
                    <span className="block text-small break-words text-ink-muted">
                      {held.on === 'goal'
                        ? 'Starts once you approve the goal'
                        : 'Starts once you approve the proposed steps'}
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** What Claude did since your last sitting (plan #1010), newest first. */
function SinceVisitView({ sinceVisit, timeZone }: { sinceVisit: SinceVisit; timeZone: string }) {
  return (
    <section aria-labelledby="since-heading" className="space-y-2">
      <div className="px-1">
        <h2 id="since-heading" className="text-ui font-semibold text-ink">
          Since your last visit
        </h2>
        <p className="text-small text-ink-muted">
          Since {formatInstant(sinceVisit.since, timeZone)}
        </p>
      </div>
      <Card>
        <ul className="divide-y divide-border">
          {sinceVisit.entries.map((entry) => (
            <SinceRow key={entry.runId} entry={entry} />
          ))}
        </ul>
        {sinceVisit.more > 0 && (
          <Link
            href="/goals/runs"
            className="card-pad-x row-pad flex items-center gap-1.5 border-t border-border text-small text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            {sinceVisit.more} more on the Runs page
          </Link>
        )}
      </Card>
    </section>
  );
}

function SinceRow({ entry }: { entry: SinceEntry }) {
  const Icon = entry.failed ? CircleAlert : Sparkles;
  return (
    <li>
      <Link
        href={entry.href}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${entry.failed ? 'text-danger' : 'text-ink-muted'}`}
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">{entry.title}</span>
          <span
            className={`block text-small break-words ${entry.failed ? 'text-danger' : 'text-ink-muted'}`}
          >
            {entry.line}
          </span>
          {entry.error && (
            <span className="line-clamp-2 block text-small break-words text-ink-muted">
              {entry.error}
            </span>
          )}
        </span>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </li>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The catch-up after time away (plan #1019): what Claude finished, what is
 * waiting on you (the same list the ordinary home leads with), and the first
 * next step of each goal.
 */
function CatchUpView({
  catchUp,
  timeZone,
  waiting,
}: {
  catchUp: CatchUp;
  timeZone: string;
  waiting: React.ReactNode;
}) {
  return (
    <>
      <section aria-labelledby="away-heading" className="space-y-2">
        <div className="px-1">
          <h2 id="away-heading" className="text-ui font-semibold text-ink">
            While you were away
          </h2>
          <p className="text-small text-ink-muted">
            Since {formatInstant(catchUp.since, timeZone)}
          </p>
        </div>
        {catchUp.runs.length > 0 ? (
          <Card>
            <ul className="divide-y divide-border">
              {catchUp.runs.map((run) => (
                <RunRow key={run.id} run={run} timeZone={timeZone} />
              ))}
            </ul>
            {catchUp.moreRuns > 0 && (
              <Link
                href="/goals/runs"
                className="card-pad-x row-pad flex items-center gap-1.5 border-t border-border text-small text-ink-muted transition-colors duration-150 hover:text-ink"
              >
                {catchUp.moreRuns} more on the Runs page
              </Link>
            )}
          </Card>
        ) : (
          <p className="px-1 text-small text-ink-muted">
            Claude finished no runs while you were away.
          </p>
        )}
      </section>

      {waiting}

      {catchUp.next.length > 0 && (
        <section aria-labelledby="next-heading" className="space-y-2">
          <h2 id="next-heading" className="px-1 text-ui font-semibold text-ink">
            Next for each goal
          </h2>
          <Card>
            <ul className="divide-y divide-border">
              {catchUp.next.map(({ goalId, goalTitle, item }) => (
                <NextRow
                  key={item.id}
                  item={{ ...item, under: item.under ?? goalTitle }}
                  href={`/goals/${goalId}`}
                />
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}

function RunRow({ run, timeZone }: { run: RunListing; timeZone: string }) {
  const meta = [
    run.item?.title ?? run.area?.name ?? null,
    run.endedAt ? formatInstant(run.endedAt, timeZone, { weekday: false }) : null,
  ].filter((line): line is string => line !== null);
  return (
    <li>
      <Link
        href={`/goals/runs/${run.id}`}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Sparkles
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-ui break-words text-ink">
            {run.summary ?? JOB_LABELS[run.job]}
          </span>
          <span className="block text-small break-words text-ink-muted">
            {[JOB_LABELS[run.job], ...meta].join(' · ')}
          </span>
        </span>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </li>
  );
}

function WaitingRow({ item }: { item: WaitingItem }) {
  const Icon = WAITING_ICONS[item.kind];
  return (
    <li>
      <Link
        href={waitingHref(item)}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">{item.title}</span>
          <span className="block text-small break-words text-ink-muted">{waitingLine(item)}</span>
        </span>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </li>
  );
}

/** The goals in page order, gathered under their areas in the order the areas first come. */
function byArea(goals: DailyGoal[]): { areaId: string; areaName: string; goals: DailyGoal[] }[] {
  const groups = new Map<string, { areaId: string; areaName: string; goals: DailyGoal[] }>();
  for (const daily of goals) {
    const group = groups.get(daily.goal.areaId) ?? {
      areaId: daily.goal.areaId,
      areaName: daily.areaName,
      goals: [],
    };
    group.goals.push(daily);
    groups.set(daily.goal.areaId, group);
  }
  return [...groups.values()];
}

/**
 * One goal: its bar, the weekly verdict and the way into its tree. Listed
 * under its area, so the area is not repeated on the row.
 */
export function GoalRow({ daily }: { daily: DailyGoal }) {
  const { goal, more, next, hasSteps, progress, review } = daily;
  const tree = `/goals/${goal.id}`;
  const steps = next.length + more;
  const treeLabel = !hasSteps
    ? 'Break into steps'
    : steps > 0
      ? `${plural(steps, 'step')} of yours · Full tree`
      : 'Full tree';
  return (
    <li className="card-pad-x row-pad space-y-0.5">
      <p className="text-ui font-semibold break-words text-ink">
        <Link href={tree} className="underline-offset-2 hover:underline">
          {goal.title}
        </Link>
      </p>
      {progress && <GoalProgress progress={progress} label={goal.title} />}
      {review && <ReviewLine review={review} />}
      <Link
        href={tree}
        className="inline-flex items-center gap-1.5 text-small text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ListTree className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {treeLabel}
      </Link>
    </li>
  );
}

/**
 * The weekly run's newest verdict on the goal (plan #1018): the verdict and
 * why on one line, the next move on the next. A stalled goal's next move is
 * also a proposed step, which Your move above offers to approve.
 */
function ReviewLine({ review }: { review: GoalReview }) {
  const checked = formatDay(review.createdAt.slice(0, 10));
  return (
    <div className="space-y-0.5 pt-1 text-small break-words text-ink-muted">
      <p>
        <StateLabel
          glyph={null}
          word={VERDICT_LABELS[review.verdict]}
          tone={VERDICT_TONES[review.verdict]}
          title={`Weekly check, ${checked}`}
          className="mr-1.5 font-semibold"
        />
        {review.reason}
      </p>
      <p>Next: {review.nextMove}</p>
    </div>
  );
}

function NextRow({ item, href }: { item: NextItem; href: string }) {
  const Icon = KIND_ICONS[item.kind];
  // Whose step it is is the glyph's to say; the word is for a screen reader.
  // Printed as well, it was a second line under every row that repeated the
  // glyph beside it, and the only line under an undated step.
  const meta = [
    item.dueOn ? `Due ${formatDay(item.dueOn)}` : null,
    item.under ? `Under ${item.under}` : null,
  ].filter((line): line is string => line !== null);

  return (
    <li>
      <Link
        href={href}
        className="card-pad-x row-pad flex items-start gap-2 transition-colors duration-150 hover:bg-sunken"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui break-words text-ink">
            <span className="sr-only">{STEP_KIND_LABELS[item.kind]}: </span>
            {item.title}
          </span>
          {meta.length > 0 && (
            <span className="block text-small break-words text-ink-muted">{meta.join(' · ')}</span>
          )}
        </span>
      </Link>
    </li>
  );
}
