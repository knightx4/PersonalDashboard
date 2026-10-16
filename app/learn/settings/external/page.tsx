import { createLearnClient } from '@/lib/learn/auth/server';
import { listExternalChecks } from '@/lib/learn/external/store';
import { ExternalChecksView } from './external-view';

export const metadata = { title: 'External check' };
export const dynamic = 'force-dynamic';

/** The external sets sat so far, and the form that starts another (plan #2179.4). */
export default async function ExternalChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ new: asked }, checks] = await Promise.all([
    searchParams,
    listExternalChecks(await createLearnClient()),
  ]);
  return <ExternalChecksView checks={checks} showForm={asked === '1'} />;
}
