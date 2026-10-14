import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { pageUrl } from '@/lib/learn/essays/research';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createTrack } from '@/lib/learn/tracks/save';
import { writeCardsForBrief } from '@/inngest/learn/feed-top-up';
import type { BriefSection, BriefStage, SubQuestion } from './model';
import { BRIEF_COLUMNS, briefFromRow, type Brief, type BriefRow } from './model';
import { chooseReadings, SUB_QUESTIONS_MIN, type ChosenReading } from './research';
import { frameQuestion, gatherSources, writeBrief } from './research-model';

/**
 * Running a brief's research and writing what it found (plan #2023.2).
 *
 * The brief row exists before this runs, made by whatever starts it (Ask
 * Dash's research_topic tool, plan #2023.3, or Try again on the brief's page).
 * The run moves `stage` through framing, searching and writing so the page
 * can say where it is, saves the sub-questions as soon as they are framed
 * (or keeps the ones the brief was made with),
 * and ends with the brief ready, or failed with a reason the person can read.
 *
 * Each source becomes a reading on the brief's list (made here if the brief
 * has none) with its why line, its kind and the summary the search call wrote
 * of the page (summary_from 'link'). A page already on the list is reused, so
 * Try again does not add it twice.
 *
 * Never throws. Every call's cost is recorded under 'research-topic', even on
 * a run that fails partway.
 */

export type ResearchOutcome = { ok: true; readings: number; sections: number } | { ok: false; error: string };

/** How the run records what it spent. The default writes through the session's own client. */
export type RecordSpend = (userId: string, reports: SpendReport[]) => Promise<void>;

export const recordWithSession: RecordSpend = (userId, reports) => recordLearnSpend(userId, 'research-topic', reports);

/** What the person reads when a run fails, by the step it failed at. */
const FAILED = {
  key: 'Research needs the Anthropic key, which is not set on this deployment.',
  framing: 'Dash could not break the question down into sub-questions. Try again in a moment.',
  searching: 'Dash could not find and read sources on this question. Try again in a moment.',
  writing: 'Dash read sources but could not write an answer quoted from them. Try again in a moment.',
  saving: 'Dash found sources but could not save them to the reading list. Try again in a moment.',
} as const;

async function loadBrief(supabase: LearnSupabaseClient, briefId: string): Promise<Brief | null> {
  const { data, error } = await supabase.from('briefs').select(BRIEF_COLUMNS).eq('id', briefId).maybeSingle();
  if (error) throw new Error(`learn: reading the brief failed (${error.message})`);
  return data ? briefFromRow(data as unknown as BriefRow) : null;
}

async function updateBrief(supabase: LearnSupabaseClient, briefId: string, columns: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('briefs')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('id', briefId);
  if (error) throw new Error(`learn: updating the brief failed (${error.message})`);
}

function atStage(stage: BriefStage, extra: Record<string, unknown> = {}) {
  return { status: 'researching', stage, error: null, ...extra };
}

/** A source going on a brief's list: from the run, or from a weekly check with its line on what it changes. */
export type ReadingToSave = Omit<ChosenReading, 'page'> & { change?: string };

/**
 * Put the chosen sources on the list: one reading each, or the reading
 * already there for that link. Returns the reading id for each, in order.
 * The weekly check (plan #2023.8) saves its new sources the same way.
 */
export async function saveReadings(
  supabase: LearnSupabaseClient,
  userId: string,
  brief: Pick<Brief, 'id' | 'question'>,
  trackId: string,
  chosen: readonly ReadingToSave[],
): Promise<string[]> {
  const { data: existing, error: readError } = await supabase
    .from('readings')
    .select('id, open_url, position')
    .eq('track_id', trackId);
  if (readError) throw new Error(`learn: reading the list failed (${readError.message})`);
  const rows = (existing ?? []) as { id: string; open_url: string | null; position: number }[];
  const byUrl = new Map(rows.filter((r) => r.open_url).map((r) => [pageUrl(r.open_url!), r.id]));
  let position = rows.reduce((max, r) => Math.max(max, r.position), 0);

  const now = new Date().toISOString();
  const fresh = chosen.filter((c) => !byUrl.has(c.url));
  if (fresh.length > 0) {
    const { data, error } = await supabase
      .from('readings')
      .insert(
        fresh.map((c) => {
          position += 10;
          return {
            user_id: userId,
            track_id: trackId,
            source_id: null,
            title: c.title,
            why: c.why,
            position,
            open_url: c.url,
            locator_kind: 'whole',
            locator_basis: `Found by Dash researching "${brief.question.slice(0, 200)}". The whole page, as published.`,
            locator_confidence: 'unverified',
            brief_id: brief.id,
            found_at: now,
            found_kind: c.kind,
            ...(c.change ? { found_change: c.change } : {}),
            ...(c.summary
              ? { summary: c.summary, summary_at: now, summary_from: 'link', summary_label: c.url, summary_truncated: false }
              : {}),
          };
        }),
      )
      .select('id, open_url');
    if (error || !data) throw new Error(`learn: adding the readings failed (${error?.message ?? 'no rows'})`);
    for (const row of data as { id: string; open_url: string }[]) byUrl.set(pageUrl(row.open_url), row.id);
  }
  return chosen.map((c) => byUrl.get(c.url)!);
}

export async function researchBrief(
  supabase: LearnSupabaseClient,
  userId: string,
  briefId: string,
  options: { client?: Anthropic; recordSpend?: RecordSpend } = {},
): Promise<ResearchOutcome> {
  const spend = collectSpend();
  const record = options.recordSpend ?? recordWithSession;
  let failedAt: keyof typeof FAILED = 'framing';

  const fail = async (reason: keyof typeof FAILED, detail: string): Promise<ResearchOutcome> => {
    console.error(`[brief research] ${reason}`, detail);
    try {
      await updateBrief(supabase, briefId, { status: 'failed', stage: null, error: FAILED[reason] });
    } catch (error) {
      console.error('[brief research] marking failed', error instanceof Error ? error.message : error);
    }
    return { ok: false, error: FAILED[reason] };
  };

  try {
    const brief = await loadBrief(supabase, briefId);
    if (!brief) return { ok: false, error: 'That brief is not there any more.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!options.client && !apiKey) return await fail('key', 'ANTHROPIC_API_KEY is not set');
    const client = options.client ?? new Anthropic({ apiKey });

    // Ask Dash frames the question before it replies, so it can name the
    // sub-questions (plan #2023.3); a brief that has them keeps them.
    let subQuestions: SubQuestion[] = brief.subQuestions;
    if (subQuestions.length < SUB_QUESTIONS_MIN) {
      await updateBrief(supabase, briefId, atStage('framing'));
      const framed = await frameQuestion({ question: brief.question, angle: brief.angle, client, onSpend: spend.sink });
      if (!framed.ok) return await fail('framing', framed.detail);
      subQuestions = framed.subQuestions;
    }

    failedAt = 'searching';
    await updateBrief(supabase, briefId, atStage('searching', { sub_questions: subQuestions }));
    const gathered = await gatherSources({
      question: brief.question,
      angle: brief.angle,
      depth: brief.depth,
      subQuestions,
      client,
      onSpend: spend.sink,
    });
    if (!gathered.ok) return await fail('searching', gathered.detail);

    failedAt = 'writing';
    await updateBrief(supabase, briefId, atStage('writing'));
    const written = await writeBrief({
      question: brief.question,
      angle: brief.angle,
      subQuestions,
      pages: gathered.pages,
      client,
      onSpend: spend.sink,
    });
    if (!written.ok) return await fail('writing', written.detail);

    failedAt = 'saving';
    const chosen = chooseReadings({
      pages: gathered.pages,
      results: gathered.results,
      listed: gathered.listed,
      written,
      subQuestions,
    });
    const trackId =
      brief.trackId ??
      (await createTrack(supabase, userId, { title: brief.question.slice(0, 300), question: brief.question }));
    const readingIds = await saveReadings(supabase, userId, brief, trackId, chosen);
    const readingForPage = new Map<number, string>();
    chosen.forEach((c, i) => {
      if (c.page !== null) readingForPage.set(c.page, readingIds[i]);
    });

    const sections: BriefSection[] = written.sections.map((s) => ({
      sub_question_id: s.subQuestionId,
      position: s.position,
      citations: s.citations.flatMap((c) => {
        const readingId = readingForPage.get(c.page);
        return readingId ? [{ reading_id: readingId, quote: c.quote }] : [];
      }),
    }));

    await updateBrief(supabase, briefId, {
      status: 'ready',
      stage: null,
      error: null,
      track_id: trackId,
      sections,
      // An answer the person rewrote is theirs; a second run leaves it.
      ...(brief.shortAnswerBy === 'you' ? {} : { short_answer: written.shortAnswer, short_answer_by: 'dash' }),
    });
    return { ok: true, readings: chosen.length, sections: sections.length };
  } catch (error) {
    return await fail(failedAt, error instanceof Error ? error.message : String(error));
  } finally {
    await record(userId, spend.reports);
  }
}

/**
 * Research a brief once the response has gone, then write its sources into
 * Learn now cards. Called from a server action
 * or route handler, where `after` may still use the session's cookies for the
 * reads, the writes and the spend record. The route needs a maxDuration long
 * enough for three calls and up to ten searches, a few minutes.
 */
export function researchBriefAfterResponse(
  supabase: LearnSupabaseClient,
  userId: string,
  briefId: string,
  options: { recordSpend?: RecordSpend } = {},
): void {
  after(async () => {
    const outcome = await researchBrief(supabase, userId, briefId, options);
    // Each source becomes a Learn now card and a card in the brief's quick
    // read (plan #2023.6), written as soon as the brief is ready.
    if (outcome.ok && outcome.readings > 0) await writeCardsForBrief(userId, briefId);
  });
}
