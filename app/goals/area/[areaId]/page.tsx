import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { allGoalsViewOf } from '@/lib/goals/all-goals';
import { loadAllGoals } from '../../all/data';
import { GoalsView } from '../../goals-view';

export const metadata = { title: 'Area' };
export const dynamic = 'force-dynamic';

/**
 * An area's own page (plan #1619): its goals, the goals Dash proposed for it
 * and its rhythms, with the editing All goals offers, since it draws the same
 * section from the same read. The name is the heading and is renamed here,
 * under the path Goals › the area (plan #1622).
 * Open, On you and Everything narrow its goals as they do on All goals.
 *
 * An archived area, or an id that is not one of the person's areas, has no
 * page: an id that is not a uuid goes to All goals, and an unknown one is a
 * 404.
 */
export default async function AreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ areaId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { areaId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(areaId)) redirect('/goals/all');
  const view = allGoalsViewOf((await searchParams).view);
  const user = await requireUser();
  const data = await loadAllGoals(user, view);
  if (!data.areas.some((area) => area.id === areaId)) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <GoalsView {...data} view={view} areaId={areaId} />
    </div>
  );
}
