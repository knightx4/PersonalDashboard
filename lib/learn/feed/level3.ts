import type { NamedSection } from './name-material';

/**
 * Learn now cards for the Level 3 goal (plan #910, under #895).
 *
 * The Level 3 goal is drawn like any other goal, in the one card in three kept
 * for goals, but its cards do not come from the naming call. The pass asks the
 * list for articles instead (`FeedPickPorts.drawFromList`), and the real port
 * reads them from `learn.level3_untouched_articles`: Level 3 articles with no
 * evidence in `learn.article_evidence` and no card of the person's already,
 * in random order. Each becomes one card from the article's lead, since the
 * person has shown no sign of knowing the article at all.
 *
 * Decision #907 puts untouched articles first and brings claimed but untested
 * ones back later (#912). Both come through `drawFromList` as the same
 * `NamedSection` picks, so the returns join this draw rather than being a
 * draw of their own.
 */

/** Articles drawn from the list each time the Level 3 goal is drawn. */
export const LEVEL3_PICKS_PER_DRAW = 2;

/** What `feed_cards.pick_model` says for a pick taken from the list, not named by a model. */
export const LEVEL3_LIST_PICKER = 'level3-list';

/** One Level 3 article as `learn.level3_untouched_articles` returns it. */
export type Level3Article = { title: string; section: string };

/**
 * The picks for a set of untouched articles: each article's lead, with a basis
 * saying where it sits on the list. Titles already picked in this pass are
 * dropped, and so is a second spelling of the same title.
 */
export function untouchedPicks(
  articles: Level3Article[],
  avoid: readonly string[],
  count: number = LEVEL3_PICKS_PER_DRAW,
): NamedSection[] {
  const seen = new Set(avoid.map((title) => title.toLowerCase()));
  const picks: NamedSection[] = [];
  for (const article of articles) {
    if (picks.length >= count) break;
    const key = article.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({
      article: article.title,
      section: null,
      basis: `A Level 3 vital article, under ${article.section}, with no sign yet that you know it.`,
    });
  }
  return picks;
}
