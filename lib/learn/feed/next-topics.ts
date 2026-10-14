import { besideLine, type NextTopic } from '@/lib/learn/map/next-topics';
import type { NameResult, NamedSection } from './name-material';

/**
 * Learn now cards on the topics next to ones you know (plan #2016.6).
 *
 * An open goal has a track, and its lessons are its share of the feed (plan
 * #972), so it is not drawn for section cards of its own. The exception is
 * a goal with topics ranked closest to it beside something you know
 * (`lib/learn/map/next-topics.ts`): it joins the goal draw marked
 * `list: 'next'`, and when drawn its cards are those topics, best first,
 * each from its article's lead, with no naming call. Each pick carries the
 * lit topic it sits beside, which the card's why line names.
 *
 * Its share of the one card in three is counted from the first card drawn
 * this way (`nextTopicsSince`), so the first draw does not try to catch up on
 * months of cards with nothing but these.
 */

/** Topics turned into cards each time a goal is drawn for them. */
export const NEXT_TOPIC_PICKS_PER_DRAW = 2;

/** What `feed_cards.pick_model` says for a pick taken from the next topics, not named by a model. */
export const NEXT_TOPIC_PICKER = 'next-topics';

/** The picks for one draw: the best topics not already had or picked in this pass. */
export function nextTopicPicks(
  topics: readonly NextTopic[],
  avoid: readonly string[],
  count: number = NEXT_TOPIC_PICKS_PER_DRAW,
): NamedSection[] {
  const seen = new Set(avoid.map((title) => title.toLowerCase()));
  const picks: NamedSection[] = [];
  for (const topic of topics) {
    if (picks.length >= count) break;
    const key = topic.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({
      article: topic.title,
      section: null,
      basis: `A Level 4 topic. ${besideLine(topic.beside.title)}`,
      beside: topic.beside.title,
    });
  }
  return picks;
}

/** The draw's answer for a goal drawn for its next topics. */
export function drawNextTopics(topics: readonly NextTopic[], avoid: readonly string[]): NameResult {
  const named = nextTopicPicks(topics, avoid);
  return named.length > 0
    ? { ok: true, named }
    : { ok: false, detail: 'every topic next to what you know is already on a card' };
}
