import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { clipLabel } from '@/lib/learn/catalogue/queue';
import type { Rung } from '@/lib/learn/graph/probe-payload';
import type { LocatorConfidence } from '@/lib/learn/tracks/load';

/**
 * What the catalogue holds for one claim, in the order worth taking.
 *
 * The read side of `catalogue_links`. The judging pass reports only what that
 * pass wrote, which is never the whole list: a claim judged twice has links
 * from both runs, and a claim queued from keeps the links it was queued from.
 * So a page that wants to show the material reads the table.
 *
 * Ordering is the lookup docs/LEARN-SOURCES-SPEC.md argues for in place of a
 * ranker. No learned weight and no score: a shape that suits the rung, then a
 * match something read over a match nothing read, then the shorter
 * commitment. All three come off columns that are already there, which is what
 * makes it work on the first day the catalogue exists.
 *
 * A claim with nothing gets a reason rather than an empty list, because
 * "nobody has looked", "nothing here covers this claim" and "nothing has been
 * pulled in" are three different problems, only one of them is about the
 * claim, and what would change each of them is different.
 */

/** Where a segment sits in its work, which is what decides how it reads. */
export type MaterialShape =
  /** A section of an article, addressed by its anchor. */
  | 'section'
  /** A span of a lecture, addressed by its offsets. */
  | 'clip'
  /** One segment standing for a whole work, which is what a video with no
   *  transcript gets. */
  | 'whole';

/** One piece of material linked to a claim, as a page shows it. */
export type ClaimMaterial = {
  segmentId: string;
  /** Position within the work. Part of the tiebreak, so a list never shuffles. */
  ordinal: number;
  /** The sentence saying what this gives you about the claim. */
  basis: string;
  /** `verified` is a match a model read the segment and argued for. */
  confidence: LocatorConfidence;
  /** What judged it, where anything did. */
  model: string | null;
  shape: MaterialShape;
  /** Which part of the work: a section heading, or a clip as `12:04–18:30`. */
  where: string | null;
  /** How much text the segment holds. The length term, for anything untimed. */
  lengthChars: number;
  tStartSeconds: number | null;
  tEndSeconds: number | null;
  item: {
    id: string;
    title: string;
    author: string | null;
    kind: string;
    canonicalUrl: string;
    durationSeconds: number | null;
  };
};

/**
 * Why a claim has nothing, which is three problems with three different fixes.
 *
 * The search runs when you press the button on the claim (#742), so a claim
 * with no links may never have been looked for at all. The search time on the
 * concept is what tells those apart, and it is why `nothing-matched` may now
 * say somebody went looking: it is only reached when somebody did.
 */
export type MaterialAbsence =
  /** Nobody has pressed the button on this claim, so nothing has looked. */
  | 'never-searched'
  /** The catalogue was searched for this claim and nothing in it matched. */
  | 'nothing-matched'
  /** There is nothing to search: nothing pulled in, or nothing embedded yet. */
  | 'catalogue-empty';

export type ClaimMaterialView = {
  /** Best first. Empty exactly when `absence` is set. */
  material: ClaimMaterial[];
  absence: MaterialAbsence | null;
};

/**
 * Which shape suits which rung, best first.
 *
 * The spec's largest ordering term, and a lookup rather than a score. At
 * `recognise` you want the idea stated and laid out, which is what a section
 * of an article is. At `apply` you want somebody working an example, which is
 * what a lecture does and an encyclopaedia does not. A whole work is last in
 * both, because it is a segment that could not be cut rather than a choice.
 *
 * `defend` has no preference, and says so with an empty list: what argues a
 * position rather than explaining a consensus is not readable off any column
 * here, so confidence and length decide and nothing pretends otherwise.
 * Nothing returns that rung today either -- `nextRung` stops at `apply`,
 * because the defence rung is not built.
 */
export const SHAPES_BY_RUNG: Record<Rung, readonly MaterialShape[]> = {
  recognise: ['section', 'clip', 'whole'],
  apply: ['clip', 'section', 'whole'],
  defend: [],
};

function shapeRank(rung: Rung, shape: MaterialShape): number {
  const order = SHAPES_BY_RUNG[rung];
  const place = order.indexOf(shape);
  return place === -1 ? order.length : place;
}

/**
 * Reading speed, in characters a minute.
 *
 * About 220 words a minute at five characters a word, which is ordinary prose
 * read for comprehension. It is a rough number that only ever compares one
 * segment against another, so being ten percent out costs nothing.
 */
export const CHARS_PER_MINUTE = 1100;

/**
 * What opening this would cost you, in minutes.
 *
 * A clip is its own span, which is the honest figure: four minutes of a
 * fifty-minute lecture is four minutes. An open-ended clip runs to the end of
 * the work, so the work's duration finishes it.
 *
 * A segment standing for a whole work costs the whole work, and that is read
 * off the duration rather than off the text, because the text of an
 * uncut video is its title and description -- a few hundred characters for
 * fifty minutes of lecture, which would otherwise read as the shortest thing
 * on the page.
 */
export function commitmentMinutes(row: ClaimMaterial): number {
  if (row.tStartSeconds !== null) {
    const end = row.tEndSeconds ?? row.item.durationSeconds;
    if (end !== null && end > row.tStartSeconds) return (end - row.tStartSeconds) / 60;
  }

  if (row.shape === 'whole' && row.item.durationSeconds !== null) {
    return row.item.durationSeconds / 60;
  }

  return row.lengthChars / CHARS_PER_MINUTE;
}

/** The minutes as a row says them. Never zero: nothing takes no time. */
export function commitmentLabel(row: ClaimMaterial): string {
  return `about ${Math.max(1, Math.round(commitmentMinutes(row)))} min`;
}

const CONFIDENCE_RANK: Record<LocatorConfidence, number> = { verified: 0, unverified: 1 };

/**
 * The list, best first.
 *
 * The spec's three terms in its order of precedence, then the work's title and
 * the segment's place in it so two otherwise equal rows keep the same order on
 * every render.
 *
 * "Not already consumed" is the spec's second term and is not here. Nothing on
 * this side reads `readings`, and queueing a segment twice hands back the
 * reading you already have rather than a second one, so the cost of leaving it
 * out is a row offered again rather than a duplicate in the queue.
 */
export function orderForClaim(rung: Rung, rows: readonly ClaimMaterial[]): ClaimMaterial[] {
  return [...rows].sort((a, b) => {
    const shape = shapeRank(rung, a.shape) - shapeRank(rung, b.shape);
    if (shape !== 0) return shape;

    const sure = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (sure !== 0) return sure;

    const length = commitmentMinutes(a) - commitmentMinutes(b);
    if (length !== 0) return length;

    return a.item.title.localeCompare(b.item.title) || a.ordinal - b.ordinal;
  });
}

/**
 * The two reads this needs, named so a test never reaches a database.
 *
 * The two-port pattern the rest of this directory uses. What is worth holding
 * still is which of the three absences a claim gets and in what order the rows
 * come back, and neither of those is about PostgREST.
 */
export type MaterialStore = {
  /** Every link this account holds for this claim, with its segment and work. */
  forClaim(conceptId: string): Promise<ClaimMaterial[]>;
  /** Whether the catalogue holds anything a claim could be matched against. */
  anySearchable(): Promise<boolean>;
};

/**
 * Everything linked to one claim, ordered, or the reason there is nothing.
 *
 * Whether the catalogue holds anything is only asked when the claim has no
 * links, which is the one case where the answer changes what a page says.
 *
 * An empty catalogue is reported ahead of a claim nobody has searched, because
 * both are true of most claims today and only one of them is worth acting on.
 * Telling somebody to go and search a catalogue with nothing in it sends them
 * to press a button that cannot succeed.
 */
export async function materialForClaim(
  store: MaterialStore,
  input: {
    conceptId: string;
    rung: Rung;
    /** When the catalogue was last searched for this claim. Null: never. */
    searchedAt: string | null;
  },
): Promise<ClaimMaterialView> {
  const rows = await store.forClaim(input.conceptId);
  if (rows.length > 0) return { material: orderForClaim(input.rung, rows), absence: null };

  if (!(await store.anySearchable())) return { material: [], absence: 'catalogue-empty' };

  return { material: [], absence: input.searchedAt ? 'nothing-matched' : 'never-searched' };
}

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

type ItemRecord = {
  id: string;
  title: string;
  author: string | null;
  kind: string;
  canonical_url: string;
  duration_seconds: number | null;
};

type SegmentRecord = {
  id: string;
  ordinal: number;
  heading: string | null;
  section_anchor: string | null;
  t_start_seconds: number | null;
  t_end_seconds: number | null;
  text: string;
  catalogue_items: ItemRecord | ItemRecord[] | null;
};

type LinkRecord = {
  basis: string;
  confidence: LocatorConfidence;
  model: string | null;
  catalogue_segments: SegmentRecord | SegmentRecord[] | null;
};

const LINK_COLUMNS =
  'basis, confidence, model, ' +
  'catalogue_segments!catalogue_links_segment_id_fkey ' +
  '( id, ordinal, heading, section_anchor, t_start_seconds, t_end_seconds, text, ' +
  'catalogue_items!catalogue_segments_item_id_fkey ' +
  '( id, title, author, kind, canonical_url, duration_seconds ) )';

/** PostgREST hands an embedded row back as an object or a one-element array. */
function flatten<T>(embedded: T | T[] | null): T | null {
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
}

/** The three addresses a segment can have, read the way `locatorFor` reads them. */
export function shapeOf(segment: {
  tStartSeconds: number | null;
  sectionAnchor: string | null;
  heading: string | null;
}): MaterialShape {
  if (segment.tStartSeconds !== null) return 'clip';
  if (segment.sectionAnchor !== null || segment.heading !== null) return 'section';
  return 'whole';
}

function materialFrom(link: LinkRecord): ClaimMaterial | null {
  const segment = flatten(link.catalogue_segments);
  if (!segment) return null;
  const item = flatten(segment.catalogue_items);
  if (!item) return null;

  const shape = shapeOf({
    tStartSeconds: segment.t_start_seconds,
    sectionAnchor: segment.section_anchor,
    heading: segment.heading,
  });

  return {
    segmentId: segment.id,
    ordinal: segment.ordinal,
    basis: link.basis,
    confidence: link.confidence,
    model: link.model,
    shape,
    where:
      shape === 'clip' && segment.t_start_seconds !== null
        ? clipLabel(segment.t_start_seconds, segment.t_end_seconds)
        : shape === 'section'
          ? segment.heading
          : null,
    // The text is read for its length and then dropped. A section runs to a
    // few thousand characters and no page here shows any of it, so nothing
    // above this is handed the chance to render a wall of an article.
    lengthChars: segment.text.length,
    tStartSeconds: segment.t_start_seconds,
    tEndSeconds: segment.t_end_seconds,
    item: {
      id: item.id,
      title: item.title,
      author: item.author,
      kind: item.kind,
      canonicalUrl: item.canonical_url,
      durationSeconds: item.duration_seconds,
    },
  };
}

/**
 * The live store, through the session client.
 *
 * `user_id` is filtered on rather than left to RLS for the same reason the
 * rest of the module does it: the policy is the guard, and the filter is what
 * keeps the index on `(user_id, concept_id, confidence)` usable.
 */
export function tableMaterialStore(
  supabase: LearnSupabaseClient,
  userId: string,
): MaterialStore {
  return {
    async forClaim(conceptId) {
      const { data, error } = await supabase
        .from('catalogue_links')
        .select(LINK_COLUMNS)
        .eq('user_id', userId)
        .eq('concept_id', conceptId)
        .order('created_at');

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Reading what was found for this idea', error);

      return ((data ?? []) as unknown as LinkRecord[])
        .map(materialFrom)
        .filter((row): row is ClaimMaterial => row !== null);
    },

    /**
     * Asked of `embedding_model` rather than of the vector. The check
     * constraint keeps the two null together, the model is text, and asking
     * PostgREST about the vector sends a comparison over the wire for nothing.
     *
     * A segment with no embedding counts as nothing here, because no claim can
     * reach it: saying the catalogue has material for you when none of it can
     * be found is the kind of half-truth law 2 is about.
     */
    async anySearchable() {
      const { data, error } = await supabase
        .from('catalogue_segments')
        .select('id')
        .not('embedding_model', 'is', null)
        .limit(1)
        .maybeSingle();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Looking in the catalogue', error);
      return data !== null;
    },
  };
}

/** Everything the catalogue holds for one claim, against the live tables. */
export async function loadClaimMaterial(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { conceptId: string; rung: Rung; searchedAt: string | null },
): Promise<ClaimMaterialView> {
  return materialForClaim(tableMaterialStore(supabase, userId), input);
}
