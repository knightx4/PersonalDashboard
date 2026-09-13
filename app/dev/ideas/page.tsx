import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadIdeas } from '@/lib/ideas/load';
import { parseIdeaGrouping, parseIdeaSort } from '@/lib/ideas/view';
import { IdeasView } from './ideas-view';

export const metadata = { title: 'Ideas' };

/**
 * The things that might be worth doing one day.
 *
 * Kept apart from the queue next door on purpose: everything in that list is a
 * claim that something should happen soon, and mixing "one day this could read
 * receipts from photos" into it would either bury the work or turn the queue's
 * statuses into fiction. Nothing here is scheduled or worked — an idea becomes
 * work by being filed as a request.
 */
export default async function DevIdeasPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[]; sort?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  // How the list is arranged is a search parameter, not state (law 5), so a
  // list put in the order you wanted survives a refresh and can be linked. It
  // is read here rather than in the view because the view is a client
  // component and this is where the URL is.
  const grouping = parseIdeaGrouping(params.group);
  const sort = parseIdeaSort(params.sort);

  const ideas = await loadIdeas(supabase, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Ideas"
        description="Long-term ideas, for the app as a whole or for one workspace. Nothing here does anything on its own — it is a place to put the thought."
      />
      <IdeasView ideas={ideas} grouping={grouping} sort={sort} />
    </div>
  );
}
