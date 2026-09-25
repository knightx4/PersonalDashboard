import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createNewsClient } from '@/lib/news/auth/server';
import { loadSenders } from '@/lib/news/issues/load';
import { formatArrival, issueHref } from '@/lib/news/issues/list';
import { loadQuickRead, loadQuickSignals } from '@/lib/news/issues/quick';
import { readTopic } from '@/lib/news/issues/topics';
import { loadHiddenTopics } from '@/lib/news/quick/hidden-topics';
import { loadSavedHeadlines } from '@/lib/news/saved/stories';
import {
  cardPasses,
  nextCard,
  quickHref,
  quickPage,
  quickTopics,
  type QuickCard,
} from '@/lib/news/quick/next';
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
 * Topics hidden with Fewer like this (#861) are left out of both the card and
 * the chips.
 *
 * The laptop page (#941) is worked out beside the card, from the same rows:
 * quickPage gives the stories Next would show one at a time, and the view
 * draws the card below md and the grid from md up, so the server never needs
 * the screen size. Next page records every story on it (#939).
 *
 * The story after the card is worked out too and drawn ahead, so Next on a
 * phone shows it at once while the pass is recorded (note 452a90d9).
 *
 * The order is ranked rather than newest first (lib/news/quick/rank.ts): an
 * event several newsletters ran shows once, naming the others, and goes up
 * the queue; so do lead stories and the topics and newsletters whose articles
 * you open. What it ranks with comes from loadQuickSignals.
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

  const [settings, senders, { issues, passes }, hidden] = await Promise.all([
    loadAccountSettings(user.id),
    loadSenders(client),
    loadQuickRead(client),
    loadHiddenTopics(client),
  ]);

  const signals = await loadQuickSignals(client, issues);
  const filter = { topic, hidden };

  const card = nextCard(issues, senders, passes, filter, signals);
  // The story Next brings up, worked out as though this card and its repeats
  // had been passed, so the phone can show it without waiting for the page
  // (note 452a90d9).
  const upNext = card
    ? nextCard(issues, senders, [...passes, ...cardPasses(card)], filter, signals)
    : null;
  const page = quickPage(issues, senders, passes, filter, undefined, signals);
  const wanted = params.pictures !== '0';
  const topics = quickTopics(issues, senders, passes, hidden, signals.groups);

  // The saved headlines of every newsletter on the page, read once each.
  const issueIds = [...new Set([card, upNext, ...page].flatMap((c) => (c ? [c.issueId] : [])))];
  const savedIn = new Map(
    await Promise.all(
      issueIds.map(async (id) => [id, await loadSavedHeadlines(client, id)] as const),
    ),
  );
  const isSaved = (c: QuickCard) =>
    c.kind === 'story' && Boolean(savedIn.get(c.issueId)?.has(c.story.headline));
  const saved = card ? isSaved(card) : false;

  return (
    <QuickReadView
      card={card}
      arrived={card ? formatArrival(card.receivedAt, settings.timezone) : null}
      nothingYet={issues.length === 0}
      hiddenCount={hidden.length}
      saved={saved}
      pictures={wanted}
      picturesHref={quickHref({ pictures: !wanted, topic })}
      issueHref={
        card ? issueHref(card.issueId, { original: false, pictures: wanted, from: null }) : null
      }
      page={page.map((c) => ({
        card: c,
        arrived: formatArrival(c.receivedAt, settings.timezone),
        saved: isSaved(c),
        issueHref: issueHref(c.issueId, { original: false, pictures: wanted, from: null }),
      }))}
      upNext={
        upNext && {
          card: upNext,
          arrived: formatArrival(upNext.receivedAt, settings.timezone),
          saved: isSaved(upNext),
          issueHref: issueHref(upNext.issueId, { original: false, pictures: wanted, from: null }),
        }
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
