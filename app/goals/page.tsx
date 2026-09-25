import { PageHeader } from '@/components/shell/page-header';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { catchUp, catchUpSince } from '@/lib/goals/catch-up';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { withWaiting, type DailyView as Daily } from '@/lib/goals/daily';
import { flagsWaiting } from '@/lib/goals/flags';
import { loadGoalFlags, loadGoalTitles } from '@/lib/goals/flags-store';
import { loadHomeExtras } from '@/lib/goals/home-store';
import { loadRunsEndedSince } from '@/lib/goals/runs-store';
import { loadSinceVisit } from '@/lib/goals/since-visit-store';
import { loadDailyView } from '@/lib/goals/steps-store';
import { didYouGoSuggestions, homeSuggestions } from '@/lib/goals/suggestions';
import { loadGoingSuggestions, loadRecentSuggestions } from '@/lib/goals/suggestions-store';
import { recordVisit } from '@/lib/goals/visits-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { DailyView } from './daily-view';

export const metadata = { title: 'Goals' };
export const dynamic = 'force-dynamic';

/**
 * Every goal on the home by id, open or proposed, so the context and drafts
 * waiting on either can be named. Outside the component, with the clock read
 * here, because reading the clock during render is unstable.
 */
function homeExtras(client: Awaited<ReturnType<typeof createGoalsClient>>, daily: Daily) {
  const titles = new Map<string, string>(daily.goals.map((d) => [d.goal.id, d.goal.title]));
  for (const item of daily.waiting) {
    if (item.kind === 'plan') for (const goal of item.goals) titles.set(goal.id, goal.title);
  }
  return loadHomeExtras(client, titles, Date.now()).catch(() => ({ waiting: [], running: [] }));
}

/**
 * The Goals home, for a once-a-day visit (docs/GOALS-SPEC.md, "The daily
 * view"; plan #926), sorted by whose move it is: what is on you (decide,
 * approve, read, do), then what Dash has in hand, then the goals
 * themselves. Adding and arranging goals is on the All goals tab, and each
 * goal's full tree is one tap from here. The weekly run's suggestions
 * (plan #934) sit after what is waiting on you, below "Did you go?" for the
 * events you said you were going to whose day has passed (plan #1020).
 *
 * Each visit is recorded (plan #1019). On the day you come back after five or
 * more days away, the page leads with a catch-up from the day you left.
 * Otherwise it leads with what Claude did since your last sitting (plan
 * #1010), which the next sitting clears. What a run flagged on a goal
 * (plan #1015) is listed under Your move with the rest.
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
  const [daily, suggestions, going, visit, flags] = await Promise.all([
    loadDailyView(client, { userId: user.id, today }),
    loadRecentSuggestions(client),
    loadGoingSuggestions(client),
    recordVisit(client, { userId: user.id, today }),
    createClient().then((supabase) => loadGoalFlags(supabase, { userId: user.id })),
  ]);
  // What runs flagged on a goal (plan #1015) lives in public.raised_items, so
  // it joins the waiting list here rather than in the step trees.
  const [titles, extras] = await Promise.all([
    loadGoalTitles(client, flags.map((flag) => flag.goalId)).catch(() => new Map<string, string>()),
    // The context and drafts waiting to be read, and the runs going now.
    homeExtras(client, daily),
  ]);
  const view = {
    ...daily,
    waiting: withWaiting(daily.waiting, [...flagsWaiting(flags, titles), ...extras.waiting]),
    dash: { ...daily.dash, running: extras.running },
  };
  const since = catchUpSince(visit, today);
  const away = since ? catchUp(since, await loadRunsEndedSince(client, since), view) : null;
  // The catch-up already lists the runs from the time away.
  const lately =
    !away && visit.previousVisitAt ? await loadSinceVisit(client, visit.previousVisitAt) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Goals" />
      <DailyView
        view={{
          ...view,
          suggestions: homeSuggestions(suggestions, today),
          didYouGo: didYouGoSuggestions(going, today),
          catchUp: away,
          sinceVisit: lately,
        }}
        timeZone={account.timezone}
      />
    </div>
  );
}
