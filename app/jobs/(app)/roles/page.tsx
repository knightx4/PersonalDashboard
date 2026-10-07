import { redirect } from 'next/navigation';
import { rolesRedirect, type PipelineParams } from '@/lib/jobs/pipeline-view';

/**
 * The Roles page is Pipeline's table view now (plan #1590). An old link lands
 * on the table with whatever it asked for, so a bookmark still works.
 */
export default async function RolesPage({ searchParams }: { searchParams: Promise<PipelineParams> }) {
  redirect(rolesRedirect(await searchParams));
}
