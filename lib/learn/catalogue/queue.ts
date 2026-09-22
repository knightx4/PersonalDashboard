import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LinkTarget } from '@/lib/learn/catalogue/judge';

/**
 * Putting one piece of catalogue material into the reading queue.
 *
 * The join between the catalogue and the rest of the module, and the place
 * docs/LEARN-SOURCES-SPEC.md means by "queuing materialises a `sources` row
 * from a catalogue entry". What comes out is an ordinary reading in an
 * ordinary track: the pages that list readings, the Open button and the locate
 * pass all keep working, because none of them can tell that the row came from
 * the catalogue.
 *
 * Three things this has to get right.
 *
 * **One work is one source.** A lecture cut into twenty segments is still one
 * lecture, and queuing two of its segments has to leave one `sources` row with
 * two readings pointing into it -- otherwise "have I read this?" and the
 * spend-per-work reads split across rows that are the same thing. The dedupe
 * goes through `sources.catalogue_item_id` first and the URL second, and the
 * source's `canonical_url` is the work's own, never the deep link. Putting the
 * clip in the source URL is what would break this, because
 * `sources_user_url_key` is unique per user over that column and two clips are
 * two URLs.
 *
 * **The clip is stored, not hidden in a link.** `locator_kind = 'timestamp'`
 * with the second offsets beside it, which is what lets a card read
 * `12:04-18:30`. `open_url` carries the same position again in the form the
 * provider understands, so the Open button lands there.
 *
 * **The reading says how its location is known.** `locator_basis` distinguishes
 * a match a model read the segment and argued for from a near neighbour
 * nothing has checked, which is the rule that column exists for.
 */

/** A segment and the work it belongs to, as queueing needs to see them. */
export type QueueableSegment = {
  segmentId: string;
  ordinal: number;
  /** What a card shows for an article section. Null on a timed segment. */
  heading: string | null;
  /** The fragment that addresses the section. Null on a timed segment. */
  sectionAnchor: string | null;
  tStartSeconds: number | null;
  tEndSeconds: number | null;
  item: {
    id: string;
    title: string;
    author: string | null;
    kind: string;
    canonicalUrl: string;
    durationSeconds: number | null;
    /** A date, as the column stores it. Only the year reaches `sources`. */
    publishedAt: string | null;
  };
};

/** Where a queued segment points, in the columns `readings` keeps it in. */
export type SegmentLocator = {
  locatorKind: 'timestamp' | 'section' | 'whole';
  locatorLabel: string | null;
  tStartSeconds: number | null;
  tEndSeconds: number | null;
  openUrl: string;
};

/** Seconds as a person reads a clip: `12:04`, and `1:05:03` past the hour. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * The label a timed reading carries.
 *
 * An open-ended clip is a real case: `catalogue_segments_time_ck` allows a
 * start with no end, which means "from here to the end of the work", and that
 * cannot be rendered as a range.
 */
export function clipLabel(start: number, end: number | null): string {
  return end === null ? `From ${clock(start)}` : `${clock(start)}–${clock(end)}`;
}

/**
 * Hosts that take the position as `?t=`.
 *
 * Everything else gets the media fragment `#t=start,end`, which is the W3C
 * form and what a player that honours anything will honour. Neither is a
 * guess about the page: a host that ignores the position opens the work at the
 * top, and the offsets stored on the reading still say which minutes to watch.
 */
const SECONDS_IN_QUERY = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

function atSecond(canonicalUrl: string, start: number, end: number | null): string {
  let url: URL;
  try {
    url = new URL(canonicalUrl);
  } catch {
    return canonicalUrl;
  }

  const from = Math.max(0, Math.round(start));

  if (SECONDS_IN_QUERY.has(url.hostname)) {
    url.searchParams.set('t', String(from));
    return url.toString();
  }

  url.hash = end === null ? `t=${from}` : `t=${from},${Math.round(end)}`;
  return url.toString();
}

function atSection(canonicalUrl: string, anchor: string): string {
  let url: URL;
  try {
    url = new URL(canonicalUrl);
  } catch {
    return canonicalUrl;
  }

  url.hash = anchor.startsWith('#') ? anchor.slice(1) : anchor;
  return url.toString();
}

/**
 * Which of the three addresses a segment has, and how it reads.
 *
 * The three cases are the ones `catalogue_segments` allows: timed, anchored,
 * or neither, the last being one segment standing for a whole work. A start of
 * zero is a clip from the beginning and not an absent one, which is why this
 * tests for null rather than for falsiness.
 */
export function locatorFor(segment: QueueableSegment): SegmentLocator {
  const { canonicalUrl } = segment.item;

  if (segment.tStartSeconds !== null) {
    return {
      locatorKind: 'timestamp',
      locatorLabel: clipLabel(segment.tStartSeconds, segment.tEndSeconds),
      tStartSeconds: segment.tStartSeconds,
      tEndSeconds: segment.tEndSeconds,
      openUrl: atSecond(canonicalUrl, segment.tStartSeconds, segment.tEndSeconds),
    };
  }

  if (segment.sectionAnchor !== null || segment.heading !== null) {
    return {
      locatorKind: 'section',
      locatorLabel: segment.heading,
      tStartSeconds: null,
      tEndSeconds: null,
      // A section Wikipedia gives no anchor for -- the lead is the usual one --
      // still opens the article, and the heading still says which part.
      openUrl: segment.sectionAnchor ? atSection(canonicalUrl, segment.sectionAnchor) : canonicalUrl,
    };
  }

  return {
    locatorKind: 'whole',
    locatorLabel: null,
    tStartSeconds: null,
    tEndSeconds: null,
    openUrl: canonicalUrl,
  };
}

/** The link this segment was queued from, when it was queued from one. */
export type SegmentLink = { basis: string; confidence: string };

/**
 * What the reading says about where it points.
 *
 * Both halves are about the location rather than about the material, which is
 * the question `locator_basis` answers. The address is the catalogue entry's
 * own either way -- a section anchor the ingest read off the article, or the
 * offsets the transcript was cut on -- and what differs is whether anything
 * argued that the part it points at is worth the time.
 */
function basisFor(link: SegmentLink | null): string {
  if (link && link.confidence === 'verified') {
    return (
      'A model read this part of the work and argued that it teaches this idea. ' +
      'The position came from the catalogue entry, so it points at the part that was read.'
    );
  }

  return (
    'One of the nearest things in the catalogue to this idea, with nothing having read it to check. ' +
    'The position came from the catalogue entry.'
  );
}

/** The year a work was published, where the catalogue knows the date. */
function yearOf(publishedAt: string | null): number | null {
  if (!publishedAt) return null;
  const year = Number(publishedAt.slice(0, 4));
  return Number.isInteger(year) && year >= 1000 && year <= 2200 ? year : null;
}

/** A `sources` row materialised from a catalogue item. */
export type NewSource = {
  catalogueItemId: string;
  title: string;
  author: string | null;
  kind: string;
  year: number | null;
  canonicalUrl: string;
  durationSeconds: number | null;
};

/** A `readings` row, before the store gives it an account and a table. */
export type NewReading = {
  trackId: string;
  sourceId: string;
  conceptId: string | null;
  position: number;
  locator: SegmentLocator;
  why: string | null;
  locatorBasis: string;
};

/**
 * The statements this needs, named so a test never reaches a database.
 *
 * The two-port pattern the rest of this directory uses. What is worth holding
 * still is the pass -- the order the source is looked for in, that a second
 * segment of one work finds the source the first one made, that pressing twice
 * on one segment does not queue it twice -- and none of that is about
 * PostgREST.
 */
export type QueueStore = {
  /** The segment and its work, or null when it is not in the catalogue. */
  segment(segmentId: string): Promise<QueueableSegment | null>;
  /** The judged link behind this queue press, when there is one. */
  link(input: { segmentId: string; target: LinkTarget }): Promise<SegmentLink | null>;
  /** The source already materialised from this catalogue item. */
  sourceForItem(itemId: string): Promise<string | null>;
  /** The source already held at this URL, however it got there. */
  sourceForUrl(url: string): Promise<{ id: string; catalogueItemId: string | null } | null>;
  /** Point a source you already had at the catalogue item it turns out to be. */
  adopt(input: { sourceId: string; itemId: string }): Promise<void>;
  /**
   * Write the source. Null when the unique index on the URL refused it, which
   * is another press having got there first rather than an error.
   */
  createSource(source: NewSource): Promise<string | null>;
  /** An unfinished reading already pointing at exactly this place. */
  readingAt(input: { sourceId: string; openUrl: string }): Promise<string | null>;
  /** The last position in the track, so a new reading appends. */
  lastPosition(trackId: string): Promise<number>;
  createReading(reading: NewReading): Promise<string>;
};

export type QueueSegmentInput = {
  segmentId: string;
  trackId: string;
  /** The claim or subject this was found for. Its link supplies the `why`. */
  target: LinkTarget;
};

export type QueuedSegment = {
  readingId: string;
  sourceId: string;
  /** False when this segment was already in the queue and that row came back. */
  created: boolean;
};

/**
 * Find the source for this work, or make it.
 *
 * The order is what keeps one work to one row. `catalogue_item_id` is asked
 * first because it is the only identifier that survives a provider changing a
 * URL; the URL is asked second because a work you pasted months ago is already
 * a source, and inserting over it would hit `sources_user_url_key` rather than
 * silently duplicating. A source found that way is pointed at the catalogue
 * item, so the next queue press takes the first branch.
 */
export async function sourceForSegment(
  store: QueueStore,
  segment: QueueableSegment,
): Promise<string> {
  const { item } = segment;

  const materialised = await store.sourceForItem(item.id);
  if (materialised) return materialised;

  const held = await store.sourceForUrl(item.canonicalUrl);
  if (held) {
    if (!held.catalogueItemId) await store.adopt({ sourceId: held.id, itemId: item.id });
    return held.id;
  }

  const created = await store.createSource({
    catalogueItemId: item.id,
    title: item.title,
    author: item.author,
    kind: item.kind,
    year: yearOf(item.publishedAt),
    canonicalUrl: item.canonicalUrl,
    durationSeconds: item.durationSeconds,
  });
  if (created) return created;

  // The insert lost a race. Whoever won wrote the row this press wanted, so
  // read it back rather than reporting a failure that did not happen.
  const raced = (await store.sourceForItem(item.id)) ?? (await store.sourceForUrl(item.canonicalUrl))?.id;
  if (!raced) throw new Error('Saving the source failed and it is not there.');
  return raced;
}

/**
 * Queue one segment, and hand back the reading to open.
 *
 * Pressing the button twice on the same segment hands back the reading already
 * in the queue rather than a second copy of it. Finished and abandoned
 * readings do not count, on the reasoning the graph's queue path gives: coming
 * back to something you read once is ordinary, and pressing twice in a minute
 * is not.
 */
export async function queueSegment(
  store: QueueStore,
  input: QueueSegmentInput,
): Promise<QueuedSegment> {
  const segment = await store.segment(input.segmentId);
  if (!segment) throw new Error('That material is not in the catalogue.');

  const locator = locatorFor(segment);
  const link = await store.link({ segmentId: input.segmentId, target: input.target });
  const sourceId = await sourceForSegment(store, segment);

  const already = await store.readingAt({ sourceId, openUrl: locator.openUrl });
  if (already) return { readingId: already, sourceId, created: false };

  const position = (await store.lastPosition(input.trackId)) + 10;

  const readingId = await store.createReading({
    trackId: input.trackId,
    sourceId,
    conceptId: input.target.concept ?? null,
    position,
    locator,
    why: link?.basis ?? null,
    locatorBasis: basisFor(link),
  });

  return { readingId, sourceId, created: true };
}

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/** Postgres says a unique index refused the row with this. */
const UNIQUE_VIOLATION = '23505';

const SEGMENT_COLUMNS =
  'id, ordinal, heading, section_anchor, t_start_seconds, t_end_seconds, ' +
  'catalogue_items!catalogue_segments_item_id_fkey ' +
  '( id, title, author, kind, canonical_url, duration_seconds, published_at )';

type ItemRecord = {
  id: string;
  title: string;
  author: string | null;
  kind: string;
  canonical_url: string;
  duration_seconds: number | null;
  published_at: string | null;
};

type SegmentRecord = {
  id: string;
  ordinal: number;
  heading: string | null;
  section_anchor: string | null;
  t_start_seconds: number | null;
  t_end_seconds: number | null;
  catalogue_items: ItemRecord | ItemRecord[] | null;
};

/**
 * The live store, through the session client.
 *
 * Everything here runs as the caller. The catalogue halves of it are readable
 * by any signed-in account and the `sources` and `readings` halves are the
 * person's own, so RLS is what scopes the writes; `user_id` is passed on
 * insert because the insert policies compare it to `auth.uid()`, and is never
 * used as a filter.
 */
export function tableQueueStore(supabase: LearnSupabaseClient, userId: string): QueueStore {
  return {
    async segment(segmentId) {
      const { data, error } = await supabase
        .from('catalogue_segments')
        .select(SEGMENT_COLUMNS)
        .eq('id', segmentId)
        .maybeSingle();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Looking up the material', error);
      if (!data) return null;

      const row = data as unknown as SegmentRecord;
      // PostgREST hands an embedded row back as an object or as a
      // single-element array depending on how it read the relationship, and
      // the reading loader flattens it the same way.
      const item = Array.isArray(row.catalogue_items) ? row.catalogue_items[0] : row.catalogue_items;
      if (!item) throw new Error('That material has no work behind it.');

      return {
        segmentId: row.id,
        ordinal: row.ordinal,
        heading: row.heading,
        sectionAnchor: row.section_anchor,
        tStartSeconds: row.t_start_seconds,
        tEndSeconds: row.t_end_seconds,
        item: {
          id: item.id,
          title: item.title,
          author: item.author,
          kind: item.kind,
          canonicalUrl: item.canonical_url,
          durationSeconds: item.duration_seconds,
          publishedAt: item.published_at,
        },
      };
    },

    async link({ segmentId, target }) {
      const { data, error } = await supabase
        .from('catalogue_links')
        .select('basis, confidence')
        .eq('user_id', userId)
        .eq('segment_id', segmentId)
        .eq(target.concept ? 'concept_id' : 'subject_id', target.concept ?? target.subject!)
        .maybeSingle();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Looking up the match', error);
      return data ? (data as SegmentLink) : null;
    },

    async sourceForItem(itemId) {
      const { data, error } = await supabase
        .from('sources')
        .select('id')
        .eq('catalogue_item_id', itemId)
        .order('created_at')
        .limit(1)
        .maybeSingle();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Looking for the source', error);
      return data ? (data as { id: string }).id : null;
    },

    async sourceForUrl(url) {
      const { data, error } = await supabase
        .from('sources')
        .select('id, catalogue_item_id')
        .eq('canonical_url', url)
        .maybeSingle();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Looking for the source', error);
      if (!data) return null;

      const row = data as { id: string; catalogue_item_id: string | null };
      return { id: row.id, catalogueItemId: row.catalogue_item_id };
    },

    async adopt({ sourceId, itemId }) {
      const { error } = await supabase
        .from('sources')
        .update({ catalogue_item_id: itemId })
        .eq('id', sourceId);

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Linking the source to the catalogue', error);
    },

    async createSource(source) {
      const { data, error } = await supabase
        .from('sources')
        .insert({
          user_id: userId,
          catalogue_item_id: source.catalogueItemId,
          title: source.title,
          author: source.author,
          kind: source.kind,
          year: source.year,
          canonical_url: source.canonicalUrl,
          duration_seconds: source.durationSeconds,
          // Everything the catalogue holds is published openly by the provider
          // it came from, which is a property of the provider rather than of
          // anything this fetched. So `access_checked_at` stays null: nothing
          // here has been to the page to look.
          access: 'open',
        })
        .select('id')
        .single();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error || !data) throw fail('Saving the source', error ?? { message: 'no row' });
      return (data as { id: string }).id;
    },

    async readingAt({ sourceId, openUrl }) {
      const { data, error } = await supabase
        .from('readings')
        .select('id')
        .eq('source_id', sourceId)
        .eq('open_url', openUrl)
        .in('status', ['queued', 'reading'])
        .order('created_at')
        .limit(1)
        .maybeSingle();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Looking for what you already queued', error);
      return data ? (data as { id: string }).id : null;
    },

    async lastPosition(trackId) {
      const { data, error } = await supabase
        .from('readings')
        .select('position')
        .eq('track_id', trackId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error) throw fail('Finding the end of the reading list', error);
      return (data as { position: number } | null)?.position ?? 0;
    },

    async createReading(reading) {
      const { data, error } = await supabase
        .from('readings')
        .insert({
          user_id: userId,
          track_id: reading.trackId,
          source_id: reading.sourceId,
          concept_id: reading.conceptId,
          position: reading.position,
          locator_kind: reading.locator.locatorKind,
          locator_label: reading.locator.locatorLabel,
          t_start_seconds: reading.locator.tStartSeconds,
          t_end_seconds: reading.locator.tEndSeconds,
          open_url: reading.locator.openUrl,
          // The catalogue entry was made by reading the work: the anchor came
          // off the article and the offsets off the transcript. That is the
          // condition the locate pass has to go and establish, so a reading
          // queued from a segment starts where that pass would leave it.
          locator_confidence: 'verified',
          locator_basis: reading.locatorBasis,
          why: reading.why,
        })
        .select('id')
        .single();

      assertSchemaExposed(error, LEARN_SCHEMA);
      if (error || !data) throw fail('Queueing that', error ?? { message: 'no row' });
      return (data as { id: string }).id;
    },
  };
}

/**
 * Queue one catalogue segment for a claim, against the live tables.
 *
 * What a server action calls once somebody has pressed the button on a piece
 * of material. The track is the caller's to choose: material found for a claim
 * belongs in the same track as the claim it was found for, which
 * `trackForSubject` in lib/learn/graph/to-queue.ts answers.
 */
export async function queueCatalogueSegment(
  supabase: LearnSupabaseClient,
  userId: string,
  input: QueueSegmentInput,
): Promise<QueuedSegment> {
  return queueSegment(tableQueueStore(supabase, userId), input);
}
