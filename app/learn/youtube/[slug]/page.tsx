import { notFound } from 'next/navigation';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadChannelPage } from '@/lib/learn/youtube/load';
import { ChannelView } from './channel-view';

export const dynamic = 'force-dynamic';
// Re-listing walks every playlist; transcribing a video can take a minute.
export const maxDuration = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `YouTube · ${slug}` };
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { slug } = await params;
  const { q, page: pageParam } = await searchParams;
  const search = q?.trim() ?? '';
  const page = Math.max(0, Number.parseInt(pageParam ?? '0', 10) || 0);

  const learn = await createLearnClient();
  const data = await loadChannelPage(learn, slug, { page, search });
  if (!data) notFound();
  return <ChannelView slug={slug} data={data} page={page} search={search} />;
}
