import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadPlan } from '@/lib/plan/load';
import { endQuietRuns, loadLastRuns, loadRunRaises } from '@/lib/plan/runs';
import { loadCommitChecks } from '@/lib/plan/ci';
import { loadOverhaulProgress } from '@/lib/plan/overhaul-progress-load';
import { loadCriticStops } from '@/lib/plan/critic-stop-load';
import { loadScreenChanges } from '@/lib/plan/screen-change-load';
import { buildPlanTree, flatten, planLiveness } from '@/lib/plan/tree';
import { findFeature, stepRedirect } from '@/lib/plan/feature-page';
import { projectById } from '@/lib/plan/projects';
import { planRoutine, projectRoutine } from '@/lib/feedback/routine';
import { catalogOf } from '../plan-catalog';
import { FeaturePage } from '../feature-page';

type Params = Promise<{ number: string }>;

function numberOf(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const number = numberOf((await params).number);
  if (number === null) return { title: 'Plan' };
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_items')
    .select('title')
    .eq('user_id', user.id)
    .eq('number', number)
    .maybeSingle();
  return { title: data?.title ?? 'Plan' };
}

/**
 * The claims on the steps, read against the last run on each. Out of the
 * render because it reads the clock, as on the plan page.
 */
function claimsAsOfNow(
  items: Parameters<typeof planLiveness>[0],
  runs: Parameters<typeof planLiveness>[1],
) {
  return planLiveness(items, runs, Date.now());
}

/**
 * A feature's own page (plan #1664). A step's or substep's number opens its
 * feature's Steps tab at that step's row, so every number on the plan has a
 * page to go to.
 */
export default async function FeatureRoute({ params }: { params: Params }) {
  const number = numberOf((await params).number);
  if (number === null) notFound();

  const user = await requireUser();
  const supabase = await createClient();
  await endQuietRuns({ supabase, userId: user.id });

  const [data, lastRuns, runRaises, commitChecks, screenChanges] = await Promise.all([
    loadPlan(supabase, user.id),
    loadLastRuns(supabase, user.id),
    loadRunRaises(supabase, user.id),
    loadCommitChecks(supabase, user.id),
    loadScreenChanges(supabase, user.id),
  ]);

  const liveness = claimsAsOfNow(data.items, lastRuns);
  const sections = buildPlanTree(data, liveness);
  const found = findFeature(sections, number);
  if (!found) notFound();
  const elsewhere = stepRedirect(found.feature, found.target);
  if (elsewhere) redirect(elsewhere);

  const { feature, module, moduleLabel } = found;
  const beneath = flatten([feature]);
  const [overhaulProgress, criticStops] = await Promise.all([
    loadOverhaulProgress(
      supabase,
      user.id,
      beneath.filter((node) => node.track === 'overhaul'),
    ),
    loadCriticStops(supabase, user.id, beneath),
  ]);

  // A project's feature sends to the project's routine, and only once it is
  // set, as on the project's page.
  const project = projectById(module);
  const canSend = project
    ? Boolean(projectRoutine(project).id && projectRoutine(project).token)
    : Boolean(planRoutine().token);

  return (
    <FeaturePage
      feature={feature}
      module={module}
      moduleLabel={moduleLabel}
      catalog={catalogOf(sections)}
      canSend={canSend}
      lastRuns={lastRuns}
      runRaises={runRaises}
      liveness={liveness}
      commitChecks={commitChecks}
      overhaulProgress={overhaulProgress}
      criticStops={criticStops}
      screenChanges={screenChanges}
    />
  );
}
