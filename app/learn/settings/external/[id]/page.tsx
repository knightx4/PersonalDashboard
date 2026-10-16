import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { nextItemIndex } from '@/lib/learn/external/model';
import { loadExternalCheck } from '@/lib/learn/external/store';
import { ExternalItemView, ExternalScoreView } from '../sit-view';

export const dynamic = 'force-dynamic';

/**
 * One external set. While items are left it serves the next one and nothing
 * else, so a reload puts the person back on the same question; after the last
 * it shows the score (plan #2179.4).
 */
export default async function ExternalCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await loadExternalCheck(await createLearnClient(), id);
  if (!check) notFound();

  const index = nextItemIndex(check.items);
  if (index === null) return <ExternalScoreView check={check} />;
  return <ExternalItemView check={check} index={index} />;
}
