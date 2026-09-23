import type { WikipediaArticle, WikipediaResult, WikipediaSection } from '@/lib/learn/providers/wikipedia';
import { contextFor, NO_PROGRESS, type Depth, type DepthContext, type DepthProgress } from './depth';
import type { NameResult, NamedSection } from './name-material';
import { createDrawer, wantsGap, type DrawInput, type FeedTarget } from './targets';

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
 */

/** Targets drawn per person per call. At two or three picks each, about ten picks. */
export const TARGETS_PER_CALL = 4;

export type PersonInputs = Omit<DrawInput, 'random'> & {
  /** Cards already picked for this person, by reason. */
  picked: { interest: number; gap: number };
  /** Articles this person already has cards from, most recent first. */
  articlesHeld: string[];
  /** What they swiped known and review, per theme and field. None when left out. */
  progress?: DepthProgress;
};

export type FeedCardInsert = {
  user_id: string;
  reason: 'interest' | 'gap';
  theme_id: string | null;
  theme_name: string | null;
  field_id: string;
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
  targets: { reason: 'interest' | 'gap'; name: string }[];
  picked: { interest: number; gap: number };
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
  return target.reason === 'interest' ? target.theme.name : target.field.name;
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
    field_id: target.field.id,
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
  const avoid = [...person.articlesHeld];
  const summary: FeedPickSummary = {
    userId,
    targets: [],
    picked: { interest: 0, gap: 0 },
    notFound: [],
    sectionMissing: 0,
    duplicates: 0,
    failed: [],
  };

  const wanted = options.targets ?? TARGETS_PER_CALL;
  while (summary.targets.length < wanted && ports.now() < options.deadline) {
    const target = drawer.next(wantsGap(counts));
    if (!target) break;
    summary.targets.push({ reason: target.reason, name: targetName(target) });

    const depth = contextFor(
      person.progress ?? NO_PROGRESS,
      target.reason === 'interest'
        ? { reason: 'interest', themeId: target.theme.id }
        : { reason: 'gap', fieldId: target.field.id },
    );
    const named = await ports.name(target, avoid, depth);
    if (!named.ok) {
      summary.failed.push(`${targetName(target)}: ${named.detail}`);
      continue;
    }

    for (const pick of named.named) {
      avoid.unshift(pick.article);
      try {
        if (await pickOne(ports, userId, target, pick, options.model, depth.depth, summary)) {
          counts[target.reason] += 1;
          summary.picked[target.reason] += 1;
        }
      } catch (error) {
        summary.failed.push(`${pick.article}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
  }

  return summary;
}
