import { createClient, requireUser } from '@/lib/auth/server';
import { workingRefsForPage } from '@/lib/talk/handoffs';
import {
  loadOnTimeSavings,
  loadReturnsTracker,
  parseReturnsGroup,
  parseReturnsView,
} from '@/lib/returns/load';
import { ReturnsPageView } from './returns-view';

export const metadata = { title: 'Returns' };

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; merchant?: string; group?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const view = parseReturnsView(params.view);
  const group = parseReturnsGroup(params.group);
  const merchantFilter = params.merchant?.trim() || undefined;

  const [data, working] = await Promise.all([
    loadReturnsTracker(supabase, user.id, view),
    // What an Ask Dash hand-off is working on (plan #1568).
    workingRefsForPage(user.id),
  ]);
  // The year's on-time refunds, and which are recent enough to count up (plan #1563).
  const savings = await loadOnTimeSavings(supabase, user.id, data.today);

  return (
    <ReturnsPageView
      data={data}
      savings={savings}
      working={working}
      view={view}
      group={group}
      merchantFilter={merchantFilter}
    />
  );
}
