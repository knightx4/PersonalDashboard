import { moduleSummaries } from '@/lib/dev/module-page';
import { loadModuleInputs } from './load';
import { ModulesIndexView } from './modules-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Modules' };

/** Every workspace, one row each, with what is open in it. */
export default async function DevModulesPage() {
  return <ModulesIndexView summaries={moduleSummaries(await loadModuleInputs())} />;
}
