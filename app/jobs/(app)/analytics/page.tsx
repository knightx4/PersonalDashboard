import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { loadPipeline, toFunnelApplications } from '@/lib/jobs/applications/load';
import { AnalyticsView } from './analytics-view';

export const metadata = { title: 'Analytics' };

/**
 * Every number on this page comes from lib/pipeline.ts, through the view in
 * analytics-view.tsx. Nothing is computed inline here.
 */
export default async function AnalyticsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const rows = await loadPipeline(supabase, user.id);
  return <AnalyticsView applications={toFunnelApplications(rows)} />;
}
