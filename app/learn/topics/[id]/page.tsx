import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { toRef } from '@/lib/core/refs';
import { rowSubject } from '@/lib/core/subject';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadTopicDetail, nearestTopics } from '@/lib/learn/levels/store';
import { loadThread } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import { TopicView } from './topic-view';

export const dynamic = 'force-dynamic';

/**
 * One topic (plan #2138.2): a draft to read, reword and approve, or an
 * approved topic's levels. Somebody else's topic reads as no row at all, so
 * it is a 404.
 *
 * The match beside a draft is looked up on every visit rather than stored,
 * so a topic approved since the draft was written is found too.
 */
export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [learn, core, settings] = await Promise.all([createLearnClient(), createClient(), loadAccountSettings(user.id)]);

  const topic = await loadTopicDetail(learn, id);
  if (!topic) notFound();

  const [matches, comments, path] = await Promise.all([
    topic.status === 'draft'
      ? nearestTopics(learn, id).catch((error: unknown) => {
          console.error('[learn topic] match', error instanceof Error ? error.message : error);
          return [];
        })
      : Promise.resolve([]),
    loadThread(core, threadRef('topic', id), { userId: user.id }).catch(() => []),
    rowSubject(toRef('learn.topics', id)),
  ]);

  return (
    <TopicView
      topic={topic}
      match={matches[0] ?? null}
      comments={comments}
      path={path}
      timezone={settings.timezone}
      now={new Date().getTime()}
    />
  );
}
