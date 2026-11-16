import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadSource } from '@/lib/learn/reader/store';
import { SectionView } from './section-view';

export const dynamic = 'force-dynamic';

/** One section of a source; section-view.tsx says how it is drawn. */
export default async function SectionPage({
  params,
}: {
  params: Promise<{ id: string; n: string }>;
}) {
  const { id, n } = await params;
  const user = await requireUser();
  const source = await loadSource(await createLearnClient(), user.id, id);
  const at = Number(n);
  const section = Number.isInteger(at) ? source?.prepared?.sections[at - 1] : undefined;
  if (!source?.prepared || !section) notFound();
  return (
    <SectionView source={source} section={section} n={at} total={source.prepared.sections.length} />
  );
}
