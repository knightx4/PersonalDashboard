import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { areaHref } from '@/lib/goals/all-goals';
import { createGoalsClient } from '@/lib/goals/auth/server';

export const dynamic = 'force-dynamic';

/**
 * An area's old page. Its goals, the goals Dash proposed and its rhythms are
 * now its section on All goals, where they can also be edited, so an old
 * link lands there. An area with no open goal is hidden from Open, the
 * default view, so for one of those the link opens Everything.
 */
export default async function AreaPage({ params }: { params: Promise<{ areaId: string }> }) {
  const { areaId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(areaId)) redirect('/goals/all');
  await requireUser();
  const client = await createGoalsClient();
  const { data } = await client
    .from('items')
    .select('id')
    .eq('level', 'goal')
    .eq('area_id', areaId)
    .is('archived_at', null)
    .not('status', 'in', '(done,dropped)')
    .limit(1);
  redirect(areaHref(areaId, { open: (data ?? []).length > 0 }));
}
