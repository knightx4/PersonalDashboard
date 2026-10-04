import { PageHeader } from '@/components/shell/page-header';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { writtenWhen, type Brief } from '@/lib/goals/briefs';
import { loadBrief } from '@/lib/goals/briefs-store';
import { createGoalsClient } from '@/lib/goals/auth/server';
import type { DoneSince } from '@/lib/goals/done-since';
import { loadDoneSince } from '@/lib/goals/done-since-store';
import { weekHealth } from '@/lib/goals/home';
import { loadHome } from '@/lib/goals/home-store';
import { loadAreas } from '@/lib/goals/store';
import { catchUpSince } from '@/lib/goals/catch-up';
import { recordVisit } from '@/lib/goals/visits-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { HomeView } from './home-view';

export const metadata = { title: 'Goals' };
export const dynamic = 'force-dynamic';

/** When Dash's note was written. Outside the component because it reads the clock. */
function noteWhen(brief: Brief, timeZone: string): string | null {
  return writtenWhen(brief, timeZone, Date.now());
}

/** The clock, read outside the component because reading it during render is unstable. */
function now(): number {
  return Date.now();
}

/**
 * The Goals home (plan #1077): Dash's briefing with Ask Dash, every goal as
 * a tile over three lanes (On you, Dash has it, Later), what Dash did since
 * your last visit, and the week's four numbers (plan #1079). The layout and
 * what moved where from the old home are in home-view.tsx.
 *
 * Each visit is recorded (plan #1019), and what Dash did is read from the
 * visit before this sitting (plan #1076); after time away that is the visit
 * before you left, so the list covers the whole time away. A first visit has
 * no window, and lists only results still unread.
 *
 * The loader checks that the schema is exposed, so a deployment where `goals`
 * is not exposed to PostgREST says so here instead of showing an empty page
 * that looks right.
 */
export default async function GoalsPage() {
  const user = await requireUser();
  const account = await loadAccountSettings(user.id);
  const client = await createGoalsClient();
  const today = todayIn(account.timezone);
  const [home, visit, brief, areas, owner] = await Promise.all([
    createClient().then((supabase) =>
      loadHome(client, supabase, {
        userId: user.id,
        today,
        timeZone: account.timezone,
        now: now(),
      }),
    ),
    recordVisit(client, { userId: user.id, today }),
    // A failed read leaves the note out rather than the page.
    loadBrief(client, null).catch((): Brief | null => null),
    // The areas an errand can go in; a failed read leaves Add an errand out.
    loadAreas(client).catch(() => []),
    // Ask Dash starts a run, which only the owner's account may (shaping-actions.ts).
    isOwner({ user }),
  ]);
  // A failed read says so in its section rather than failing the page.
  const done = await loadDoneSince(client, visit.previousVisitAt ?? visit.lastVisitAt).catch(
    (): DoneSince | null => null,
  );

  // The day you come back after time away, the home leads with what Dash did.
  const awayFrom = catchUpSince(visit, today);

  const { week, ...rest } = home;
  // The count of what is on you is the whole of Today, folded part included.
  const health = week
    ? weekHealth({
        week: week.span,
        dashClosedAt: week.dashClosedAt,
        waitingOnYou: home.today.length + home.later.length,
        stuck: week.stuck,
        visitDays: visit.visitDays,
      })
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Goals" />
      <HomeView
        {...rest}
        done={done}
        health={health}
        brief={brief ? { body: brief.body, when: noteWhen(brief, account.timezone) } : null}
        timeZone={account.timezone}
        todayOn={today}
        areas={areas.map((area) => ({ id: area.id, name: area.name }))}
        canRun={owner}
        awayFrom={awayFrom}
      />
    </div>
  );
}
