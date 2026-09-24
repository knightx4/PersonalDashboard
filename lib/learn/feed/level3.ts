import type { WikipediaSection } from '@/lib/learn/providers/wikipedia';
import { cardTitle } from './card';
import type { DepthContext } from './depth';
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
 * draw of their own. A return is read from `learn.level3_claimed_articles`,
 * kept when it is due under LEVEL3_RETURN_GAP_DAYS (decision #911), and
 * named by a model call told the earlier cards' titles, which picks a section
 * of the same article that no earlier card was cut from. It stays the same
 * article so the card's Test me track is filed under it and a right answer
 * counts as tested.
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

/**
 * How long a claimed article waits before it comes back (decision #911).
 *
 * The first gap is measured from the Got it or save, and each later one from
 * the last card on the article: about a week, then a month, then three
 * months. The last gap repeats until a right answer on the article's Test me
 * track moves it to tested, which takes it out of the returns for good. This
 * is the one place to change the timing.
 */
export const LEVEL3_RETURN_GAP_DAYS: readonly number[] = [7, 30, 90];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One claimed, untested Level 3 article as `learn.level3_claimed_articles`
 * returns it.
 */
export type Level3Claimed = {
  title: string;
  section: string;
  /** The first Got it or save on it. */
  claimedAt: string;
  /** The latest evidence or card on it, whichever came last. */
  lastSeenAt: string;
  /** Cards on it made after the first claim: how many times it has come back. */
  returns: number;
  /** The section heading of every card on it, oldest first; null is the lead. */
  earlier: (string | null)[];
};

/** The gap in days before the next return, after `returns` earlier ones. */
export function returnGapDays(returns: number, gaps: readonly number[] = LEVEL3_RETURN_GAP_DAYS): number {
  if (gaps.length === 0) return 0;
  return gaps[Math.min(Math.max(returns, 0), gaps.length - 1)]!;
}

/** When a claimed article is next due back, in milliseconds. */
export function dueAt(claimed: Level3Claimed, gaps: readonly number[] = LEVEL3_RETURN_GAP_DAYS): number {
  return Date.parse(claimed.lastSeenAt) + returnGapDays(claimed.returns, gaps) * DAY_MS;
}

/** Whether a claimed article is due back at `now`. */
export function isDue(claimed: Level3Claimed, now: number, gaps: readonly number[] = LEVEL3_RETURN_GAP_DAYS): boolean {
  return dueAt(claimed, gaps) <= now;
}

/** The claimed articles due back at `now`, longest overdue first. */
export function dueReturns(
  claimed: readonly Level3Claimed[],
  now: number,
  gaps: readonly number[] = LEVEL3_RETURN_GAP_DAYS,
): Level3Claimed[] {
  return claimed
    .filter((article) => isDue(article, now, gaps))
    .sort((a, b) => dueAt(a, gaps) - dueAt(b, gaps));
}

/** The titles of the cards the person already had on a claimed article. */
export function earlierTitles(claimed: Level3Claimed): string[] {
  return [...new Set(claimed.earlier.map((heading) => cardTitle(claimed.title, heading)))];
}

/** One slot in a Level 3 draw: an untouched article's lead, or a return still to be named. */
export type Level3Pick = { kind: 'untouched'; named: NamedSection } | { kind: 'return'; article: Level3Claimed };

/**
 * The draw's picks, untouched articles and due returns taken in turn.
 *
 * #907 and #911 mix the two whenever a return is due, rather than holding
 * returns back until the untouched articles run out. `avoid` is the titles
 * already picked in this pass; untouched articles are expected to have left
 * out the articles already on a card, and returns must not.
 */
export function level3Picks(input: {
  untouched: readonly NamedSection[];
  due: readonly Level3Claimed[];
  avoid: readonly string[];
  count?: number;
}): Level3Pick[] {
  const count = input.count ?? LEVEL3_PICKS_PER_DRAW;
  const seen = new Set(input.avoid.map((title) => title.toLowerCase()));
  const untouched = input.untouched.filter((pick) => !seen.has(pick.article.toLowerCase()));
  const due = input.due.filter((article) => !seen.has(article.title.toLowerCase()));
  const picks: Level3Pick[] = [];
  let u = 0;
  let d = 0;
  while (picks.length < count && (u < untouched.length || d < due.length)) {
    const takeUntouched = u < untouched.length && (picks.length % 2 === 0 || d >= due.length);
    if (takeUntouched) {
      const pick = untouched[u++]!;
      if (seen.has(pick.article.toLowerCase())) continue;
      seen.add(pick.article.toLowerCase());
      picks.push({ kind: 'untouched', named: pick });
    } else {
      const article = due[d++]!;
      if (seen.has(article.title.toLowerCase())) continue;
      seen.add(article.title.toLowerCase());
      picks.push({ kind: 'return', article });
    }
  }
  return picks;
}

function normalHeading(heading: string): string {
  return heading.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The sections of a returning article that no earlier card was cut from.
 * The lead counts as taken once any card was from the lead.
 */
export function freshSections(sections: readonly WikipediaSection[], earlier: readonly (string | null)[]): WikipediaSection[] {
  const leadTaken = earlier.some((heading) => heading === null);
  const taken = new Set(earlier.flatMap((heading) => (heading ? [normalHeading(heading)] : [])));
  return sections.filter((section) =>
    section.heading ? !taken.has(normalHeading(section.heading)) : !leadTaken,
  );
}

/** What the naming call for a returning article is given. */
export type ReturnAngleRequest = {
  article: string;
  /** Where it sits on the Level 3 list. */
  listSection: string;
  /** Titles of the cards already had on it, which the new one must differ from. */
  earlier: string[];
  /** Headings it may choose from; null is the lead. None of them is an earlier card's. */
  sections: (string | null)[];
  /** How many times it has come back before this one. */
  returns: number;
  depth: DepthContext;
};

export type ReturnAngleResult =
  | { ok: true; section: string | null; basis: string; model: string }
  | { ok: false; detail: string };

/**
 * Turn the draw's picks into named sections. An untouched pick is its lead as
 * it stands. A return fetches the article, keeps the sections no earlier card
 * was cut from, and asks `nameAngle` for one of them; a reply naming anything
 * else is dropped, so a returning card's title is never one already had.
 */
export async function resolveLevel3Picks(
  picks: readonly Level3Pick[],
  deps: {
    sections(title: string): Promise<WikipediaSection[] | null>;
    nameAngle(request: ReturnAngleRequest): Promise<ReturnAngleResult>;
    depth: DepthContext;
  },
): Promise<{ named: NamedSection[]; failed: string[] }> {
  const named: NamedSection[] = [];
  const failed: string[] = [];
  for (const pick of picks) {
    if (pick.kind === 'untouched') {
      named.push(pick.named);
      continue;
    }
    const { article } = pick;
    const sections = await deps.sections(article.title);
    if (!sections) {
      failed.push(`${article.title}: could not read the article to bring it back`);
      continue;
    }
    const fresh = freshSections(sections, article.earlier);
    if (fresh.length === 0) {
      failed.push(`${article.title}: no section left that an earlier card was not cut from`);
      continue;
    }
    const earlier = earlierTitles(article);
    const reply = await deps.nameAngle({
      article: article.title,
      listSection: article.section,
      earlier,
      sections: fresh.map((section) => section.heading),
      returns: article.returns,
      depth: deps.depth,
    });
    if (!reply.ok) {
      failed.push(`${article.title}: ${reply.detail}`);
      continue;
    }
    const chosen = fresh.find((section) =>
      reply.section === null
        ? section.heading === null
        : section.heading !== null && normalHeading(section.heading) === normalHeading(reply.section),
    );
    if (!chosen || earlier.includes(cardTitle(article.title, chosen.heading))) {
      failed.push(`${article.title}: the naming call chose a section it was not offered`);
      continue;
    }
    named.push({
      article: article.title,
      section: chosen.heading,
      basis: reply.basis,
      model: reply.model,
      returning: { earlier },
    });
  }
  return { named, failed };
}
