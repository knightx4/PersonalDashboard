import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { listTopics } from '@/lib/learn/levels/store';
import { THREAD_TABLES } from '@/lib/thread/subjects';
import { loadTableThreads } from '@/lib/thread/store';
import { TopicsView } from './topics-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Topics' };

/**
 * Learn's topics (plan #2138.2): name a goal to draft one, and the topics
 * you have, drafts first. The comment counts come from the one thread store,
 * so a draft somebody has written on shows it on its row.
 */
export default async function TopicsPage() {
  const user = await requireUser();
  const [learn, core, settings] = await Promise.all([createLearnClient(), createClient(), loadAccountSettings(user.id)]);
  const [topics, threads] = await Promise.all([
    listTopics(learn),
    loadTableThreads(core, THREAD_TABLES.topic, { userId: user.id }).catch((error: unknown) => {
      console.error('[learn topics] comments', error instanceof Error ? error.message : error);
      return new Map();
    }),
  ]);

  const comments = new Map<string, number>();
  for (const [ref, turns] of threads) comments.set(ref.slice(ref.indexOf(':') + 1), turns.length);

  return <TopicsView topics={topics} comments={comments} timezone={settings.timezone} now={new Date().getTime()} />;
}
