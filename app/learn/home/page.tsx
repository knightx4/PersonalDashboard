import { Target } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { PlansShelf } from '@/components/learn/plans-shelf';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadPlans, type PlanSummary } from '@/lib/learn/lessons/plan-store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home' };

/**
 * Learn's Home tab, first in the tab list (plan #1310): each learning goal's
 * plan with its progress bar and a link to its next piece. The plans used to
 * sit above the deck on Learn now (plan #1143) and moved here so that Learn
 * now is only for reading.
 *
 * Learn still opens on Learn now; where it opens is plan #1313's.
 */
export default async function LearnHomePage() {
  const user = await requireUser();
  const supabase = await createLearnClient();

  // A failed read becomes a line where the plans would be, not a broken page.
  let plans: PlanSummary[] | null;
  try {
    plans = await loadPlans(supabase, user.id);
  } catch {
    plans = null;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Home" description="Your study plans, how far through each you are, and what is next." />
      {plans === null ? (
        <p className="text-ui text-ink-muted">Your plans could not be read. Reload to try again.</p>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No plans yet"
          description="Each learning goal gets a plan once its track is made. Name a goal and its plan shows here with its progress."
          action={{ label: 'Goals', href: '/learn/goals' }}
        />
      ) : (
        <PlansShelf plans={plans} />
      )}
    </div>
  );
}
