import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadSenders } from '@/lib/news/issues/load';
import { formatArrival, issueHref } from '@/lib/news/issues/list';
import { loadQuickRead } from '@/lib/news/issues/quick';
import { readTopic } from '@/lib/news/issues/topics';
import { nextCard, quickHref, quickTopics } from '@/lib/news/quick/next';
import { topicHrefs } from '@/components/news/topic-chips';
import { QuickReadView } from './quick/quick-view';

export const metadata = { title: 'Quick read' };
export const dynamic = 'force-dynamic';

/**
 * One story at a time, from the newest newsletter down (#846), with one Next
 * button (#847).
 *
 * The card is worked out on every render by nextCard from what the database
 * holds, so there is no client state to keep in step: Next records the story
 * and the page is drawn again with the one after it.
 *
 * Pictures follow the issue page's `?pictures=0`, and the setting rides on
 * the address, so Next keeps it: the action re-renders the page at the address
 * it was pressed on. The topic chip (#860) rides on the address the same way,
 * as `?topic=`, and a value that is not a topic reads as every topic.
 */
export default async function QuickReadPage({
  searchParams,
}: {
  searchParams: Promise<{ pictures?: string; topic?: string }>;
}) {
  const params = await searchParams;
  const topic = readTopic(params.topic) ?? null;
  const user = await requireUser();
  const client = await createNewsClient();

  const [settings, senders, { issues, passes }] = await Promise.all([
    loadAccountSettings(user.id),
    loadSenders(client),
    loadQuickRead(client),
  ]);

  const card = nextCard(issues, senders, passes, { topic });
  const wanted = params.pictures !== '0';
  const topics = quickTopics(issues, senders, passes);

  return (
    <QuickReadView
      card={card}
      arrived={card ? formatArrival(card.receivedAt, settings.timezone) : null}
      nothingYet={issues.length === 0}
      pictures={wanted}
      picturesHref={quickHref({ pictures: !wanted, topic })}
      issueHref={
        card ? issueHref(card.issueId, { original: false, pictures: wanted, from: null }) : null
      }
      seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:news`}
      topics={{
        topics,
        selected: topic,
        hrefs: topicHrefs(topics, (t) => quickHref({ pictures: wanted, topic: t })),
        allHref: quickHref({ pictures: wanted, topic: null }),
      }}
    />
  );
}
