import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadIdeaPair } from '@/lib/learn/map/idea-pairs-load';
import { keepBothIdeasAction, mergeIdeasAction } from '../../actions';
import { IdeaPairView } from '../../pair-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Same idea twice' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One pair of ideas that may be one idea in two subjects (plan #2147.2). A
 * pair already merged or kept is not a pair any more, so it is not found;
 * a failed read throws to the area's error page.
 */
export default async function IdeaPairPage({ params }: { params: Promise<{ a: string; b: string }> }) {
  await requireUser();
  const { a, b } = await params;
  if (!UUID.test(a) || !UUID.test(b)) notFound();
  const pair = await loadIdeaPair(await createLearnClient(), a, b);
  if (!pair) notFound();
  return <IdeaPairView pair={pair} merge={mergeIdeasAction} keepBoth={keepBothIdeasAction} />;
}
