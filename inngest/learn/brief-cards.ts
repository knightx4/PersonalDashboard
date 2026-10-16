import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { CardToWrite, WriteResult } from '@/lib/learn/feed/write-card';
import { readSections, readSubQuestions } from '@/lib/learn/briefs/model';
import {
  briefCardToWrite,
  briefSectionSources,
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
 * A brief under a goal (plan #2184.1) also has a card for each answered
 * sub-question, from its section, and every card it claims carries the goal.
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

type BriefJoin = {
  id: string;
  question: string;
  angle: string | null;
  status: string;
  archived_at: string | null;
  aim_id: string | null;
  sub_questions: unknown;
  sections: unknown;
  aim: { name: string } | { name: string }[] | null;
};
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
        'brief:briefs!readings_brief_fk(id, question, angle, status, archived_at, aim_id, sub_questions, sections, ' +
        'aim:aims!briefs_aim_fk(name))',
    )
    .not('brief_id', 'is', null);
  if (scope.userId) query = query.eq('user_id', scope.userId);
  if (scope.briefId) query = query.eq('brief_id', scope.briefId);
  const { data, error } = await query;
  if (error) throw new Error(`Reading the briefs' sources failed: ${error.message}`);
  const rows = (data ?? []) as unknown as ReadingRow[];
  const pages: BriefSource[] = [];
  const briefs = new Map<string, { brief: BriefJoin; userId: string; titles: Map<string, string> }>();
  for (const row of rows) {
    const brief = one(row.brief);
    if (!brief || brief.status !== 'ready' || brief.archived_at) continue;
    const title = row.title?.trim() || hostOf(row.open_url) || 'A source';
    const aimName = one(brief.aim)?.name ?? null;
    const aim = brief.aim_id && aimName ? { id: brief.aim_id, name: aimName } : null;
    pages.push({
      readingId: row.id,
      userId: row.user_id,
      briefId: row.brief_id,
      question: brief.question,
      angle: brief.angle ?? '',
      title,
      givenText: row.given_text,
      summary: row.summary,
      aim,
    });
    if (!aim) continue;
    const held = briefs.get(row.brief_id) ?? { brief, userId: row.user_id, titles: new Map<string, string>() };
    held.titles.set(row.id, title);
    briefs.set(row.brief_id, held);
  }
  const sections = [...briefs.values()].flatMap(({ brief, userId, titles }) => {
    const aimName = one(brief.aim)?.name ?? '';
    return briefSectionSources(
      {
        id: brief.id,
        userId,
        question: brief.question,
        angle: brief.angle ?? '',
        aim: { id: brief.aim_id!, name: aimName },
        subQuestions: readSubQuestions(brief.sub_questions),
        sections: readSections(brief.sections),
      },
      titles,
    );
  });
  // A goal's section cards first: they are the next cards on the goal.
  return [...sections, ...pages];
}

async function readStored(learn: LearnSupabaseClient, readingIds: string[]): Promise<StoredBriefCard[]> {
  if (readingIds.length === 0) return [];
  const { data, error } = await learn
    .from('feed_cards')
    .select('id, reading_id, status, idea_index')
    .eq('reason', 'researched')
    .in('reading_id', readingIds);
  if (error) throw new Error(`Reading the briefs' cards failed: ${error.message}`);
  return ((data ?? []) as { id: string; reading_id: string; status: string; idea_index: number }[]).map((row) => ({
    id: row.id,
    readingId: row.reading_id,
    status: row.status,
    ideaIndex: row.idea_index,
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
      idea_index: source.ideaIndex ?? 0,
      named_article: source.title,
      aim_id: source.aim?.id ?? null,
      aim_name: source.aim?.name ?? null,
      pick_basis: source.section
        ? `An answer from researching "${source.question.slice(0, 300)}": ${source.section.subQuestion.slice(0, 300)}`
        : `A source found researching "${source.question.slice(0, 300)}".`,
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
  const jobs = planBriefCards(sources, await readStored(learn, [...new Set(sources.map((source) => source.readingId))]));

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
