import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  READY_BATCH,
  READY_LOW,
  READY_TARGET,
  runTopUpFor,
  type TopUpPorts,
  type TopUpSummary,
} from '@/lib/learn/feed/top-up';
import type { Depth } from '@/lib/learn/feed/depth';
import { nearbyIdeas, saveIdeas } from '@/lib/learn/feed/ideas-store';
import { WRITE_CARD_MODEL, writeCard, type CardToWrite, type IdeaCard, type WriteResult } from '@/lib/learn/feed/write-card';
import type { LearnOperation } from '@/lib/learn/spend';
import type { LessonTopUpSummary } from '@/lib/learn/lessons/top-up';
import { LAYOUT_RESERVE_MS, LESSON_HOLD_MS, lessonsWanted, writeLessonsFor } from '@/lib/learn/lessons/top-up';
import { linkAimTracks } from '@/lib/learn/lessons/aim-tracks';
import { goalTrackIds, notPlanLessons } from '@/lib/learn/feed/plan-lessons';
import { writeDuePieces, type PiecesPassSummary } from '@/lib/learn/lessons/pieces';
import { layOutPlans, type PlanLayoutSummary } from '@/lib/learn/lessons/plan-layout';
import { loadOutlinesDue, loadPlanLayoutsDue } from '@/lib/learn/lessons/plan-store';
import { addTeachBackCard } from '@/lib/learn/feed/teach-back-store';
import { writeVideoCards, type VideoCardPassResult } from '@/lib/learn/youtube/video-card-run';
import { writeClipCards, type ClipCardPassResult } from '@/lib/learn/clips/clip-card-run';
import { loadTranscript } from '@/lib/learn/youtube/transcripts';
import { writeClipNotes } from '@/lib/learn/feed/clip-note-run';
import { createFeedPicker, loadFeedFields, peopleToPickFor } from './feed-picks';
import { createLessonPorts } from './lesson-top-up';

/**
 * The Learn now top-up (plan #807, LEARN-NOW-SPEC "How cards are made").
 *
 * Tops each person up to about twenty ready cards. About four in five of the
 * cards it is short go to lessons for the concepts in the person's tracks
 * (plan #978, LEARN-LESSONS-SPEC; lesson-top-up.ts). The rest, and any the
 * lessons fall short of, are section cards: the picked rows in
 * `learn.feed_cards` written into cards, picking more sections from Wikipedia
 * first when the picked rows run out. Called hourly by pg_cron through
 * `/api/cron/feed-top-up` for every account with placed themes, and by the
 * feed page after a response for one person (`topUpFeedAfterResponse`).
 *
 * The service client bypasses RLS, so every read and write names the person.
 */

/** Time one hourly call spends. The route's limit is 300 seconds. */
export const FEED_TOP_UP_BUDGET_MS = 230_000;

/**
 * Time a top-up after a response spends. It runs inside `after()` on the
 * page's request, so it is kept well inside the page's own limit.
 */
export const FEED_TOP_UP_AFTER_RESPONSE_MS = 120_000;

/**
 * Time the video card pass may start writes in, from the start of the hourly
 * call. A write started just before it runs about half a minute past, and the
 * people after it have the rest of the budget.
 */
export const VIDEO_CARDS_MS = 60_000;

/**
 * Time the saved-clip pass (plan #1405) may start writes in, after the video
 * card pass's own minute. A person saves a few clips an hour, each one call.
 */
export const CLIP_CARDS_MS = 30_000;

/**
 * The pieces pass (plan #1140) is not started with less than this left: it
 * makes up to two Sonnet calls one after the other, each well under a minute.
 */
export const PIECES_RESERVE_MS = 60_000;

/** Goal tracks outlined in one run, at most. Each is one outline call. */
export const MAX_OUTLINES_PER_RUN = 2;

const OPERATION: LearnOperation = 'write-feed-card';
const EMBED_OPERATION: LearnOperation = 'embed-feed-ideas';
const CLIP_NOTE_OPERATION: LearnOperation = 'describe-card-clip';

/**
 * The columns that say what a card was picked for and from, copied from the
 * picked row onto the row for each further idea in its section.
 */
const PICK_COLUMNS =
  'reason, theme_id, theme_name, field_id, reading_id, item_id, segment_id, named_article, named_section, ' +
  'pick_basis, pick_model, depth, aim_id, aim_name, asked_phrase, asked_on, created_at';

/** What a ready card's row holds for one idea. */
function ideaColumns(idea: IdeaCard, index: number, conceptId: string | null, why: string, written_at: string) {
  return {
    status: 'ready',
    idea_name: idea.name,
    idea_index: index,
    concept_id: conceptId,
    takeaway: idea.takeaway,
    context: idea.context,
    hook: idea.hook,
    summary: idea.summary,
    example: idea.example,
    check_question: idea.question,
    check_answer: idea.answer,
    mentions: idea.mentions ?? [],
    why,
    write_model: WRITE_CARD_MODEL,
    written_at,
  };
}

type PickedRow = {
  id: string;
  segment_id: string | null;
  reason: 'interest' | 'gap' | 'goal' | 'queued' | 'asked';
  theme_name: string | null;
  aim_name: string | null;
  asked_phrase: string | null;
  asked_on: string | null;
  field_id: string | null;
  named_article: string | null;
  depth: Depth | null;
  item: { title: string } | null;
  segment: { heading: string | null; text: string } | null;
  field: { name: string; scope: string } | null;
};

async function countReady(learn: LearnSupabaseClient, userId: string): Promise<number> {
  // A goal's lessons are on its plan and not dealt (plan #1143), so they do
  // not count towards the twenty.
  const planLessons = notPlanLessons(await goalTrackIds(learn, userId));
  let query = learn
    .from('feed_cards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'ready')
    // Cards written before they carried a context paragraph are no longer
    // served as new, so they do not count towards the twenty (LEARN-NOW-SPEC,
    // "Cards after the first week").
    .not('context', 'is', null);
  if (planLessons) query = query.or(planLessons);
  const { count, error } = await query;
  if (error) throw new Error(`Counting your ready cards failed: ${error.message}`);
  return count ?? 0;
}

/** The fields this person has a theme placed in: a gap there is "untested". */
async function fieldsWrittenIn(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await learn
    .from('theme_fields')
    .select('field_id')
    .eq('user_id', userId)
    .not('field_id', 'is', null);
  if (error) throw new Error(`Reading where your themes sit failed: ${error.message}`);
  return new Set(((data ?? []) as { field_id: string }[]).map((row) => row.field_id));
}

async function loadPicked(
  learn: LearnSupabaseClient,
  userId: string,
  limit: number,
  written: Set<string>,
): Promise<CardToWrite[]> {
  const { data, error } = await learn
    .from('feed_cards')
    .select(
      'id, segment_id, reason, theme_name, aim_name, asked_phrase, asked_on, field_id, named_article, depth, ' +
        'item:catalogue_items!feed_cards_item_id_fkey(title), ' +
        'segment:catalogue_segments!feed_cards_segment_id_fkey(heading, text), ' +
        'field:area_fields!feed_cards_field_id_fkey(name, scope)',
    )
    .eq('user_id', userId)
    .eq('status', 'picked')
    // A card from a video stretch is written by the video card pass, which
    // has the transcript it needs (plan #1067).
    .neq('reason', 'video')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Reading your picked cards failed: ${error.message}`);

  return ((data ?? []) as unknown as PickedRow[]).flatMap((row): CardToWrite[] => {
    // A goal card has no field when its goal is not placed in one, and a
    // card asked for on a phrase (plan #1057) never has one.
    if (row.reason === 'queued' || !row.segment) return [];
    if (!row.field && row.reason !== 'goal' && row.reason !== 'asked') return [];
    return [
      {
        id: row.id,
        segmentId: row.segment_id,
        reason: row.reason,
        themeName: row.theme_name,
        aimName: row.aim_name,
        askedPhrase: row.asked_phrase,
        askedOn: row.asked_on,
        field: row.field,
        gap: row.reason === 'gap' ? (row.field_id && written.has(row.field_id) ? 'untested' : 'untouched') : null,
        article: row.item?.title ?? row.named_article ?? 'Wikipedia',
        section: row.segment.heading,
        text: row.segment.text,
        depth: row.depth,
      },
    ];
  });
}

type Context = {
  learn: LearnSupabaseClient;
  core: ReturnType<typeof createCoreServiceSupabase>;
  apiKey: string;
  pickFor: ReturnType<typeof createFeedPicker>;
};

async function createContext(): Promise<Context> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('The Learn now top-up needs ANTHROPIC_API_KEY to be set.');
  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();
  const pickFor = createFeedPicker({ learn, core, apiKey, fields: await loadFeedFields(learn) });
  return { learn, core, apiKey, pickFor };
}

/**
 * Write one picked row into its cards and store the outcome on the row.
 *
 * The top-up calls this for each picked row, and Make it a card (plan #1057)
 * calls it for the row it has just picked, so a card asked for on a phrase is
 * written the same way as any other. `record` is given what the writing call
 * and the embeddings cost, once, before the row is stored; each caller records
 * them under its own operations.
 */
export async function writePickedCard(
  learn: LearnSupabaseClient,
  apiKey: string,
  userId: string,
  card: CardToWrite,
  record: (spend: SpendReport[], embedSpend: SpendReport[]) => Promise<void>,
): Promise<WriteResult> {
  const spend: SpendReport[] = [];
  const embedSpend: SpendReport[] = [];

  const known = await nearbyIdeas(
    learn,
    userId,
    { segmentId: card.segmentId ?? null, article: card.article, heading: card.section, text: card.text },
    (report) => embedSpend.push(report),
  );
  const result = await writeCard({
    card: { ...card, known },
    anthropicApiKey: apiKey,
    onSpend: (report) => spend.push(report),
  });
  if (result.outcome === 'failed') {
    await record(spend, embedSpend);
    return result;
  }

  const written_at = new Date().toISOString();
  let outcome: WriteResult = result;
  let ideas: { idea: IdeaCard; conceptId: string | null }[] = [];
  if (result.outcome === 'ready') {
    const saved = await saveIdeas(
      learn,
      userId,
      { article: card.article, section: card.section },
      result.ideas,
      (report) => embedSpend.push(report),
    );
    ideas = result.ideas.flatMap((idea, index) => {
      const kept = saved[index] ?? { kind: 'unsaved' };
      if (kept.kind === 'duplicate') return [];
      return [{ idea, conceptId: kept.kind === 'new' ? kept.conceptId : null }];
    });
    if (ideas.length === 0) {
      const names = saved.flatMap((kept) => (kept.kind === 'duplicate' ? [kept.name] : []));
      outcome = { outcome: 'dropped', reason: `Every idea was one already held: ${names.join('; ')}.` };
    } else {
      outcome = { ...result, ideas: ideas.map((kept) => kept.idea) };
    }
  }
  await record(spend, embedSpend);

  const [first, ...rest] = ideas;
  const change =
    outcome.outcome === 'ready' && first && result.outcome === 'ready'
      ? ideaColumns(first.idea, 0, first.conceptId, result.why, written_at)
      : {
          status: 'dropped',
          drop_reason: outcome.outcome === 'dropped' ? outcome.reason : 'No idea was kept.',
          write_model: WRITE_CARD_MODEL,
          written_at,
        };
  // Only a row still picked: a second top-up running at the same time
  // may have written it already, and its card stands.
  const { data, error } = await learn
    .from('feed_cards')
    .update(change)
    .eq('id', card.id)
    .eq('user_id', userId)
    .eq('status', 'picked')
    .select(PICK_COLUMNS);
  if (error) return { outcome: 'failed', detail: `Saving the card failed: ${error.message}` };
  const picked = (data ?? [])[0] as unknown as Record<string, unknown> | undefined;
  if (!picked) return { outcome: 'failed', detail: 'Written by another run first.' };
  if (outcome.outcome !== 'ready' || result.outcome !== 'ready') return outcome;

  // The section's further ideas, each a card of its own on the same pick.
  let stored = 1;
  for (const [offset, kept] of rest.entries()) {
    const { error: insertError } = await learn.from('feed_cards').insert({
      ...picked,
      user_id: userId,
      ...ideaColumns(kept.idea, offset + 1, kept.conceptId, result.why, written_at),
    });
    if (insertError) console.error('[learn feed top-up] saving a further idea', insertError.message);
    else stored += 1;
  }
  return { ...outcome, ideas: outcome.ideas.slice(0, stored) };
}

async function topUpWith(
  context: Context,
  userId: string,
  options: { threshold: number; target?: number; deadline: number },
): Promise<TopUpSummary> {
  const { learn, core, apiKey, pickFor } = context;
  let written: Set<string> | null = null;

  const readyBefore = await countReady(learn, userId);
  const target = options.target ?? READY_TARGET;
  let lessons: LessonTopUpSummary | undefined;
  if (readyBefore < options.threshold) {
    // A learning goal without a track gets one first, so its lessons can be
    // chosen in this run (plan #972). No model call; the track's first unit
    // is written by the lesson top-up, as for any track with no curriculum.
    await linkAimTracks(learn, userId).catch((error: unknown) => {
      console.error('[learn feed top-up] goal tracks', error instanceof Error ? error.message : error);
    });
    lessons = await writeLessonsFor(createLessonPorts({ learn, core, apiKey }), {
      userId,
      wanted: lessonsWanted(target - readyBefore),
      deadline: options.deadline,
    }).catch((error: unknown): LessonTopUpSummary => {
      // A failure here leaves the whole shortfall to section cards.
      console.error('[learn feed top-up] lessons', error instanceof Error ? error.message : error);
      return {
        wanted: 0,
        chosen: 0,
        written: 0,
        dropped: [],
        failed: [error instanceof Error ? error.message : 'Writing lessons failed.'],
        floors: [],
        checks: [],
        added: [],
        laidOut: [],
        held: [],
        stopped: null,
      };
    });
  }

  // Each goal's plan is laid out ahead, a unit or two an hour, whether or not
  // the deck was short (plan #1143): its lessons no longer come through Learn
  // now, so nothing else would lay out its next unit. The lay-out port writes
  // the unit's pieces straight after.
  const lessonPorts = createLessonPorts({ learn, core, apiKey });

  // A goal's track with no outline yet gets it here too, whether or not the
  // deck was short (plan #1139). The lesson top-up above writes outlines only
  // when the deck is short, so a well-stocked deck left four goals without
  // one for days (check-back 4cb5457d). A failure holds the track for a day,
  // as the lesson top-up does. Before the plan pass, so it can lay out the
  // new units in the same run.
  if (options.deadline - Date.now() >= LAYOUT_RESERVE_MS) {
    const outlinesDue = await loadOutlinesDue(learn, userId, MAX_OUTLINES_PER_RUN).catch((error: unknown) => {
      console.error('[learn feed top-up] outlines', error instanceof Error ? error.message : error);
      return [];
    });
    for (const due of outlinesDue) {
      const result = await lessonPorts.outline(userId, due.subjectId);
      if (result.outcome !== 'failed') continue;
      console.error('[learn feed top-up] outlines', `${due.subjectName}: ${result.detail}`);
      await lessonPorts.hold(userId, due.subjectId, new Date(Date.now() + LESSON_HOLD_MS)).catch((error: unknown) => {
        console.error('[learn feed top-up] outlines', error instanceof Error ? error.message : error);
      });
    }
  }

  const plans: PlanLayoutSummary | null = await layOutPlans(
    {
      due: (id, limit) => loadPlanLayoutsDue(learn, id, limit),
      layOut: lessonPorts.layOut,
      hold: lessonPorts.hold,
      now: Date.now,
    },
    { userId, deadline: options.deadline },
  ).catch((error: unknown) => {
    console.error('[learn feed top-up] plans', error instanceof Error ? error.message : error);
    return null;
  });
  for (const detail of plans?.failed ?? []) console.error('[learn feed top-up] plans', detail);

  // Laid-out units of goal tracks with no pieces get theirs (plan #1140),
  // whether or not the deck was short: the pieces belong to the goal's plan,
  // and this pass is how units laid out before pieces existed get them.
  let pieces: PiecesPassSummary | undefined;
  if (options.deadline - Date.now() >= PIECES_RESERVE_MS) {
    pieces = await writeDuePieces(learn, core, userId, apiKey);
    for (const detail of pieces.failed) console.error('[learn feed top-up] pieces', detail);
  }

  const ports: TopUpPorts = {
    countReady: (id) => countReady(learn, id),
    loadPicked: async (id, limit) => {
      written ??= await fieldsWrittenIn(learn, id);
      return loadPicked(learn, id, limit, written);
    },
    pick: async (id, targets, deadline) => {
      const summary = await pickFor(id, { targets, deadline });
      return summary.picked.interest + summary.picked.gap + summary.picked.goal;
    },
    write: (id, card) =>
      writePickedCard(learn, apiKey, id, card, (spend, embedSpend) => keepCardSpend(core, id, spend, embedSpend)),
    now: Date.now,
  };

  // The threshold was checked above, before the lessons; the section cards
  // top up to the target whatever the lessons came to.
  const sections = await runTopUpFor(ports, {
    userId,
    threshold: lessons ? target : options.threshold,
    target,
    deadline: options.deadline,
  });
  // One card in ten, by default, asks you to explain an idea you kept (plan
  // #1054). No model call, so it runs whether or not anything was written.
  const teachBack = await addTeachBackCard(learn, userId).catch((error: unknown) => {
    console.error('[learn feed top-up] teach-back', error instanceof Error ? error.message : error);
    return null;
  });
  // The ready cards with a lecture clip get "In this video" (note cde86a10),
  // whether or not the deck was short, since the cards already in it need it.
  const clipNotes = await writeClipNotes(learn, userId, {
    apiKey,
    deadline: options.deadline,
    onSpend: (spend) => keepClipNoteSpend(core, userId, spend),
  }).catch((error: unknown) => {
    console.error('[learn feed top-up] clip notes', error instanceof Error ? error.message : error);
    return null;
  });
  const withTeach = {
    ...sections,
    ...(clipNotes && clipNotes.written + clipNotes.failed > 0 ? { clipNotes } : {}),
    ...(teachBack === 'added' ? { teachBack: true } : {}),
    ...(pieces && pieces.written + pieces.failed.length > 0 ? { pieces } : {}),
    ...(plans && plans.laidOut.length + plans.failed.length > 0 ? { plans } : {}),
  };
  if (!lessons) return withTeach;
  return { ...withTeach, readyBefore, skipped: false, lessons };
}

export type FeedTopUpResult = {
  videos: VideoCardPassResult | null;
  clips: ClipCardPassResult | null;
  people: TopUpSummary[];
};

/**
 * Spend for one card write, under the feed's own operations. Not named
 * record…Spend: lib/core/spend/action-graph.ts reads a call by that name as
 * a recorder whose arguments name the operation, and follows this one into
 * the recordSpend calls below instead.
 */
async function keepCardSpend(
  core: Context['core'],
  userId: string,
  spend: SpendReport[],
  embedSpend: SpendReport[],
): Promise<void> {
  // Awaited, so the rows land before the function is frozen.
  for (const report of spend) {
    await recordSpend(core, userId, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
  }
  for (const report of embedSpend) {
    await recordSpend(core, userId, { module: 'learn', operation: EMBED_OPERATION, model: report.model, usage: report.usage });
  }
}

/** Spend for one clip note, under its own operation. Not named record…Spend, as keepCardSpend. */
async function keepClipNoteSpend(core: Context['core'], userId: string, spend: SpendReport[]): Promise<void> {
  for (const report of spend) {
    await recordSpend(core, userId, {
      module: 'learn',
      operation: CLIP_NOTE_OPERATION,
      model: report.model,
      usage: report.usage,
    });
  }
}

/**
 * The hourly call. First the videos in everyone's card pile become cards
 * (plan #1067), whatever the deck holds, since the pile is a list of its own,
 * and then every clip saved since the last run (plan #1405).
 * Then everyone with placed themes or an active goal, and fewer than twenty
 * ready cards, is topped up, one person after another, inside one budget.
 */
export async function runFeedTopUp(): Promise<FeedTopUpResult> {
  const started = Date.now();
  const deadline = started + FEED_TOP_UP_BUDGET_MS;
  const context = await createContext();
  // A failure here leaves the pile for the next hour and the deck unaffected.
  const videos = await writeVideoCards(context.learn, {
    deadline: started + VIDEO_CARDS_MS,
    write: (userId, card) =>
      writePickedCard(context.learn, context.apiKey, userId, card, (spend, embedSpend) =>
        keepCardSpend(context.core, userId, spend, embedSpend),
      ),
  }).catch((error: unknown) => {
    console.error('[learn feed top-up] video cards', error instanceof Error ? error.message : error);
    return null;
  });
  // Saved clips become cards the same way, within the hour of the save.
  const clips = await writeClipCards(context.learn, {
    deadline: Date.now() + CLIP_CARDS_MS,
    write: (userId, card) =>
      writePickedCard(context.learn, context.apiKey, userId, card, (spend, embedSpend) =>
        keepCardSpend(context.core, userId, spend, embedSpend),
      ),
    transcript: (videoId) => loadTranscript(context.learn, videoId),
  }).catch((error: unknown) => {
    console.error('[learn feed top-up] clip cards', error instanceof Error ? error.message : error);
    return null;
  });
  const people: TopUpSummary[] = [];
  for (const userId of await peopleToPickFor(context.learn)) {
    if (Date.now() >= deadline) break;
    people.push(await topUpWith(context, userId, { threshold: READY_TARGET, deadline }));
  }
  return { videos, clips, people };
}

/**
 * Top up one person after a response on the feed page, when seven or fewer
 * cards are ready, by fifteen more. For the page's server action to call inside `after()`:
 *
 *   after(() => topUpFeedAfterResponse(user.id));
 *
 * Never throws: it runs after the response has gone, where an error has
 * nobody to reach, so a failure is logged and the hourly tick tries again.
 */
export async function topUpFeedAfterResponse(userId: string): Promise<TopUpSummary | null> {
  try {
    // One count first, so a response with plenty of cards ready costs no more.
    const ready = await countReady(createLearnServiceSupabase(), userId);
    if (ready >= READY_LOW) return null;
    const context = await createContext();
    return await topUpWith(context, userId, {
      threshold: READY_LOW,
      target: ready + READY_BATCH,
      deadline: Date.now() + FEED_TOP_UP_AFTER_RESPONSE_MS,
    });
  } catch (error) {
    console.error('[learn feed top-up]', error instanceof Error ? error.message : error);
    return null;
  }
}
