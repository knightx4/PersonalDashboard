import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadSource } from '@/lib/learn/reader/store';
import { SourceView } from './source-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const source = await loadSource(await createLearnClient(), user.id, id);
  return { title: source?.title ?? 'Read' };
}

/** One source in layers; source-view.tsx says how it is drawn. */
export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const source = await loadSource(await createLearnClient(), user.id, id);
  if (!source || source.origin === 'refill') notFound();
  return <SourceView source={source} />;
}
