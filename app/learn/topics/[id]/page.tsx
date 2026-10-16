import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { toRef } from '@/lib/core/refs';
import { rowSubject } from '@/lib/core/subject';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadEvidenceForTargets } from '@/lib/learn/evidence/links';
import type { EvidenceLink } from '@/lib/learn/evidence/model';
import type { TopicDetail } from '@/lib/learn/levels/store';
import { topicStanding } from '@/lib/learn/levels/standing';
import { loadTopicDetail, loadTopicMap, nearestTopics } from '@/lib/learn/levels/store';
import { loadLinksIn, loadTopicEvidence } from '@/lib/learn/levels/store-page';
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

  const [matches, comments, path, standing, backing] = await Promise.all([
    topic.status === 'draft'
      ? nearestTopics(learn, id).catch((error: unknown) => {
          console.error('[learn topic] match', error instanceof Error ? error.message : error);
          return [];
        })
      : Promise.resolve([]),
    loadThread(core, threadRef('topic', id), { userId: user.id }).catch(() => []),
    rowSubject(toRef('learn.topics', id)),
    topic.status === 'approved' ? readStanding(learn, topic) : Promise.resolve(null),
    topic.status === 'approved'
      ? readBacking(learn, id).catch((error: unknown) => {
          console.error('[learn topic] backing', error instanceof Error ? error.message : error);
          return [];
        })
      : Promise.resolve([]),
  ]);

  return (
    <TopicView
      topic={topic}
      match={matches[0] ?? null}
      comments={comments}
      path={path}
      timezone={settings.timezone}
      now={new Date().getTime()}
      standing={standing}
      backing={backing}
    />
  );
}

async function readStanding(learn: Awaited<ReturnType<typeof createLearnClient>>, topic: TopicDetail) {
  const [map, evidence, linksIn] = await Promise.all([
    loadTopicMap(learn),
    loadTopicEvidence(
      learn,
      topic.cells.map((c) => c.id),
    ),
    loadLinksIn(learn, topic.cells),
  ]);
  return topicStanding(topic, map, evidence, linksIn);
}

/**
 * The evidence on the frame topic this one refines (plan #2172.2), each link
 * with its kind and ceiling. Mentions count for nothing, so they are left out.
 */
async function readBacking(learn: Awaited<ReturnType<typeof createLearnClient>>, id: string): Promise<EvidenceLink[]> {
  const { data, error } = await learn.from('topics').select('refines_article_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`Reading the topic's frame failed: ${error.message}`);
  const frame = (data as { refines_article_id: string | null } | null)?.refines_article_id;
  if (!frame) return [];
  const links = await loadEvidenceForTargets(learn, 'topic', [frame]);
  return (links.get(frame) ?? []).filter((link) => link.kind !== 'mention');
}
