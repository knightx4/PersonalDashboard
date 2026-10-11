import { PageHeader } from '@/components/shell/page-header';
import { RoutineList } from '@/components/routines/routine-list';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { routinesFor } from '@/lib/routines/registry';
import { loadRoutineFacts } from '@/lib/routines/store';
import { routineViews } from '@/lib/routines/view';

export const metadata = { title: 'Routines' };
export const dynamic = 'force-dynamic';

/**
 * The runs Dev makes on a clock: the vision review, the spec audit, the
 * overnight runner and the rest (lib/routines/registry.ts). Recurring work is
 * listed here rather than kept open on the plan. Goals has the same page for
 * its own routines, drawn by the same component.
 */
export default async function DevRoutinesPage() {
  const user = await requireUser();
  const routines = routinesFor('dev');
  const [account, supabase] = await Promise.all([loadAccountSettings(user.id), createClient()]);
  const facts = await loadRoutineFacts(routines, { supabase });
  const views = routineViews(routines, facts, account.timezone);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Routines" description="What Dash does on a schedule for the app, and how each last went." />
      <RoutineList routines={views} />
    </div>
  );
}
