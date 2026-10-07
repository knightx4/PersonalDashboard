import { createVaultClient } from '@/lib/vault/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadThreads, MAYA_THREAD_LIMIT } from '@/lib/vault/maya/store';
import { MayaListView } from './maya-view';

export const dynamic = 'force-dynamic';

/**
 * The Maya tab (plan #1286): every thread with Maya, the one most recently
 * opened or talked in first. Each row is the question, the note it is on, and
 * where you have got to when there is a summary yet.
 *
 * A thread opens from a note's Maya section; from #1289 Maya also opens some
 * after a sync, marked here as picked by Maya.
 */
export default async function MayaPage() {
  const threads = await loadThreads({ core: await createCoreClient(), vault: await createVaultClient() });
  return <MayaListView threads={threads} limit={MAYA_THREAD_LIMIT} />;
}
