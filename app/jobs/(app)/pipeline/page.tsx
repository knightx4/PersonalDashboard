import { redirect } from 'next/navigation';
import { countConnectedInboxes } from '@/lib/core/inbox/accounts';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadWorkingRefs } from '@/lib/talk/handoffs';
import { PipelinePage } from '@/components/jobs/pipeline/pipeline-page';
import { loadPipeline } from '@/lib/jobs/applications/load';
import type { PipelineParams } from '@/lib/jobs/pipeline-view';
import { rolesDisplay } from '@/lib/jobs/roles-display';
import { withApplicationNotes } from '@/lib/jobs/suggest/score-notes-load';
import { defaultViewHref, savedViewsFor } from '@/lib/saved-views/store';

export const metadata = { title: 'Pipeline' };

/**
 * Every application, as a board or a table (plan #1590). Pipeline and Roles
 * were two pages over the same rows; /jobs/roles now redirects here. Both
 * views open on the live applications, and the closed ones are a filter.
 * What is drawn, and how the address is read, is in PipelinePage and
 * lib/jobs/pipeline-view.ts.
 */
export default async function Page({ searchParams }: { searchParams: Promise<PipelineParams> }) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;

  const [pipeline, inboxCount, working, savedViews] = await Promise.all([
    loadPipeline(supabase, user.id),
    countConnectedInboxes(core, user.id),
    // What an Ask Dash hand-off is working on (plan #1568).
    loadWorkingRefs(core, user.id),
    savedViewsFor(core, rolesDisplay().pathname),
  ]);

  // A saved view marked as the default opens when the bare page is asked for.
  const openOn = defaultViewHref(savedViews, params);
  if (openOn) redirect(openOn);

  // Fit and chance on each row (plan #1206).
  const rows = await withApplicationNotes(supabase, user.id, pipeline);

  return (
    <PipelinePage
      rows={rows}
      params={params}
      savedViews={savedViews}
      working={working}
      hasInbox={(inboxCount ?? 0) > 0}
    />
  );
}
