import { notFound } from 'next/navigation';
import { isModuleId, moduleById } from '@/lib/modules';
import { moduleSummary } from '@/lib/dev/module-page';
import { loadModuleInputs } from '../load';
import { ModuleView } from '../modules-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: (isModuleId(id) && moduleById(id)?.label) || 'Module' };
}

/**
 * One workspace's page in Dev: its plan, bugs, ideas, spec, UI review, usage
 * and changelog. Every tab is drawn from the one summary, so all of them are
 * drawn here and the row switches between them in the browser.
 */
export default async function DevModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = isModuleId(id) ? moduleById(id) : null;
  if (!workspace) notFound();

  const summary = moduleSummary(workspace, await loadModuleInputs());
  return <ModuleView summary={summary} now={new Date()} />;
}
