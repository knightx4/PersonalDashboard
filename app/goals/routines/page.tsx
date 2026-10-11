import Link from 'next/link';
import { RoutinesScreen } from '@/components/routines/routine-list';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { routinesFor } from '@/lib/routines/registry';
import { loadRoutineFacts } from '@/lib/routines/store';
import { routineViews } from '@/lib/routines/view';

export const metadata = { title: 'Routines' };
export const dynamic = 'force-dynamic';

/**
 * The runs Goals makes on a clock: the morning run, the weekly run, the run
 * after your answers, and the syncs behind them (lib/routines/registry.ts).
 * Dev has the same page for its own routines, drawn by the same component.
 * Every single run, scheduled or asked for, is on Runs.
 */
export default async function GoalRoutinesPage() {
  const user = await requireUser();
  const routines = routinesFor('goals');
  const [account, supabase, goals] = await Promise.all([
    loadAccountSettings(user.id),
    createClient(),
    createGoalsClient(),
  ]);
  const facts = await loadRoutineFacts(routines, { supabase, goals });
  const views = routineViews(routines, facts, account.timezone);

  return (
    <RoutinesScreen
      description="What Dash does on a schedule for your goals, and how each last went."
      actions={
        <Link href="/goals/runs" className="press-area text-small text-ink-muted underline-offset-2 hover:underline">
          Every run
        </Link>
      }
      routines={views}
    />
  );
}
