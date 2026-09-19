import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { escapeLike } from '@/lib/search/sources/map';
import {
  mergeTrackMatches,
  type MatchedReading,
  type TrackReadingMatch,
} from '@/lib/learn/tracks/matches';

/**
 * Reading the queue.
 *
 * Every query here goes through the session client, so RLS decides what comes
 * back. Nothing filters by user id in this file, deliberately: application code
 * never gets to decide who owns a row, and a query that looks like it forgot
 * has not -- the policy is doing it.
 */

export type ReadingStatus = 'queued' | 'reading' | 'read' | 'abandoned';
export type TrackStatus = 'active' | 'done' | 'shelved';
export type SourceAccess = 'open' | 'paywalled' | 'purchase' | 'library' | 'unknown';
export type LocatorConfidence = 'verified' | 'unverified';

export type TrackProgress = {
  /** Finished, and counted. */
  read: number;
  /** Still ahead of you. Excludes abandoned, which is not work remaining. */
  remaining: number;
  abandoned: number;
  /** read / (read + remaining), 0 when there is nothing to do. */
  fraction: number;
};

export type TrackSummary = {
  id: string;
  title: string;
  question: string | null;
  status: TrackStatus;
  createdAt: string;
  /** The broader track this one was kept out of, if it was. */
  branchedFrom: string | null;
  progress: TrackProgress;
  /**
   * The readings inside this track that the search matched, listed under the
   * row. Empty without a search, and empty for a track the search reached by
   * its own title or question alone.
   */
  matches: MatchedReading[];
};

export type ReadingRow = {
  id: string;
  position: number;
  status: ReadingStatus;
  /**
   * What this reading is about, however it knows.
   *
   * The source's title when there is a source, your own words when there is
   * not. Every reading has one -- a check constraint says so -- so nothing
   * downstream has to render a blank line.
   */
  subject: string;
  /** Your own words, when you typed them. Null for a reading from a paste. */
  title: string | null;
  why: string | null;
  note: string | null;
  locatorKind: string;
  locatorLabel: string | null;
  locatorBasis: string;
  locatorConfidence: LocatorConfidence;
  openUrl: string | null;
  textAnchor: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  finishedAt: string | null;
  /** When it was put on the Read now shelf. Null means it is not on it. */
  readNowAt: string | null;
  /**
   * The concept this row was queued to close, when it came from a gap in a
   * subject graph. Null for a reading you wrote down yourself, which is most
   * of them and not a defect.
   */
  conceptId: string | null;
  /**
   * Null when you wrote down a subject and no source has been found for it
   * yet. That is a normal state, not a broken row.
   */
  source: {
    id: string;
    title: string;
    author: string | null;
    kind: string;
    year: number | null;
    canonicalUrl: string | null;
    access: SourceAccess;
    priceCents: number | null;
    pageCount: number | null;
  } | null;
};

export type TrackDetail = TrackSummary & {
  /** The title of the track this one was branched out of, for the way back. */
  branchedFromTitle: string | null;
  readings: ReadingRow[];
};

/**
 * Progress over a set of readings.
 *
 * `abandoned` is in neither half of the fraction. A bar that fills when you
 * give up is a lie, and one that stays permanently short because of a paper
 * you dropped in March is a nag.
 */
export function progressOf(statuses: ReadingStatus[]): TrackProgress {
  let read = 0;
  let remaining = 0;
  let abandoned = 0;

  for (const status of statuses) {
    if (status === 'read') read += 1;
    else if (status === 'abandoned') abandoned += 1;
    else remaining += 1;
  }

  const counted = read + remaining;
  return { read, remaining, abandoned, fraction: counted === 0 ? 0 : read / counted };
}

type ReadingRecord = {
  id: string;
  position: number;
  status: ReadingStatus;
  title: string | null;
  why: string | null;
  note: string | null;
  locator_kind: string;
  locator_label: string | null;
  locator_basis: string;
  locator_confidence: LocatorConfidence;
  open_url: string | null;
  text_anchor: string | null;
  page_from: number | null;
  page_to: number | null;
  finished_at: string | null;
  read_now_at: string | null;
  concept_id: string | null;
  sources: {
    id: string;
    title: string;
    author: string | null;
    kind: string;
    year: number | null;
    canonical_url: string | null;
    access: SourceAccess;
    price_cents: number | null;
    page_count: number | null;
  } | null;
};

function toReading(row: ReadingRecord): ReadingRow {
  // A reading with no source is a subject you wrote down and have not found
  // anything to read for yet. The check constraint guarantees one of the two
  // is present, so the fallback at the end never fires -- it is there so this
  // function has no way to return an empty string.
  const subject = row.sources?.title ?? row.title ?? 'Untitled';

  return {
    id: row.id,
    position: row.position,
    status: row.status,
    subject,
    title: row.title,
    why: row.why,
    note: row.note,
    locatorKind: row.locator_kind,
    locatorLabel: row.locator_label,
    locatorBasis: row.locator_basis,
    locatorConfidence: row.locator_confidence,
    openUrl: row.open_url,
    textAnchor: row.text_anchor,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    finishedAt: row.finished_at,
    readNowAt: row.read_now_at,
    conceptId: row.concept_id,
    source: row.sources
      ? {
          id: row.sources.id,
          title: row.sources.title,
          author: row.sources.author,
          kind: row.sources.kind,
          year: row.sources.year,
          canonicalUrl: row.sources.canonical_url,
          access: row.sources.access,
          priceCents: row.sources.price_cents,
          pageCount: row.sources.page_count,
        }
      : null,
  };
}

const TRACK_COLUMNS = 'id, title, question, status, created_at, branched_from';

const READING_COLUMNS =
  'id, position, status, title, why, note, locator_kind, locator_label, locator_basis, ' +
  'locator_confidence, open_url, text_anchor, page_from, page_to, finished_at, read_now_at, ' +
  'concept_id, ' +
  'sources!readings_source_fk ( id, title, author, kind, year, canonical_url, access, price_cents, page_count )';

type TrackRecord = {
  id: string;
  title: string;
  question: string | null;
  status: TrackStatus;
  created_at: string;
  branched_from: string | null;
};

type ReadingMatchRecord = {
  id: string;
  track_id: string;
  title: string | null;
  sources: { title: string } | { title: string }[] | null;
};

function toMatch(row: ReadingMatchRecord): TrackReadingMatch {
  const source = Array.isArray(row.sources) ? row.sources[0] : row.sources;
  // The same fallback toReading makes, so a reading is called the same thing
  // under a track row as it is on its own page.
  return { id: row.id, trackId: row.track_id, subject: source?.title ?? row.title ?? 'Untitled' };
}

/**
 * The readings a search matches, and the track each one sits in.
 *
 * Two reads, because the two strings a reading is remembered by live in
 * different tables: the words you wrote down when you queued it, and the title
 * of the source it was resolved to. "the Hayek essay" and "how prices
 * coordinate" are the same row reached from opposite ends, which is why
 * lib/search/sources/learn.ts makes the same pair for the command palette. A
 * reading both reads return is de-duplicated in mergeTrackMatches.
 *
 * These filters are `ilike` rather than `or`, so the comma that splits an `or`
 * expression is not a problem here.
 */
async function loadReadingMatches(
  supabase: LearnSupabaseClient,
  pattern: string,
): Promise<TrackReadingMatch[]> {
  const [{ data: byTitle, error: titleError }, { data: bySource, error: sourceError }] =
    await Promise.all([
      supabase
        .from('readings')
        .select('id, track_id, title, sources ( title )')
        .ilike('title', pattern)
        .order('position'),
      supabase
        .from('readings')
        .select('id, track_id, title, sources!inner ( title )')
        .ilike('sources.title', pattern)
        .order('position'),
    ]);

  assertSchemaExposed(titleError, LEARN_SCHEMA);
  if (titleError) throw new Error(`Searching your readings failed: ${titleError.message}`);

  assertSchemaExposed(sourceError, LEARN_SCHEMA);
  if (sourceError) throw new Error(`Searching by source title failed: ${sourceError.message}`);

  return [
    ...((byTitle ?? []) as unknown as ReadingMatchRecord[]),
    ...((bySource ?? []) as unknown as ReadingMatchRecord[]),
  ].map(toMatch);
}

/**
 * What to narrow the list of tracks to.
 *
 * An object rather than a bare string because matching grows: the search here
 * already reaches the readings inside a track as well as the track's own title
 * and question, and anything narrower lands as another field rather than
 * another positional argument.
 */
export type TrackListFilter = {
  /**
   * Keep only the tracks whose title or question contains this, ignoring case,
   * along with the tracks holding a reading that contains it. Empty or blank is
   * no search at all, and every track comes back.
   */
  search?: string;
};

/**
 * Every track, with its progress. With a search, the ones that match it.
 *
 * A search matches the title or the question, which are the two strings a
 * track is remembered by, and it matches the readings inside a track, which is
 * how a track comes back from the title of a book in it. The track holding a
 * matching reading is pulled in even when nothing about the track itself
 * matched, and the readings that matched come back on it for the list to draw.
 * Blank or whitespace is no search at all rather than a match on nothing, so
 * clearing the box gives the whole list back.
 *
 * Without a search that is one query for the tracks and one for their
 * readings' statuses, rather than a count per track: a personal queue is tens
 * of tracks, and two round trips beat N. The statuses query is not narrowed
 * alongside the tracks -- it is read by track id and the rows a search left out
 * are simply never looked up. A search costs two more reads for the readings it
 * matches, and a fifth for the tracks that only a reading reached, none of
 * which grows with the number of tracks.
 */
export async function loadTracks(
  supabase: LearnSupabaseClient,
  filter: TrackListFilter = {},
): Promise<TrackSummary[]> {
  let tracksRead = supabase.from('tracks').select(TRACK_COLUMNS);

  const search = filter.search?.trim();
  // Escaped, so a % or a _ somebody typed is the character they typed rather
  // than "match anything from here".
  const pattern = search ? `%${escapeLike(search)}%` : null;
  if (pattern) {
    tracksRead = tracksRead.or(`title.ilike.${pattern},question.ilike.${pattern}`);
  }

  const [{ data, error }, matches] = await Promise.all([
    tracksRead.order('created_at', { ascending: false }),
    pattern ? loadReadingMatches(supabase, pattern) : Promise.resolve([]),
  ]);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading your tracks failed: ${error.message}`);

  const found = (data ?? []) as TrackRecord[];

  // The tracks a matching reading is in that the search did not find on its
  // own. Read by id rather than through the readings: RLS still decides what
  // comes back, and a track that is gone simply is not in the answer.
  const foundIds = new Set(found.map((track) => track.id));
  const missing = [...new Set(matches.map((match) => match.trackId))].filter(
    (id) => !foundIds.has(id),
  );

  let holders: TrackRecord[] = [];
  if (missing.length > 0) {
    const { data: holderRows, error: holderError } = await supabase
      .from('tracks')
      .select(TRACK_COLUMNS)
      .in('id', missing);

    assertSchemaExposed(holderError, LEARN_SCHEMA);
    if (holderError) {
      throw new Error(`Reading the tracks those readings are in failed: ${holderError.message}`);
    }
    holders = (holderRows ?? []) as TrackRecord[];
  }

  const merged = mergeTrackMatches(
    [...found, ...holders].map((track) => ({
      id: track.id,
      title: track.title,
      question: track.question,
      status: track.status,
      createdAt: track.created_at,
      branchedFrom: track.branched_from,
    })),
    matches,
  );
  if (merged.length === 0) return [];

  const { data: statusRows, error: statusError } = await supabase
    .from('readings')
    .select('track_id, status');

  assertSchemaExposed(statusError, LEARN_SCHEMA);
  if (statusError) throw new Error(`Reading your progress failed: ${statusError.message}`);

  const byTrack = new Map<string, ReadingStatus[]>();
  for (const row of (statusRows ?? []) as Array<{ track_id: string; status: ReadingStatus }>) {
    const existing = byTrack.get(row.track_id);
    if (existing) existing.push(row.status);
    else byTrack.set(row.track_id, [row.status]);
  }

  return merged.map((track) => ({
    ...track,
    progress: progressOf(byTrack.get(track.id) ?? []),
  }));
}

export async function loadTrack(
  supabase: LearnSupabaseClient,
  trackId: string,
): Promise<TrackDetail | null> {
  const { data, error } = await supabase
    .from('tracks')
    .select('id, title, question, status, created_at, branched_from')
    .eq('id', trackId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) return null;

  const track = data as {
    id: string;
    title: string;
    question: string | null;
    status: TrackStatus;
    created_at: string;
    branched_from: string | null;
  };

  const { data: readingRows, error: readingError } = await supabase
    .from('readings')
    .select(READING_COLUMNS)
    .eq('track_id', trackId)
    .order('position')
    .order('created_at');

  assertSchemaExposed(readingError, LEARN_SCHEMA);
  if (readingError) throw new Error(`Reading this track failed: ${readingError.message}`);

  const readings = ((readingRows ?? []) as unknown as ReadingRecord[]).map(toReading);

  // The topic this one came out of, for the link back up. A second query
  // rather than an embed, and only for the few tracks that have a parent.
  let branchedFromTitle: string | null = null;
  if (track.branched_from) {
    const { data: parent } = await supabase
      .from('tracks')
      .select('title')
      .eq('id', track.branched_from)
      .maybeSingle();
    branchedFromTitle = parent ? (parent as { title: string }).title : null;
  }

  return {
    id: track.id,
    title: track.title,
    question: track.question,
    status: track.status,
    createdAt: track.created_at,
    branchedFrom: track.branched_from,
    branchedFromTitle,
    progress: progressOf(readings.map((r) => r.status)),
    // Nothing was searched for to reach this page; the readings below are the
    // whole track rather than the ones a search picked out.
    matches: [],
    readings,
  };
}

export type ReadingDetail = ReadingRow & {
  trackId: string;
  trackTitle: string;
  trackQuestion: string | null;
};

export async function loadReading(
  supabase: LearnSupabaseClient,
  readingId: string,
): Promise<ReadingDetail | null> {
  const { data, error } = await supabase
    .from('readings')
    .select(`${READING_COLUMNS}, tracks!readings_track_fk ( id, title, question )`)
    .eq('id', readingId)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) return null;

  const row = data as unknown as ReadingRecord & {
    tracks: { id: string; title: string; question: string | null } | null;
  };

  if (!row.tracks) return null;
  const reading = toReading(row);

  return {
    ...reading,
    trackId: row.tracks.id,
    trackTitle: row.tracks.title,
    trackQuestion: row.tracks.question,
  };
}

/**
 * The Read now shelf: what you said you would read next, across every track.
 *
 * Deliberately not a view of the queue with a filter on it. A track is a
 * curriculum -- ordered, reasoned, read over weeks -- and the twenty minutes
 * in which you actually read are not asking "what is the fourth step of my
 * Marx track", they are asking "what did I say I would read next". Those are
 * different questions and the second one has no good answer inside the first.
 *
 * Finished and abandoned readings are gone from it because putting one down
 * takes it off the shelf; the filter here is a second line, so a row that
 * somehow kept its stamp cannot haunt the page.
 */
export async function loadReadNow(supabase: LearnSupabaseClient): Promise<ReadingDetail[]> {
  const { data, error } = await supabase
    .from('readings')
    .select(`${READING_COLUMNS}, tracks!readings_track_fk ( id, title, question )`)
    .not('read_now_at', 'is', null)
    .in('status', ['queued', 'reading'])
    .order('read_now_at');

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) return [];

  return (data as unknown as Array<
    ReadingRecord & { tracks: { id: string; title: string; question: string | null } | null }
  >)
    .filter((row) => row.tracks !== null)
    .map((row) => ({
      ...toReading(row),
      trackId: row.tracks!.id,
      trackTitle: row.tracks!.title,
      trackQuestion: row.tracks!.question,
    }));
}

/** How many are on the shelf -- for the tab's badge. */
export async function countReadNow(supabase: LearnSupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('readings')
    .select('id', { count: 'exact', head: true })
    .not('read_now_at', 'is', null)
    .in('status', ['queued', 'reading']);

  assertSchemaExposed(error, LEARN_SCHEMA);
  return count ?? 0;
}

/**
 * Where else this source appears in your queue.
 *
 * The cheap half of the reuse question the schema deliberately did not model
 * with a join table: if you have already read this work in another track, the
 * card should say so rather than making you find out by opening it.
 */
export async function loadOtherReadingsOfSource(
  supabase: LearnSupabaseClient,
  sourceId: string,
  excludeReadingId: string,
): Promise<Array<{ id: string; status: ReadingStatus; trackTitle: string }>> {
  const { data, error } = await supabase
    .from('readings')
    .select('id, status, tracks!readings_track_fk ( title )')
    .eq('source_id', sourceId)
    .neq('id', excludeReadingId);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    status: ReadingStatus;
    tracks: { title: string } | null;
  }>)
    .filter((row) => row.tracks !== null)
    .map((row) => ({ id: row.id, status: row.status, trackTitle: row.tracks!.title }));
}
