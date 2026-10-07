import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { newsAddress, newsDomainOrNull } from '@/lib/news/address';
import { deliveryGap } from '@/lib/news/inbound/readiness';
import { loadRecommendations } from '@/lib/news/recommend/make';
import { loadOrCreateLocalPart } from '@/lib/news/settings/address';
import { loadIssues, loadSenders, loadUnreadStories } from '@/lib/news/issues/load';
import { readListView } from '@/lib/news/issues/list';
import { readTopic } from '@/lib/news/issues/topics';
import { NewsListView, ViewSwitch } from './list-view';
import { RecommendedNewsletters } from './recommended';

export const metadata = { title: 'Newsletters' };
export const dynamic = 'force-dynamic';
/**
 * Making the recommended list searches the web for about a minute, sometimes
 * two, and the action that does it runs under this page's limit.
 */
export const maxDuration = 300;

/**
 * What has arrived, newest first.
 *
 * The senders are a column of their own rather than a dropdown, because the
 * question this page is usually opened with is "has the one I read come out
 * yet", and that is answered by seeing the names. A muted sender is still
 * listed there -- muting takes its issues out of the list, not the newsletter
 * out of your life.
 *
 * The confirmation mail a publisher sends when you sign up arrives here like
 * anything else, which is how you reach the link in it.
 *
 * A topic chip (#860) narrows the list to newsletters with at least one story
 * on that topic, as `?topic=` beside the sender's `?from=`; each keeps the
 * other.
 *
 * Two views (note 20a58f93), as `?view=`: Latest is every issue newest first,
 * and By newsletter is one row per newsletter that opens onto its editions,
 * which is Latest narrowed to that sender. The third, Recommended, is the free
 * newsletters suggested for your topics (plan #947), in recommended.tsx.
 */
export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; topic?: string; view?: string }>;
}) {
  const { from, topic: topicParam, view: viewParam } = await searchParams;
  const topic = readTopic(topicParam) ?? null;
  const user = await requireUser();
  if (readListView(viewParam) === 'recommended') return <RecommendedPage userId={user.id} />;
  const client = await createNewsClient();

  const [settings, senders, issues, unread] = await Promise.all([
    loadAccountSettings(user.id),
    loadSenders(client),
    loadIssues(client, { topic }),
    loadUnreadStories(client),
  ]);

  return (
    <NewsListView
      timezone={settings.timezone}
      senders={senders}
      issues={issues}
      unread={unread}
      from={from}
      topic={topic}
      viewParam={viewParam}
      gap={deliveryGap()}
    />
  );
}

/**
 * The Recommended view. It reads the stored list and the address and nothing
 * else; the list is made by the view itself, from the browser, when there is
 * none (recommended.tsx).
 */
async function RecommendedPage({ userId }: { userId: string }) {
  const client = await createNewsClient();
  const [settings, stored, localPart] = await Promise.all([
    loadAccountSettings(userId),
    loadRecommendations(client, userId),
    loadOrCreateLocalPart(client, userId),
  ]);
  const domain = newsDomainOrNull();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Newsletters"
        description="What has been sent to the address that belongs to this app."
      />
      <ViewSwitch view="recommended" topic={null} />
      <RecommendedNewsletters
        stored={stored}
        address={domain ? newsAddress(localPart, domain) : null}
        timezone={settings.timezone}
      />
    </div>
  );
}
