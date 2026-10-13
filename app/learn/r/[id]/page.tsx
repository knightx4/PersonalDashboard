import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadOtherReadingsOfSource, loadReading } from '@/lib/learn/tracks/load';
import { loadReadingOrigins } from '@/lib/learn/tracks/news-origin';
import { loadSubjects } from '@/lib/learn/graph/load';
import { READING_TABS, type ReadingTab } from '@/lib/learn/tracks/reading-tabs';
import { tabFrom } from '@/lib/tabs';
import { createCoreClient } from '@/lib/core/auth/server';
import { threadRef } from '@/lib/thread/subjects';
import { loadThread } from '@/lib/thread/store';
import { ReadingView } from './reading-view';

export const dynamic = 'force-dynamic';

export default async function ReadingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const tab = tabFrom((await searchParams).tab, READING_TABS) as ReadingTab;

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, id);
  // For the note-to-graph offer below. A subject is the container that
  // accumulates and nothing creates one silently, so this is a list to pick
  // from rather than a name to invent.
  const subjects = await loadSubjects(supabase);
  if (!reading) notFound();

  // Only meaningful when there is a source to have read somewhere else.
  const elsewhere = reading.source
    ? await loadOtherReadingsOfSource(supabase, reading.source.id, reading.id)
    : [];
  const alreadyRead = elsewhere.find((row) => row.status === 'read') ?? null;

  // A story sent from News says which newsletter it was in, and opens it
  // there: the story's text is kept in News, not copied here (plan #1368).
  const origin = reading.newsStoryId
    ? ((await loadReadingOrigins([reading.newsStoryId])).get(reading.newsStoryId) ?? null)
    : null;

  // The chat with Dash on the Summary tab (plan #1876.5), read only for that tab.
  const thread =
    tab === 'summary'
      ? await loadThread(await createCoreClient(), threadRef('reading', reading.id))
      : [];

  return (
    <ReadingView
      reading={reading}
      subjects={subjects}
      alreadyRead={alreadyRead}
      origin={origin}
      tab={tab}
      thread={thread}
    />
  );
}
