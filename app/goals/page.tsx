import { PageHeader } from '@/components/shell/page-header';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { writtenWhen, type Brief } from '@/lib/goals/briefs';
import { loadBrief } from '@/lib/goals/briefs-store';
import { createGoalsClient } from '@/lib/goals/auth/server';
import type { DoneSince } from '@/lib/goals/done-since';
import { loadDoneSince } from '@/lib/goals/done-since-store';
import { loadHome } from '@/lib/goals/home-store';
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
 * The Goals home (plan #1077): a sentence on where the goals stand, Today,
 * each open goal on one line, and what Dash did since your last visit. The
 * layout and what moved where from the old home are in home-view.tsx.
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
  const [home, visit, brief] = await Promise.all([
    createClient().then((supabase) =>
      loadHome(client, supabase, { userId: user.id, today, now: now() }),
    ),
    recordVisit(client, { userId: user.id, today }),
    // A failed read leaves the note out rather than the page.
    loadBrief(client, null).catch((): Brief | null => null),
  ]);
  // A failed read says so in its section rather than failing the page.
  const done = await loadDoneSince(client, visit.previousVisitAt ?? visit.lastVisitAt).catch(
    (): DoneSince | null => null,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Goals" />
      <HomeView
        {...home}
        done={done}
        brief={brief ? { body: brief.body, when: noteWhen(brief, account.timezone) } : null}
        timeZone={account.timezone}
      />
    </div>
  );
}
