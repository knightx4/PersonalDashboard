import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { ResolvedSource } from '@/lib/learn/import/resolve-payload';

/**
 * Writing a confirmed import into the queue.
 *
 * Nothing here runs until somebody has ticked a box. The confirm step is a
 * queue, which this codebase is otherwise sceptical of, and it is here for the
 * reason docs/EVIDENCE-LAYER.md gives for its own: a bad item does not merely
 * sit there, it wastes twenty minutes at the exact moment you were finally
 * going to read something.
 *
 * Every write goes through the session client, so RLS decides what lands. The
 * user id is passed explicitly on insert -- a policy's `with check` compares
 * it to auth.uid() and rejects anything else -- and is never used as a filter.
 */

export type SaveRow = {
  resolved: ResolvedSource;
  /** The recommender's own reason, which beats anything generated. */
  why: string | null;
};

export type SaveResult = { trackId: string; readings: number };

function messageFor(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/**
 * Find or create the source row.
 *
 * Deduped on the URL, which is the only identifier here that means anything --
 * two books with the same title are two books, and the same URL is the same
 * page. A source with no URL is always inserted: there is nothing to match on,
 * and a false merge is worse than a duplicate row you can see.
 */
async function upsertSource(
  supabase: LearnSupabaseClient,
  userId: string,
  resolved: ResolvedSource,
): Promise<string> {
  const url = resolved.canonical_url ?? null;

  if (url) {
    const { data, error } = await supabase
      .from('sources')
      .select('id')
      .eq('canonical_url', url)
      .maybeSingle();

    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw messageFor('Looking up the source', error);
    if (data) return (data as { id: string }).id;
  }

  const { data, error } = await supabase
    .from('sources')
    .insert({
      user_id: userId,
      title: resolved.title,
      author: resolved.author ?? null,
      kind: resolved.kind,
      year: resolved.year ?? null,
      canonical_url: url,
      access: resolved.access,
      price_cents: resolved.price_cents ?? null,
      page_count: resolved.page_count ?? null,
      access_checked_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw messageFor('Saving the source', error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

/**
 * Create a track and everything under it.
 *
 * Not a transaction, because PostgREST has no way to open one and the
 * alternative -- a security definer function taking the whole import as json --
 * buys atomicity at the cost of putting the module's logic in SQL. The failure
 * it protects against is a half-written track, which is visible, editable and
 * far less bad than either alternative.
 */
export async function saveImport(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    title: string;
    question: string | null;
    rows: SaveRow[];
    rawText: string;
    sourceHint: string | null;
    parsed: unknown;
  },
): Promise<SaveResult> {
  const { data: trackData, error: trackError } = await supabase
    .from('tracks')
    .insert({
      user_id: userId,
      title: input.title,
      question: input.question,
    })
    .select('id')
    .single();

  assertSchemaExposed(trackError, LEARN_SCHEMA);
  if (trackError || !trackData) {
    throw messageFor('Creating the reading list', trackError ?? { message: 'no row' });
  }
  const trackId = (trackData as { id: string }).id;

  // Provenance first, so a failure part way through the readings still leaves
  // the paste behind to see what went wrong.
  const { error: importError } = await supabase.from('imports').insert({
    user_id: userId,
    track_id: trackId,
    raw_text: input.rawText,
    source_hint: input.sourceHint,
    parsed: input.parsed ?? [],
  });
  assertSchemaExposed(importError, LEARN_SCHEMA);
  if (importError) throw messageFor('Recording the import', importError);

  let position = 0;
  const readings: Record<string, unknown>[] = [];

  for (const row of input.rows) {
    const sourceId = await upsertSource(supabase, userId, row.resolved);
    readings.push({
      user_id: userId,
      track_id: trackId,
      source_id: sourceId,
      position: position += 10,
      locator_kind: row.resolved.locator_kind,
      locator_label: row.resolved.locator_label ?? null,
      page_from: row.resolved.page_from ?? null,
      page_to: row.resolved.page_to ?? null,
      // The resolver never fetches, so a reading starts pointed at the work
      // itself. The locate pass narrows this when you open it.
      open_url: row.resolved.canonical_url ?? null,
      // And it is never verified at this point -- resolve-payload strips the
      // claim, and this is the second place that is true rather than assumed.
      locator_confidence: 'unverified',
      locator_basis: row.resolved.locator_basis,
      why: row.why ?? row.resolved.why ?? null,
    });
  }

  if (readings.length > 0) {
    const { error } = await supabase.from('readings').insert(readings);
    assertSchemaExposed(error, LEARN_SCHEMA);
    if (error) throw messageFor('Saving the readings', error);
  }

  return { trackId, readings: readings.length };
}

/**
 * A track with nothing in it yet.
 *
 * The broad thing you want to learn about, written down before you have found
 * anything to read for it. Separate from saveImport because there is no paste,
 * no resolution and nothing to confirm -- you typed a name and meant it.
 *
 * `branchedFrom` is set when it came out of a track you already had: a step of
 * a route opened up on its own. Null for a topic you typed.
 */
export async function createTrack(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { title: string; question: string | null; branchedFrom?: string | null },
): Promise<string> {
  const { data, error } = await supabase
    .from('tracks')
    .insert({
      user_id: userId,
      title: input.title,
      question: input.question,
      branched_from: input.branchedFrom ?? null,
    })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw messageFor('Creating the reading list', error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

/**
 * The areas you kept out of a topic too broad to plan.
 *
 * One track each, so an area has its own queue, its own progress and its own
 * plan button rather than being a row with nothing behind it. Each remembers
 * the topic it came out of in `branched_from`; nothing is planned and nothing
 * is searched for here, which happens when you open one.
 *
 * The line the model wrote about what an area covers goes in as the question.
 * It is not a question, but it is what the planner reads for context later,
 * and it is the only thing distinguishing "trade between countries" from the
 * other seven names on a list you picked from once.
 */
export async function saveBranchedAreas(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { fromTrackId: string; areas: Array<{ name: string; covers: string | null }> },
): Promise<string[]> {
  if (input.areas.length === 0) return [];

  const { data, error } = await supabase
    .from('tracks')
    .insert(
      input.areas.map((area) => ({
        user_id: userId,
        title: area.name,
        question: area.covers,
        branched_from: input.fromTrackId,
      })),
    )
    .select('id');

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw messageFor('Keeping the areas', error ?? { message: 'no rows' });
  return (data as Array<{ id: string }>).map((row) => row.id);
}

/**
 * Something specific you want to learn, inside a track.
 *
 * No source, because you have not found one -- that is what `readings.title`
 * is for, and the check constraint accepts a reading that has a subject
 * either way. The basis says plainly where this came from, which keeps the
 * module's rule intact: a location is never claimed without saying how it is
 * known, and "you typed it" is a perfectly good how.
 *
 * `conceptId` is set when the row came from a gap in a subject graph rather
 * than from you typing. It is what lets the source search read that subject's
 * graph later, when you open the row and ask it to find something -- without
 * it the search has the claim and nothing else about where you stand.
 */
export async function addManualReading(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { trackId: string; title: string; why: string | null; conceptId?: string | null },
): Promise<string> {
  // Append. One query for the current end of the list beats a sequence, and a
  // personal track is tens of rows.
  const { data: last } = await supabase
    .from('readings')
    .select('position')
    .eq('track_id', input.trackId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = ((last as { position: number } | null)?.position ?? 0) + 10;

  const { data, error } = await supabase
    .from('readings')
    .insert({
      user_id: userId,
      track_id: input.trackId,
      source_id: null,
      title: input.title,
      why: input.why,
      position,
      concept_id: input.conceptId ?? null,
      locator_kind: 'whole',
      locator_basis: input.conceptId
        ? 'A gap in your graph, put in the queue. Nothing has been looked up for it yet.'
        : 'You wrote this down yourself. Nothing has been looked up for it.',
      locator_confidence: 'unverified',
    })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw messageFor('Adding that', error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

/**
 * Give a subject you wrote down something to read.
 *
 * Your own words stay as `readings.title` -- "how central banks set rates"
 * remains what the row is about -- and the source arrives beside it. That
 * combination is why the title column is allowed alongside a source rather
 * than only instead of one: the subject is yours, the source is an answer to
 * it, and losing the subject would lose why the row is in the track.
 *
 * The locator is written unverified, whatever the search believed. Nothing has
 * fetched the document yet; the locate pass does that when you open it, and it
 * is the only thing allowed to promote a locator.
 */
export async function attachSourceToReading(
  supabase: LearnSupabaseClient,
  userId: string,
  readingId: string,
  resolved: ResolvedSource,
): Promise<void> {
  const sourceId = await upsertSource(supabase, userId, resolved);

  const { error } = await supabase
    .from('readings')
    .update({
      source_id: sourceId,
      locator_kind: resolved.locator_kind,
      locator_label: resolved.locator_label ?? null,
      page_from: resolved.page_from ?? null,
      page_to: resolved.page_to ?? null,
      open_url: resolved.canonical_url ?? null,
      locator_confidence: 'unverified',
      locator_basis: resolved.locator_basis,
    })
    .eq('id', readingId);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Attaching the source', error);
}

/**
 * Delete a track and everything under it.
 *
 * The readings and the import go with it on the foreign keys, which is why
 * there is nothing to clean up here. Sources are left alone deliberately: they
 * are deduped across tracks, so removing one track must not take a work that
 * another track still points at, and an orphaned source costs a row nobody
 * sees.
 */
export async function deleteTrack(
  supabase: LearnSupabaseClient,
  trackId: string,
): Promise<void> {
  const { error } = await supabase.from('tracks').delete().eq('id', trackId);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Deleting the reading list', error);
}

/** Take a reading off a track. Only ever the one you asked for; RLS does the rest. */
export async function deleteReading(
  supabase: LearnSupabaseClient,
  readingId: string,
): Promise<void> {
  const { error } = await supabase.from('readings').delete().eq('id', readingId);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Removing that', error);
}

/**
 * Move a reading between statuses. The timestamps follow, in a trigger.
 *
 * Finishing or giving up also takes it off the Read now shelf. Here rather
 * than in the one action that has a shelf button beside it, because status is
 * changed from four places and a shelf still offering something you finished
 * last week is a shelf nobody trusts twice.
 */
export async function setReadingStatus(
  supabase: LearnSupabaseClient,
  readingId: string,
  status: 'queued' | 'reading' | 'read' | 'abandoned',
): Promise<void> {
  const done = status === 'read' || status === 'abandoned';

  const { error } = await supabase
    .from('readings')
    .update(done ? { status, read_now_at: null } : { status })
    .eq('id', readingId);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Updating the reading', error);
}

/**
 * Put a reading on the Read now shelf, or take it off.
 *
 * The stamp is the order of the shelf, so putting something back on moves it
 * to the end -- which is what you meant by putting it back on.
 */
export async function setReadNow(
  supabase: LearnSupabaseClient,
  readingId: string,
  on: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('readings')
    .update({ read_now_at: on ? new Date().toISOString() : null })
    .eq('id', readingId);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Changing the shelf', error);
}

/** What you took from it. */
export async function setReadingNote(
  supabase: LearnSupabaseClient,
  readingId: string,
  note: string,
): Promise<void> {
  const trimmed = note.trim();
  const { error } = await supabase
    .from('readings')
    .update({ note: trimmed === '' ? null : trimmed })
    .eq('id', readingId);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Saving your note', error);
}

/**
 * Write back what the locate pass established.
 *
 * The only path that may promote a locator it was handed, because it is the
 * only one that holds the document. The other way a reading can start out
 * verified is a segment queued from the catalogue, where the ingest held the
 * document and the anchor or the offsets came off it.
 */
export async function setReadingLocation(
  supabase: LearnSupabaseClient,
  readingId: string,
  location: {
    openUrl: string;
    textAnchor: string | null;
    locatorKind?: string;
    locatorLabel?: string | null;
    confidence: 'verified' | 'unverified';
    basis: string;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    open_url: location.openUrl,
    text_anchor: location.textAnchor,
    locator_confidence: location.confidence,
    locator_basis: location.basis,
  };
  if (location.locatorKind) patch.locator_kind = location.locatorKind;
  if (location.locatorLabel !== undefined) patch.locator_label = location.locatorLabel;

  const { error } = await supabase.from('readings').update(patch).eq('id', readingId);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Saving the location', error);
}

/** One confirmed row of a generated plan: a subject, and a source if one was found. */
export type PlanSaveRow = {
  subject: string;
  why: string | null;
  /** Null for a step the plan could not find anything to read for. */
  resolved: ResolvedSource | null;
};

/**
 * Write a confirmed plan onto a track that already exists.
 *
 * Not saveImport: there is no paste behind this and no track to create -- you
 * typed a topic, the track has been sitting there empty, and this fills it.
 * The rows append rather than replace, so a plan run on a track you had
 * already added to does not silently reorder what was there.
 *
 * A step with no source is still written. That is the point of the whole
 * generation path: the subject you would have to understand is worth having in
 * the queue even when nothing was found for it, and `readings.title` with a
 * null source is exactly the row addManualReading already writes -- you can
 * search for it later from its own page.
 */
export async function savePlan(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { trackId: string; rows: PlanSaveRow[] },
): Promise<number> {
  const { data: last } = await supabase
    .from('readings')
    .select('position')
    .eq('track_id', input.trackId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  let position = (last as { position: number } | null)?.position ?? 0;
  const readings: Record<string, unknown>[] = [];

  for (const row of input.rows) {
    const sourceId = row.resolved ? await upsertSource(supabase, userId, row.resolved) : null;
    readings.push({
      user_id: userId,
      track_id: input.trackId,
      source_id: sourceId,
      // Your subject stays yours whether or not something was found for it,
      // which is what keeps a sourced row explicable six weeks later.
      title: row.subject,
      position: (position += 10),
      locator_kind: row.resolved?.locator_kind ?? 'whole',
      locator_label: row.resolved?.locator_label ?? null,
      page_from: row.resolved?.page_from ?? null,
      page_to: row.resolved?.page_to ?? null,
      open_url: row.resolved?.canonical_url ?? null,
      locator_confidence: 'unverified',
      locator_basis:
        row.resolved?.locator_basis ??
        'Proposed for this topic; nothing was found to read for it yet.',
      why: row.why ?? row.resolved?.why ?? null,
    });
  }

  if (readings.length === 0) return 0;

  const { error } = await supabase.from('readings').insert(readings);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw messageFor('Saving the plan', error);

  return readings.length;
}
