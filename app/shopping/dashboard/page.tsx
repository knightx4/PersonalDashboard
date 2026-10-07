import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadPeople, parsePersonFilter } from '@/lib/people/load';
import { loadDashboard, parseDashboardRange } from '@/lib/dashboard/load';
import { DashboardView } from './dashboard-view';

export const metadata = { title: 'Dashboard' };

/**
 * Every figure on this page comes from lib/money.ts. Do not compute spend
 * inline here -- there is exactly one definition of what a month cost, and it
 * lives there.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; person?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;
  const range = parseDashboardRange(params.range);

  const people = await loadPeople(core, user.id);
  const personId = parsePersonFilter(params.person, people);

  const data = await loadDashboard(supabase, user.id, range, personId);

  return <DashboardView range={range} personId={personId} people={people} data={data} />;
}
