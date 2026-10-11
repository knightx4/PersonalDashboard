import { notFound } from 'next/navigation';
import { isModuleId, moduleById } from '@/lib/modules';
import { MODULE_TABS, moduleSummary, type ModuleTab } from '@/lib/dev/module-page';
import { tabFrom } from '@/lib/tabs';
import { loadModuleInputs } from '../load';
import { ModuleView, moduleTabs } from '../modules-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: (isModuleId(id) && moduleById(id)?.label) || 'Module' };
}

/** One workspace's page in Dev: its plan, bugs, ideas, spec, UI review, usage and changelog. */
export default async function DevModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const workspace = isModuleId(id) ? moduleById(id) : null;
  if (!workspace) notFound();

  const summary = moduleSummary(workspace, await loadModuleInputs());
  const opened = tabFrom((await searchParams).tab, moduleTabs(summary));
  const tab: ModuleTab = (MODULE_TABS as readonly string[]).includes(opened)
    ? (opened as ModuleTab)
    : 'overview';

  return <ModuleView summary={summary} tab={tab} now={new Date()} />;
}
