import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { CardToWrite, WriteResult } from '@/lib/learn/feed/write-card';
import {
  briefCardToWrite,
  planBriefCards,
  type BriefCardJob,
  type BriefSource,
  type StoredBriefCard,
} from '@/lib/learn/briefs/cards';

/**
 * Turning a ready brief's sources into Learn now cards (plan #2023.6).
 *
 * What to write is decided in lib/learn/briefs/cards.ts; this reads the
 * rows, claims each source as a picked card with the reason 'researched',
 * and hands it to the top-up's own writer (`writePickedCard`), which saves
 * the idea as a concept and fills the row in. A write that fails leaves the
 * row picked, and the hourly top-up writes it.
 *
 * Runs with the service client, so every read and write names the person.
 */

const CONCURRENCY = 3;

export type BriefCardPassResult = {
  written: number;
  dropped: number;
  failed: number;
  stopped: string | null;
};

type BriefJoin = { question: string; angle: string | null; status: string; archived_at: string | null };
type ReadingRow = {
  id: string;
  user_id: string;
  brief_id: string;
  title: string | null;
  open_url: string | null;
  given_text: string | null;
  summary: string | null;
  brief: BriefJoin | BriefJoin[] | null;
};

const one = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The sources on ready briefs: one person's, or one brief's, or everyone's. */
async function readSources(
  learn: LearnSupabaseClient,
  scope: { userId?: string; briefId?: string },
): Promise<BriefSource[]> {
  let query = learn
    .from('readings')
    .select(
      'id, user_id, brief_id, title, open_url, given_text, summary, ' +
        'brief:briefs!readings_brief_fk(question, angle, status, archived_at)',
    )
    .not('brief_id', 'is', null);
  if (scope.userId) query = query.eq('user_id', scope.userId);
  if (scope.briefId) query = query.eq('brief_id', scope.briefId);
  const { data, error } = await query;
  if (error) throw new Error(`Reading the briefs' sources failed: ${error.message}`);
  return ((data ?? []) as unknown as ReadingRow[]).flatMap((row): BriefSource[] => {
    const brief = one(row.brief);
    if (!brief || brief.status !== 'ready' || brief.archived_at) return [];
    const title = row.title?.trim() || hostOf(row.open_url) || 'A source';
    return [
      {
        readingId: row.id,
        userId: row.user_id,
        briefId: row.brief_id,
        question: brief.question,
        angle: brief.angle ?? '',
        title,
        givenText: row.given_text,
        summary: row.summary,
      },
    ];
  });
}

async function readStored(learn: LearnSupabaseClient, readingIds: string[]): Promise<StoredBriefCard[]> {
  if (readingIds.length === 0) return [];
  const { data, error } = await learn
    .from('feed_cards')
    .select('id, reading_id, status')
    .eq('reason', 'researched')
    .in('reading_id', readingIds);
  if (error) throw new Error(`Reading the briefs' cards failed: ${error.message}`);
  return ((data ?? []) as { id: string; reading_id: string; status: string }[]).map((row) => ({
    id: row.id,
    readingId: row.reading_id,
    status: row.status,
  }));
}

/** Claim a source as a picked card, or null when another run holds it. */
async function claim(learn: LearnSupabaseClient, source: BriefSource): Promise<string | null> {
  const { data, error } = await learn
    .from('feed_cards')
    .insert({
      user_id: source.userId,
      reason: 'researched',
      reading_id: source.readingId,
      idea_index: 0,
      named_article: source.title,
      pick_basis: `A source found researching "${source.question.slice(0, 300)}".`,
    })
    .select('id')
    .single();
  // Claimed by another run first: its card stands.
  if (error?.code === '23505') return null;
  if (error) throw new Error(`Claiming the source failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * One pass over the sources in scope: claim each that has no card and write
 * it, and write each still picked from a failed write, until the deadline.
 */
export async function writeBriefCards(
  learn: LearnSupabaseClient,
  options: {
    deadline: number;
    userId?: string;
    briefId?: string;
    /** Writes one claimed card; the top-up's writePickedCard with spend recorded. */
    write: (userId: string, card: CardToWrite) => Promise<WriteResult>;
  },
): Promise<BriefCardPassResult> {
  const result: BriefCardPassResult = { written: 0, dropped: 0, failed: 0, stopped: null };
  const sources = await readSources(learn, { userId: options.userId, briefId: options.briefId });
  const jobs = planBriefCards(sources, await readStored(learn, sources.map((source) => source.readingId)));

  const writeOne = async (job: BriefCardJob) => {
    const cardId = job.cardId ?? (await claim(learn, job.source));
    if (!cardId) return;
    const card = briefCardToWrite(job.source, cardId);
    if (!card) return;
    const written = await options.write(job.source.userId, card);
    if (written.outcome === 'ready') result.written += 1;
    else if (written.outcome === 'dropped') result.dropped += 1;
    else {
      result.failed += 1;
      console.error(`[brief cards] reading ${job.source.readingId}`, written.detail);
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      if (Date.now() >= options.deadline) {
        result.stopped = 'out of time; the next run carries on';
        return;
      }
      const job = jobs[next++]!;
      await writeOne(job).catch((error: unknown) => {
        result.failed += 1;
        console.error('[brief cards]', error instanceof Error ? error.message : error);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return result;
}
