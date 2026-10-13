import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedIdeaClaims } from '@/lib/learn/embed/idea-embedding';
import type { ReferenceCandidate } from '@/lib/learn/import/parse-heuristic';
import { resolveOneReference } from '@/lib/learn/import/resolve';
import type { ResolvedSource } from '@/lib/learn/import/resolve-payload';
import type { ChatSubject } from './subjects';

/**
 * What a Claude chat writes into Learn (plan #1809, #1810, #1811, #1812).
 *
 * Every function takes the service-role learn client the connector hands in
 * and the verified person's id, and names that person on every read and
 * write: the client passes no RLS, so the filter is the only thing keeping
 * one account's rows from another's. lib/learn/tracks/save.ts relies on RLS
 * for that, which is why its helpers are not called from here.
 *
 * A reading stands on its own and relates to subjects through
 * learn.reading_subjects. It still needs a list to sit on, because
 * readings.track_id is required and the Lists page is where the queue is
 * read, so readings from a chat go on one list, "From your conversations",
 * found by its title and made the first time, the way "From News" is.
 */

/** The reading list readings added from a chat go on. */
export const FROM_CHATS = 'From your conversations';

/** The most works one add takes, as the paste import caps a list. */
export const MAX_CHAT_ITEMS = 40;

/** readings.title and sources.title refuse more than this. */
const TITLE_MAX = 500;

/** Readings looked up at once, after a reply and in the hourly tick. */
const LOOKUP_CONCURRENCY = 3;

export type ChatItem = {
  title: string;
  author: string | null;
  url: string | null;
  why: string | null;
};

export type AddedReading = { id: string; title: string; added: boolean };

export type AddedReadings = { trackId: string; readings: AddedReading[] };

function failed(action: string, error: { message: string } | null): Error {
  return new Error(`${action} failed: ${error?.message ?? 'no row'}`);
}

function httpsOnly(url: string | null): string | null {
  return url && /^https:\/\/\S+$/.test(url) ? url : null;
}

/** The person's "From your conversations" list, made the first time. */
async function chatList(learn: LearnSupabaseClient, userId: string): Promise<string> {
  const { data: found, error } = await learn
    .from('tracks')
    .select('id')
    .eq('user_id', userId)
    .eq('title', FROM_CHATS)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw failed('Finding your conversations list', error);
  if (found) return (found as { id: string }).id;

  const { data, error: insertError } = await learn
    .from('tracks')
    .insert({
      user_id: userId,
      title: FROM_CHATS,
      question: 'What you asked to read, from your conversations with an assistant.',
    })
    .select('id')
    .single();
  if (insertError || !data) throw failed('Making your conversations list', insertError);
  return (data as { id: string }).id;
}

/** The person's source with this URL, or a new one. Deduped on the URL within the account. */
async function sourceFor(
  learn: LearnSupabaseClient,
  userId: string,
  source: Pick<ResolvedSource, 'title' | 'author' | 'kind' | 'year' | 'canonical_url' | 'access' | 'price_cents' | 'page_count'>,
): Promise<string> {
  const url = source.canonical_url ?? null;
  if (url) {
    const { data, error } = await learn
      .from('sources')
      .select('id')
      .eq('user_id', userId)
      .eq('canonical_url', url)
      .limit(1)
      .maybeSingle();
    if (error) throw failed('Looking up the source', error);
    if (data) return (data as { id: string }).id;
  }

  const { data, error } = await learn
    .from('sources')
    .insert({
      user_id: userId,
      title: source.title.slice(0, TITLE_MAX),
      author: source.author ?? null,
      kind: source.kind,
      year: source.year ?? null,
      canonical_url: url,
      access: source.access,
      price_cents: source.price_cents ?? null,
      page_count: source.page_count ?? null,
      access_checked_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw failed('Saving the source', error);
  return (data as { id: string }).id;
}

/** Relate readings to subjects. A pair already related is left as it is. */
async function relate(
  learn: LearnSupabaseClient,
  userId: string,
  readingIds: string[],
  subjects: readonly ChatSubject[],
): Promise<void> {
  const rows = readingIds.flatMap((readingId) =>
    subjects.map((subject) => ({ user_id: userId, reading_id: readingId, subject_id: subject.id })),
  );
  if (rows.length === 0) return;
  const { error } = await learn
    .from('reading_subjects')
    .upsert(rows, { onConflict: 'reading_id,subject_id', ignoreDuplicates: true });
  if (error) throw failed('Relating the readings to their subjects', error);
}

type ExistingReading = { id: string; title: string | null; source_title: string | null; status: string };

/** Every reading the person has, with its own title and its source's. */
async function allReadings(learn: LearnSupabaseClient, userId: string): Promise<ExistingReading[]> {
  const { data, error } = await learn
    .from('readings')
    .select('id, title, status, sources!readings_source_fk(title)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw failed('Reading your readings', error);
  return ((data ?? []) as unknown as {
    id: string;
    title: string | null;
    status: string;
    sources: { title: string } | { title: string }[] | null;
  }[]).map((row) => {
    const source = Array.isArray(row.sources) ? row.sources[0] : row.sources;
    return { id: row.id, title: row.title, source_title: source?.title ?? null, status: row.status };
  });
}

function sameTitle(a: string | null, b: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return a !== null && norm(a) === norm(b);
}

/**
 * Put the works from a chat on the person's queue, related to the subjects
 * given. A work already on any of their lists, by the same title, is not added
 * again: it is related to the subjects and reported as already there.
 *
 * Each new reading is written with its title and the recommender's reason,
 * and with `find_after` set so its link is looked up after the reply
 * (findChatLinks). A URL the chat gave is kept as its source straight away.
 */
export async function addChatReadings(
  learn: LearnSupabaseClient,
  userId: string,
  input: { items: readonly ChatItem[]; question: string | null; subjects: readonly ChatSubject[] },
): Promise<AddedReadings> {
  const trackId = await chatList(learn, userId);
  const existing = await allReadings(learn, userId);

  const { data: last } = await learn
    .from('readings')
    .select('position')
    .eq('user_id', userId)
    .eq('track_id', trackId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  let position = (last as { position: number } | null)?.position ?? 0;

  // Provenance, as the paste import keeps it: what the chat sent, and why.
  // `parsed` is the works as a list, which imports_parsed_is_array_ck
  // requires; the question goes at the top of the text.
  const lines = input.items.map((item) => [item.title, item.author, item.url, item.why].filter(Boolean).join(' | '));
  const { error: importError } = await learn.from('imports').insert({
    user_id: userId,
    track_id: trackId,
    raw_text: (input.question ? [`Question: ${input.question}`, ...lines] : lines).join('\n'),
    source_hint: 'conversation',
    parsed: input.items,
  });
  if (importError) throw failed('Recording what the chat sent', importError);

  const out: AddedReading[] = [];
  const now = new Date().toISOString();
  for (const item of input.items) {
    const title = item.title.trim().slice(0, TITLE_MAX);
    const already = existing.find(
      (row) => row.status !== 'abandoned' && (sameTitle(row.title, title) || sameTitle(row.source_title, title)),
    );
    if (already) {
      out.push({ id: already.id, title, added: false });
      continue;
    }

    const url = httpsOnly(item.url);
    const sourceId = url
      ? await sourceFor(learn, userId, {
          title,
          author: item.author,
          kind: 'page',
          year: null,
          canonical_url: url,
          access: 'unknown',
          price_cents: null,
          page_count: null,
        })
      : null;

    const { data, error } = await learn
      .from('readings')
      .insert({
        user_id: userId,
        track_id: trackId,
        source_id: sourceId,
        title,
        why: item.why?.trim().slice(0, 500) || null,
        position: (position += 10),
        locator_kind: 'whole',
        open_url: url,
        locator_confidence: 'unverified',
        locator_basis: 'Recommended in a chat you added it from. Where to read it is still being looked up.',
        find_after: now,
      })
      .select('id')
      .single();
    if (error || !data) throw failed(`Saving "${title}"`, error);
    const id = (data as { id: string }).id;
    existing.push({ id, title, source_title: null, status: 'queued' });
    out.push({ id, title, added: true });
  }

  await relate(learn, userId, [...new Set(out.map((row) => row.id))], input.subjects);
  return { trackId, readings: out };
}

type PendingReading = {
  id: string;
  user_id: string;
  title: string | null;
  why: string | null;
  open_url: string | null;
};

export type FoundLinks = { found: number; notFound: number; failed: number };

/**
 * Look up where each pending reading can be read, and the part to read
 * (#1810). Called after the reply with the readings just added, and by the
 * hourly tick with none named, for any whose lookup did not run.
 *
 * A reading is cleared of `find_after` once a lookup has answered, found or
 * not, so it is asked about once. A call that failed (a rate limit, a
 * timeout) leaves it set for the next tick.
 */
export async function findChatLinks(
  learn: LearnSupabaseClient,
  options: {
    /** Only these readings; absent, every pending reading of anyone's. */
    readingIds?: readonly string[];
    userId?: string;
    question?: string | null;
    anthropicApiKey: string | undefined;
    deadline: number;
    /** Told what each lookup cost, against the reading's owner. */
    onSpend: (userId: string, reports: SpendReport[]) => Promise<void>;
    /** At most this many readings, oldest first. */
    limit?: number;
  },
): Promise<FoundLinks> {
  const summary: FoundLinks = { found: 0, notFound: 0, failed: 0 };
  if (!options.anthropicApiKey) return summary;

  let query = learn
    .from('readings')
    .select('id, user_id, title, why, open_url')
    .not('find_after', 'is', null)
    .order('find_after', { ascending: true })
    .limit(options.limit ?? 60);
  if (options.userId) query = query.eq('user_id', options.userId);
  if (options.readingIds) query = query.in('id', [...options.readingIds]);
  const { data, error } = await query;
  if (error) throw failed('Reading the readings waiting on a link', error);
  const pending = ((data ?? []) as PendingReading[]).filter((row) => row.title);

  const apiKey = options.anthropicApiKey;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < pending.length && Date.now() < options.deadline) {
      const reading = pending[next++];
      const outcome = await findOne(learn, reading, apiKey, options);
      summary[outcome] += 1;
    }
  }
  await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
  return summary;
}

async function findOne(
  learn: LearnSupabaseClient,
  reading: PendingReading,
  apiKey: string,
  options: { question?: string | null; onSpend: (userId: string, reports: SpendReport[]) => Promise<void> },
): Promise<keyof FoundLinks> {
  const candidate: ReferenceCandidate = {
    raw: reading.title ?? '',
    title: reading.title ?? '',
    author: null,
    url: reading.open_url,
    why: reading.why,
  };
  const reports: SpendReport[] = [];
  const row = await resolveOneReference(candidate, {
    anthropicApiKey: apiKey,
    question: options.question ?? reading.why,
    onSpend: (report) => reports.push(report),
  });
  await options.onSpend(reading.user_id, reports).catch(() => undefined);

  // No answer at all: a failed call, tried again by the next tick.
  if (!row.resolved) return 'failed';

  const resolved = row.resolved;
  if (row.error || !resolved.canonical_url) {
    const { error } = await learn
      .from('readings')
      .update({
        find_after: null,
        locator_basis: `Looked for where to read this and found nothing to open. ${resolved.locator_basis}`.slice(0, 500),
      })
      .eq('id', reading.id)
      .eq('user_id', reading.user_id);
    return error ? 'failed' : 'notFound';
  }

  try {
    const sourceId = await sourceFor(learn, reading.user_id, resolved);
    const { error } = await learn
      .from('readings')
      .update({
        source_id: sourceId,
        locator_kind: resolved.locator_kind,
        locator_label: resolved.locator_label ?? null,
        page_from: resolved.page_from ?? null,
        page_to: resolved.page_to ?? null,
        open_url: resolved.canonical_url,
        // Never verified here: only the locate pass, which holds the document, promotes it.
        locator_confidence: 'unverified',
        locator_basis: resolved.locator_basis,
        find_after: null,
      })
      .eq('id', reading.id)
      .eq('user_id', reading.user_id);
    return error ? 'failed' : 'found';
  } catch (error) {
    console.error('[learn chat links]', error instanceof Error ? error.message : error);
    return 'failed';
  }
}

export type ReadingMatch = { id: string; title: string; status: string };

/** The words of a phrase, lowercased, for matching titles. */
function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The readings whose title, or whose source's title, holds every word given.
 * Ones not read yet come first, since that is what "I finished X" means.
 */
export async function findReadings(
  learn: LearnSupabaseClient,
  userId: string,
  phrase: string,
): Promise<ReadingMatch[]> {
  const wanted = words(phrase);
  if (wanted.length === 0) return [];
  const rows = await allReadings(learn, userId);
  const matches = rows.filter((row) => {
    const text = `${row.title ?? ''} ${row.source_title ?? ''}`.toLowerCase();
    return wanted.every((word) => text.includes(word));
  });
  const rank = (status: string) => (status === 'reading' ? 0 : status === 'queued' ? 1 : 2);
  return matches
    .sort((a, b) => rank(a.status) - rank(b.status))
    .map((row) => ({ id: row.id, title: row.title ?? row.source_title ?? 'Untitled', status: row.status }));
}

/**
 * Mark one reading read (#1812), with what they took from it as its note when
 * given. A note already on the reading is kept above the new one. Finishing
 * also takes it off the Read now shelf, as setReadingStatus does.
 */
export async function markChatReadingRead(
  learn: LearnSupabaseClient,
  userId: string,
  readingId: string,
  note: string | null,
): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }> {
  const { data: before, error: readError } = await learn
    .from('readings')
    .select('*')
    .eq('id', readingId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) throw failed('Reading that reading', readError);
  if (!before) throw new Error('There is no reading with that id.');

  const kept = (before as { note: string | null }).note?.trim();
  const added = note?.trim() || null;
  const patch: Record<string, unknown> = { status: 'read', read_now_at: null };
  if (added) patch.note = (kept ? `${kept}\n\n${added}` : added).slice(0, 4000);

  const { data: after, error } = await learn
    .from('readings')
    .update(patch)
    .eq('id', readingId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error || !after) throw failed('Marking it read', error);
  return { before: before as Record<string, unknown>, after: after as Record<string, unknown> };
}

export type ChatIdea = { name: string; claim: string };

export type LoggedSession = { id: string; conceptsAdded: number; conceptsKnown: number };

/**
 * Record what a conversation covered (#1811), and add the ideas it named to
 * the subject's graph as concepts with no state, which the graph reads as
 * unknown. An idea whose name the subject already has is not added twice.
 * Without a subject the session is still logged and no concept is made,
 * because a concept belongs to exactly one subject.
 */
export async function logChatSession(
  learn: LearnSupabaseClient,
  userId: string,
  input: {
    topic: string;
    question: string | null;
    summary: string;
    ideas: readonly ChatIdea[];
    subject: ChatSubject | null;
    /**
     * The essay this records (Finish, plan #1873). One entry is kept for an
     * essay: finishing it again updates that entry rather than adding another.
     */
    essayId?: string;
  },
): Promise<LoggedSession> {
  const row = {
    user_id: userId,
    subject_id: input.subject?.id ?? null,
    topic: input.topic,
    question: input.question,
    summary: input.summary,
    ideas: input.ideas,
  };
  let earlier: string | null = null;
  if (input.essayId) {
    const { data: found, error: findError } = await learn
      .from('learning_log')
      .select('id')
      .eq('user_id', userId)
      .eq('essay_id', input.essayId)
      .maybeSingle();
    if (findError) throw failed('Recording the session', findError);
    earlier = (found as { id: string } | null)?.id ?? null;
  }
  const { data, error } = earlier
    ? await learn.from('learning_log').update(row).eq('id', earlier).eq('user_id', userId).select('id').single()
    : await learn
        .from('learning_log')
        .insert({ ...row, essay_id: input.essayId ?? null })
        .select('id')
        .single();
  if (error || !data) throw failed('Recording the session', error);
  const id = (data as { id: string }).id;

  if (!input.subject || input.ideas.length === 0) return { id, conceptsAdded: 0, conceptsKnown: 0 };

  const { data: concepts, error: conceptError } = await learn
    .from('concepts')
    .select('name')
    .eq('user_id', userId)
    .eq('subject_id', input.subject.id)
    .limit(2000);
  if (conceptError) throw failed('Reading the subject’s ideas', conceptError);
  const known = new Set(((concepts ?? []) as { name: string }[]).map((row) => row.name.toLowerCase()));

  const fresh = input.ideas.filter((idea) => !known.has(idea.name.toLowerCase()));
  if (fresh.length > 0) {
    const basis = `Met in a conversation about ${input.topic}. Not tested yet.`.slice(0, 500);
    const vectors = await embedIdeaClaims(
      learn,
      userId,
      fresh.map((idea) => idea.claim),
    );
    const { error: insertError } = await learn.from('concepts').insert(
      fresh.map((idea, index) => ({
        user_id: userId,
        subject_id: input.subject!.id,
        name: idea.name,
        claim: idea.claim,
        basis,
        origin: 'conversation',
        ...vectors[index],
      })),
    );
    if (insertError) throw failed('Adding the ideas to the subject', insertError);
  }
  return { id, conceptsAdded: fresh.length, conceptsKnown: input.ideas.length - fresh.length };
}
