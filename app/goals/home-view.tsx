import Link from 'next/link';
import { Flag } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { PRESS_AREA } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { daysAway } from '@/lib/goals/catch-up';
import { formatInstant } from '@/lib/goals/dates';
import type { DoneSince } from '@/lib/goals/done-since';
import type { DashOffer } from '@/lib/goals/hand-off';
import {
  areaButtons,
  briefParts,
  errandAreaDefault,
  homeLists,
  homeSummary,
  splitErrands,
  type AreaButton,
  type HomeGoal,
} from '@/lib/goals/home';
import type { DashLaneItem, LaterLaneItem } from '@/lib/goals/lanes';
import type { RunListing } from '@/lib/goals/runs';
import { TODAY_CAP, type TodayItem } from '@/lib/goals/today';
import { goalInboxCount } from '@/lib/goals/inbox';
import { AskDash } from './ask-dash';
import { DoneSinceList } from './done-since-list';
import { FoldLine } from './fold-line';
import { GoalLanes } from './goal-lanes';

/**
 * The Goals home (plan #1077, under #1072), for a once-a-day visit. One
 * column, in the order you act on it:
 *
 * 1. Dash's card: one sentence on where the goals stand, the first paragraph
 *    of Dash's morning note (goals.briefs) with More for the rest, and Ask
 *    Dash, which goes to a goal or starts a new goal or errand
 *    (ask-dash.tsx).
 * 2. The week's focus goals by name (`focusLine`) and the card that plans
 *    the week (`planWeek`), both drawn by the page when it has them.
 * 3. A button to each area's page (note d79a0005), directly above
 * 4. Do next: at most five things on you from the week's goals, with Dash's
 *    draft beside the step it is for (goal-lanes.tsx, homeLists in
 *    lib/goals/home.ts).
 *    Everything else on you is on the Inbox tab (app/goals/inbox), which
 *    Do next links to with its count.
 * 5. Lines that open in place: what Dash is on, what Dash did since your
 *    last visit (done-since-list.tsx), what you set aside, and Other goals.
 *
 * The day you come back after five or more days away (lib/goals/catch-up.ts),
 * Dash's card says how long you were gone and the line for what Dash did
 * starts open.
 */

export type HomeViewProps = {
  goals: HomeGoal[];
  /** Everything on you, ranked (todayRanked), each step with what Dash prepared for it. */
  onYou: TodayItem[];
  /** What Dash did since your last visit; null when it could not be read. */
  done: DoneSince | null;
  /** Dash's latest note on all the goals (goals.briefs), and when it was written. */
  brief: { body: string; when: string | null } | null;
  /** The account's zone, for the time of your last visit. */
  timeZone: string;
  /** YYYY-MM-DD in that zone, for how long an errand has left. */
  todayOn?: string;
  /** Your live areas, for the area an errand goes in; none when they could not be read. */
  areas?: { id: string; name: string; learn?: boolean }[];
  /** The runs going now. */
  working?: RunListing[];
  /** What Dash could take: goals it has left alone. */
  offers?: DashOffer[];
  /** The step ids on you that Dash could prepare. */
  preparable?: string[];
  /** Dash's open steps. */
  dash?: DashLaneItem[];
  /** Steps set aside until a later day. */
  laterOn?: LaterLaneItem[];
  /** Whether this account can start a run (the owner's only), which Ask Dash needs. */
  canRun?: boolean;
  /** The visit before the time away, on the day you came back from it; otherwise null. */
  awayFrom?: string | null;
  /** The week's focus goals by name, under Dash's card; nothing is drawn without it. */
  focusLine?: React.ReactNode;
  /** The card that plans the week, above Do next; nothing is drawn without it. */
  planWeek?: React.ReactNode;
};

export function HomeView({
  goals,
  onYou,
  done,
  brief,
  timeZone,
  todayOn,
  areas = [],
  working = [],
  offers = [],
  preparable = [],
  dash = [],
  laterOn = [],
  canRun = false,
  awayFrom = null,
  focusLine,
  planWeek,
}: HomeViewProps) {
  if (goals.length === 0 && onYou.length === 0) {
    return (
      <EmptyState
        icon={Flag}
        title="No goals yet"
        description="Add the goals you are working towards. Each gets a status every morning, and what to do about them shows here."
        action={{ label: 'Add a goal', href: '/goals/all' }}
      />
    );
  }

  const summary = homeSummary(goals);
  const away = awayFrom && todayOn ? daysAway(awayFrom, todayOn) : null;
  const { errands } = splitErrands(goals);
  const { doNext, otherGoals } = homeLists(onYou, goals, todayOn, TODAY_CAP);
  const note = brief ? briefParts(brief.body) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section aria-labelledby="briefing-heading">
        <Card padding="standard" className="space-y-3">
          <div className="flex items-center gap-2">
            <DashMark size="sm" tone="brand" decorative />
            <h2 id="briefing-heading" className="text-ui font-semibold text-ink">
              Dash
            </h2>
            {brief?.when && <span className="text-small text-ink-muted">written {brief.when}</span>}
          </div>
          {away !== null && (
            <p className="text-body text-ink">
              Welcome back. You were away {away} days. What Dash did while you were gone is open
              below Do next.
            </p>
          )}
          {summary && <p className="text-body text-ink">{summary}</p>}
          {note && (
            <div className="max-w-prose space-y-1">
              <FileBody markdown={note.lead} compact />
              {note.rest && (
                <Disclosure
                  title="More"
                  summaryClassName="text-small max-sm:min-h-11"
                  bodyClassName="mt-1"
                >
                  <FileBody markdown={note.rest} compact />
                </Disclosure>
              )}
            </div>
          )}
          <AskDash
            goals={goals.map(({ goal }) => ({ id: goal.id, title: goal.title }))}
            areas={areas}
            defaultAreaId={errandAreaDefault(errands, areas)}
          />
        </Card>
      </section>

      {focusLine}
      {planWeek}

      <AreaButtons buttons={areaButtons(areas, goals)} />

      <GoalLanes
        doNext={doNext}
        inboxCount={goalInboxCount(onYou, dash)}
        otherGoals={otherGoals}
        todayOn={todayOn}
        preparable={preparable}
        dash={dash}
        laterOn={laterOn}
        working={working}
        offers={offers}
        canRun={canRun}
        since={<SinceLine done={done} timeZone={timeZone} open={away !== null} />}
      />
    </div>
  );
}

/**
 * A big button to each area's page, two to a row on a phone, so an area is
 * one press from the home. Nothing is drawn when the areas could not be read.
 */
function AreaButtons({ buttons }: { buttons: AreaButton[] }) {
  if (buttons.length === 0) return null;
  return (
    <nav aria-labelledby="areas-heading" className="space-y-2">
      <h2 id="areas-heading" className="px-1 text-ui font-semibold text-ink">
        Areas
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {buttons.map((button) => (
          <li key={button.id}>
            <Link
              href={button.href}
              className={cn(
                cardVariants({ padding: 'standard', interactive: true }),
                'flex min-h-16 h-full flex-col justify-center gap-0.5',
              )}
            >
              <span className="text-ui font-semibold text-ink">{button.name}</span>
              <span className="text-small text-ink-muted">
                {button.goals === 0
                  ? 'no open goals'
                  : `${button.goals} open ${button.goals === 1 ? 'goal' : 'goals'}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "3 results, 1 change", from what Dash did; null when there was nothing. */
function doneCounts(done: DoneSince): string | null {
  const count = (kind: string) => done.items.filter((item) => item.kind === kind).length;
  const results = count('result');
  const changes = count('change') + done.more;
  const failed = count('failed');
  const parts = [
    results > 0 ? `${results} ${results === 1 ? 'result' : 'results'}` : null,
    changes > 0 ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : null,
    failed > 0 ? `${failed} failed ${failed === 1 ? 'run' : 'runs'}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * What Dash did since your last visit, as one line that opens to the list
 * with Read and Undo, and the link to every run.
 */
function SinceLine({
  done,
  timeZone,
  open,
}: {
  done: DoneSince | null;
  timeZone: string;
  open: boolean;
}) {
  const counts = done ? doneCounts(done) : null;
  return (
    <FoldLine
      title="Since your last visit"
      meta={done ? (counts ?? 'nothing new') : 'could not be read just now'}
      defaultOpen={open}
    >
      {done && done.items.length > 0 ? (
        <DoneSinceList done={done} />
      ) : (
        <p className="px-1 text-small text-ink-muted">
          {done ? 'Nothing new since your last visit.' : 'This could not be read just now.'}
        </p>
      )}
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 px-1 text-small text-ink-muted">
        {done && <span>What Dash did since {formatInstant(done.since, timeZone)}</span>}
        {/* Runs left the tab bar: an audit log, read from here when wanted. */}
        <Link
          href="/goals/runs"
          className={cn(PRESS_AREA, 'text-accent underline-offset-2 hover:underline')}
        >
          Every run
        </Link>
      </p>
    </FoldLine>
  );
}
