import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { PlansShelf } from '@/components/learn/plans-shelf';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadActiveAims } from '@/lib/learn/aims-store';
import { countReadyCards } from '@/lib/learn/feed/load';
import { countGoalsWithoutPlan, readWaiting, waitingEmpty, waitingLines } from '@/lib/learn/home/waiting';
import { loadPlans, type PlanSummary } from '@/lib/learn/lessons/plan-store';
import { loadDueReviews } from '@/lib/learn/lessons/review-store';
import { countReadNow } from '@/lib/learn/tracks/load';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home' };

/**
 * The most ideas the review count reads. The query behind it stops at two
 * hundred as well, so a larger limit would count no more.
 */
const REVIEWS_COUNTED = 200;

/**
 * Learn's Home tab, first in the tab list (plan #1310).
 *
 * At the top, what is waiting for you (plan #1311): ideas due for review,
 * readings you said you would read, cards ready in Learn now, and goals with
 * no plan yet, one line each with a link to where you deal with it. The
 * counts are read in parallel, a line at zero is left out, and a count that
 * cannot be read drops its own line rather than the page (lib/learn/home/waiting.ts).
 *
 * Below it, each learning goal's plan with its progress bar and a link to its
 * next piece. The plans used to sit above the deck on Learn now (plan #1143)
 * and moved here so that Learn now is only for reading.
 *
 * Opening Learn lands here (plan #1313): the switcher's home for Learn, and
 * the redirect at /learn.
 */
export default async function LearnHomePage() {
  const user = await requireUser();
  const supabase = await createLearnClient();

  // The plans are read once, for the shelf and for which goals have none.
  const plansRead = loadPlans(supabase, user.id);
  const plansOrNull = plansRead.catch((): PlanSummary[] | null => null);

  const [counts, plans] = await Promise.all([
    readWaiting({
      reviews: async () => (await loadDueReviews(supabase, user.id, { limit: REVIEWS_COUNTED })).length,
      readings: () => countReadNow(supabase),
      cards: () => countReadyCards(supabase),
      goals: async () => {
        const [aims, goalPlans] = await Promise.all([loadActiveAims(supabase), plansRead]);
        return countGoalsWithoutPlan(aims, goalPlans);
      },
    }),
    plansOrNull,
  ]);
  const lines = waitingLines(counts);
  const empty = waitingEmpty(counts);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Home" description="What is waiting for you, and how far through each plan you are." />

      {lines.length > 0 ? (
        <Card padding="none" className="mb-4">
          <h2 className="card-pad-x pt-(--card-p) text-ui font-semibold text-ink">Waiting for you</h2>
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li key={line.key} className="card-pad-x row-pad">
                <Link href={line.href} className="text-body text-ink hover:underline">
                  {line.text}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : empty === 'nothing' ? (
        <p className="mb-4 text-ui text-ink-muted">
          Nothing is waiting for you.{' '}
          <Link href="/learn/now" className="text-accent hover:underline">
            Learn now
          </Link>{' '}
          has the next card when you want one.
        </p>
      ) : (
        <p className="mb-4 text-ui text-ink-muted">What is waiting for you could not be read. Reload to try again.</p>
      )}

      {plans === null ? (
        <p className="text-ui text-ink-muted">Your plans could not be read. Reload to try again.</p>
      ) : plans.length === 0 ? (
        /* A sentence rather than an empty state: the lines above already say
           what to do next, and a goal with no plan is one of them. */
        <p className="text-ui text-ink-muted">
          No plans yet. Each learning goal gets a plan once its track is made; name one on{' '}
          <Link href="/learn/goals" className="text-accent hover:underline">
            Goals
          </Link>
          .
        </p>
      ) : (
        <PlansShelf plans={plans} />
      )}
    </div>
  );
}
