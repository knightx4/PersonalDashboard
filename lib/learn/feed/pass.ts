import type { WikipediaArticle, WikipediaResult, WikipediaSection } from '@/lib/learn/providers/wikipedia';
import { contextFor, NO_PROGRESS, type Depth, type DepthContext, type DepthProgress } from './depth';
import { LEVEL3_LIST_PICKER } from './level3';
import type { NameResult, NamedSection } from './name-material';
import { createDrawer, wantsGap, wantsGoal, type DrawInput, type FeedGoal, type FeedTarget } from './targets';

/**
 * The picking pass behind Learn now (LEARN-NOW-SPEC, "How cards are made",
 * steps 1 to 3; plan #806).
 *
 * For one person: draw a target, have the model name two or three Wikipedia
 * sections for it, fetch each article, store it in the catalogue, and write a
 * `picked` row to `learn.feed_cards` pointing at the section. Plan #807 turns
 * the picked rows into cards.
 *
 * Everything outside is a port, so the pass is tested without a database, a
 * model or the web; `inngest/learn/feed-picks.ts` supplies the real ones.
 * A title Wikipedia does not have is dropped, which is the check the spec
 * asks for before anything is stored. A named section the fetched article
 * does not have is dropped too. It used to fall back to the article's lead,
 * and the lead of a broad article is the definition the owner already knows
 * (LEARN-NOW-SPEC, "Cards after the first week").
 *
 * Each target is named at a depth worked out from the person's swipes on it
 * (`depth.ts`), and the pick carries that depth so the card writer knows it.
 * A goal's target is named at the depth set on the goal (plan #900).
 *
 * The Level 3 goal skips the naming call (plan #910): its picks come from its
 * list through `drawFromList`, one card per article, and are written as goal
 * cards under its aim like any other goal's, so they share the one card in
 * three and their swipes set its depth.
 */

/** Targets drawn per person per call. At two or three picks each, about ten picks. */
export const TARGETS_PER_CALL = 4;

export type PersonInputs = Omit<DrawInput, 'random'> & {
  /** Cards already picked for this person, by reason. */
  picked: PickedCounts;
  /**
   * Cards picked since the oldest goal still active was set: how many for a
   * goal, and how many in all. What the one-in-three share is kept against.
   * None when left out, which with no goals draws none.
   */
  goalWindow?: { goal: number; total: number };
  /** Articles this person already has cards from, most recent first. */
  articlesHeld: string[];
  /** What they swiped known and review, per theme and field. None when left out. */
  progress?: DepthProgress;
};

export type PickedCounts = { interest: number; gap: number; goal: number };

export type FeedCardInsert = {
  user_id: string;
  reason: FeedTarget['reason'];
  theme_id: string | null;
  theme_name: string | null;
  /** The goal a goal card is for, by id and by name. Null otherwise. */
  aim_id: string | null;
  aim_name: string | null;
  /** Null only for a goal that is not placed in a field. */
  field_id: string | null;
  item_id: string;
  segment_id: string;
  named_article: string;
  named_section: string | null;
  pick_basis: string;
  pick_model: string;
  depth: Depth;
};

export type FeedPickPorts = {
  loadPerson(userId: string): Promise<PersonInputs>;
  name(target: FeedTarget, avoid: string[], depth: DepthContext): Promise<NameResult>;
  /**
   * Picks for a goal with a list (the Level 3 goal), in place of `name`:
   * articles from the list, none of them in `avoid`, each read from its lead.
   */
  drawFromList(goal: FeedGoal & { list: 'level3' }, avoid: string[]): Promise<NameResult>;
  fetchArticle(title: string): Promise<WikipediaResult>;
  storeArticle(article: WikipediaArticle): Promise<{ itemId: string; segments: { id: string; ordinal: number }[] }>;
  /** Insert one row; 'duplicate' when this person already has the section. */
  insertCard(row: FeedCardInsert): Promise<'inserted' | 'duplicate'>;
  /** Milliseconds; the pass stops drawing once this passes the deadline. */
  now(): number;
  random?: () => number;
};

export type FeedPickSummary = {
  userId: string;
  targets: { reason: FeedTarget['reason']; name: string }[];
  picked: PickedCounts;
  /** Titles the model named that Wikipedia does not have. */
  notFound: string[];
  /** Named sections that were not in the article, so the pick was dropped. */
  sectionMissing: number;
  duplicates: number;
  failed: string[];
};

function normalHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The stored section a named heading refers to.
 *
 * Exact after normalising case, underscores and punctuation first, then a
 * heading that contains the name or is contained by it, then the lead. Null
 * asks for the lead outright. `matched` says whether the name was found.
 */
export function matchSection(
  sections: WikipediaSection[],
  wanted: string | null,
): { section: WikipediaSection; matched: boolean } | null {
  const lead = sections[0];
  if (!lead) return null;
  if (!wanted) return { section: lead, matched: true };

  const name = normalHeading(wanted);
  const headed = sections.filter((section) => section.heading);
  const exact = headed.find((section) => normalHeading(section.heading!) === name);
  if (exact) return { section: exact, matched: true };
  const near = headed.find((section) => {
    const heading = normalHeading(section.heading!);
    return name.length > 3 && heading.length > 3 && (heading.includes(name) || name.includes(heading));
  });
  if (near) return { section: near, matched: true };
  return { section: lead, matched: false };
}

function targetName(target: FeedTarget): string {
  switch (target.reason) {
    case 'interest':
      return target.theme.name;
    case 'goal':
      return target.goal.name;
    case 'gap':
      return target.field.name;
  }
}

/** The field a pick is filed under: the theme's, the gap's, or the goal's when it is placed in one. */
function targetFieldId(target: FeedTarget): string | null {
  return target.reason === 'goal' ? (target.goal.field?.id ?? null) : target.field.id;
}

function depthTarget(target: FeedTarget): Parameters<typeof contextFor>[1] {
  switch (target.reason) {
    case 'interest':
      return { reason: 'interest', themeId: target.theme.id };
    case 'goal':
      return { reason: 'goal', aimId: target.goal.id, start: target.goal.depth };
    case 'gap':
      return { reason: 'gap', fieldId: target.field.id };
  }
}

async function pickOne(
  ports: FeedPickPorts,
  userId: string,
  target: FeedTarget,
  named: NamedSection,
  model: string,
  depth: Depth,
  summary: FeedPickSummary,
): Promise<boolean> {
  const article = await ports.fetchArticle(named.article);
  if (!article.ok) {
    if (article.reason === 'not-found' || article.reason === 'unreadable') summary.notFound.push(named.article);
    else summary.failed.push(`${named.article}: ${article.detail}`);
    return false;
  }

  const match = matchSection(article.sections, named.section);
  if (!match) {
    summary.notFound.push(named.article);
    return false;
  }
  if (!match.matched) {
    summary.sectionMissing += 1;
    return false;
  }

  const stored = await ports.storeArticle(article);
  const segment = stored.segments.find((row) => row.ordinal === match.section.ordinal);
  if (!segment) {
    summary.failed.push(`${article.title}: the stored article has no section ${match.section.ordinal}`);
    return false;
  }

  const outcome = await ports.insertCard({
    user_id: userId,
    reason: target.reason,
    theme_id: target.reason === 'interest' ? target.theme.id : null,
    theme_name: target.reason === 'interest' ? target.theme.name : null,
    aim_id: target.reason === 'goal' ? target.goal.id : null,
    aim_name: target.reason === 'goal' ? target.goal.name : null,
    field_id: targetFieldId(target),
    item_id: stored.itemId,
    segment_id: segment.id,
    named_article: named.article,
    named_section: named.section,
    pick_basis: named.basis,
    pick_model: model,
    depth,
  });
  if (outcome === 'duplicate') {
    summary.duplicates += 1;
    return false;
  }
  return true;
}

export async function runFeedPicksFor(
  ports: FeedPickPorts,
  options: { userId: string; targets?: number; deadline: number; model: string },
): Promise<FeedPickSummary> {
  const { userId } = options;
  const person = await ports.loadPerson(userId);
  const drawer = createDrawer({ ...person, random: ports.random });
  const counts = { ...person.picked };
  const window = { ...(person.goalWindow ?? { goal: 0, total: 0 }) };
  const avoid = [...person.articlesHeld];
  const summary: FeedPickSummary = {
    userId,
    targets: [],
    picked: { interest: 0, gap: 0, goal: 0 },
    notFound: [],
    sectionMissing: 0,
    duplicates: 0,
    failed: [],
  };

  const wanted = options.targets ?? TARGETS_PER_CALL;
  while (summary.targets.length < wanted && ports.now() < options.deadline) {
    const target = drawer.next(wantsGap(counts), wantsGoal(window));
    if (!target) break;
    summary.targets.push({ reason: target.reason, name: targetName(target) });

    const depth = contextFor(person.progress ?? NO_PROGRESS, depthTarget(target));
    const listGoal = target.reason === 'goal' && target.goal.list ? { ...target.goal, list: target.goal.list } : null;
    const named = listGoal ? await ports.drawFromList(listGoal, avoid) : await ports.name(target, avoid, depth);
    const model = listGoal ? LEVEL3_LIST_PICKER : options.model;
    if (!named.ok) {
      summary.failed.push(`${targetName(target)}: ${named.detail}`);
      continue;
    }

    for (const pick of named.named) {
      avoid.unshift(pick.article);
      try {
        if (await pickOne(ports, userId, target, pick, model, depth.depth, summary)) {
          counts[target.reason] += 1;
          summary.picked[target.reason] += 1;
          window.total += 1;
          if (target.reason === 'goal') window.goal += 1;
        }
      } catch (error) {
        summary.failed.push(`${pick.article}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
  }

  return summary;
}
