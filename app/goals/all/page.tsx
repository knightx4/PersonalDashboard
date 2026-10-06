import Link from 'next/link';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { allGoalsViewOf } from '@/lib/goals/all-goals';
import { GoalsView } from '../goals-view';
import { loadAllGoals } from './data';

export const metadata = { title: 'All goals' };
export const dynamic = 'force-dynamic';

/**
 * Every area and the goals under it (plan #924), where they are added, named,
 * ordered and archived. Each goal links to its full tree of steps (#925). It
 * was the home until the daily view took that place (#926). Each area can
 * ask Dash to propose its goals (Plan this area), and lists its rhythms with
 * this period's progress. An area's name opens its own page (plan #1619),
 * which draws the same section on its own.
 *
 * Open, On you and Everything narrow it (plan #1158), kept in `?view=` as a
 * goal page's step views are. On you is what the home's Today list gathers,
 * counted per goal, so the live tree is read once for that and for each
 * goal's bar.
 *
 * The loaders check that the schema is exposed, so a deployment where `goals`
 * is not exposed to PostgREST says so here instead of showing an empty page
 * that looks right.
 */
export default async function AllGoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const view = allGoalsViewOf((await searchParams).view);
  const user = await requireUser();
  const data = await loadAllGoals(user, view);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="All goals"
        actions={
          // Files has no tab; the longer pieces Dash wrote are reached from here and from each goal.
          <Link
            href="/goals/files"
            className="inline-flex items-center gap-1.5 text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
            Files
          </Link>
        }
      />
      <GoalsView {...data} view={view} />
    </div>
  );
}
