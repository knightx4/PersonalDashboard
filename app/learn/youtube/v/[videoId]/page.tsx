import { notFound } from 'next/navigation';
import { readTranscript } from '@/inngest/learn/youtube-library';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadVideoPage } from '@/lib/learn/youtube/load';
import { paragraphsFromCues } from '@/lib/learn/youtube/paragraphs';
import { LibraryVideoView } from './library-video-view';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const metadata = { title: 'YouTube video' };

/** One video in the library; library-video-view.tsx draws it. */
export default async function VideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string; end?: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { videoId } = await params;
  const { t, end } = await searchParams;
  const start = Math.max(0, Number.parseInt(t ?? '0', 10) || 0);
  const stop = end ? Number.parseInt(end, 10) || null : null;

  const learn = await createLearnClient();
  const data = await loadVideoPage(learn, videoId);
  if (!data) notFound();
  const transcript = data.video.state === 'fetched' ? await readTranscript(data.video.videoId) : null;
  const paragraphs = transcript ? paragraphsFromCues(transcript.cues) : [];

  return (
    <LibraryVideoView
      data={data}
      language={transcript?.language ?? null}
      paragraphs={paragraphs}
      start={start}
      stop={stop}
    />
  );
}
