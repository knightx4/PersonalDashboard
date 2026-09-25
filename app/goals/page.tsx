import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadDailyView } from '@/lib/goals/steps-store';
import { homeSuggestions } from '@/lib/goals/suggestions';
import { loadRecentSuggestions } from '@/lib/goals/suggestions-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { DailyView } from './daily-view';

export const metadata = { title: 'Goals' };
export const dynamic = 'force-dynamic';

/**
 * The Goals home, for a once-a-day visit (docs/GOALS-SPEC.md, "The daily
 * view"; plan #926): what is waiting on you, then the next few things for
 * each active goal. Adding and arranging goals is on the All goals tab, and
 * each goal's full tree is one tap from here. The weekly run's suggestions
 * (plan #934) sit after what is waiting on you.
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
  const [view, suggestions] = await Promise.all([
    loadDailyView(client, { userId: user.id, today }),
    loadRecentSuggestions(client),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Goals" />
      <DailyView
        view={{ ...view, suggestions: homeSuggestions(suggestions, today) }}
        timeZone={account.timezone}
      />
    </div>
  );
}
