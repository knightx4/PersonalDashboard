import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LessonPick } from '@/lib/learn/lessons/choose';
import { chooseLessonsFor } from '@/lib/learn/lessons/choose-load';
import { findLessonSource, type LessonSource } from '@/lib/learn/lessons/closest-source';
import { addLessonFloor, loadFloorsDue } from '@/lib/learn/lessons/add-floor';
import { addNextUnit } from '@/lib/learn/lessons/add-unit';
import { aimTrackFor, loadGoalTracks } from '@/lib/learn/lessons/aim-tracks';
import { ensureOutline } from '@/lib/learn/lessons/outline';
import { layOutNextUnit } from '@/lib/learn/lessons/lay-out-unit';
import { writeUnitPiecesRecorded } from '@/lib/learn/lessons/pieces';
import { unitCheckWhy, type UnitCheckDue } from '@/lib/learn/lessons/unit-check';
import { loadUnitForCheck } from '@/lib/learn/lessons/unit-check-store';
import { UNIT_CHECK_MODEL, writeUnitCheck } from '@/lib/learn/lessons/write-unit-check';
import { lessonWhy, type LessonOutcome, type LessonTopUpPorts } from '@/lib/learn/lessons/top-up';
import { WRITE_LESSON_MODEL, writeLesson } from '@/lib/learn/lessons/write-lesson';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * The real ports for writing Learn now lessons (plan #978), used by the
 * top-up in feed-top-up.ts. The service client bypasses RLS, so every read and
 * write here names the person.
 */

const WRITE_OPERATION: LearnOperation = 'write-lesson';
const EMBED_OPERATION: LearnOperation = 'embed-lesson-claim';
const CHECK_OPERATION: LearnOperation = 'write-unit-check';

/** Postgres's unique violation: another run stored a lesson for this concept first. */
const UNIQUE_VIOLATION = '23505';

type UnitRow = { title: string; outcome: string | null };

async function loadUnit(learn: LearnSupabaseClient, userId: string, unitId: string): Promise<UnitRow | null> {
  const { data, error } = await learn
    .from('curriculum_units')
    .select('title, outcome')
    .eq('id', unitId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the unit failed: ${error.message}`);
  return (data as UnitRow | null) ?? null;
}

/** The names of the concepts this one builds on. */
async function loadPrerequisites(learn: LearnSupabaseClient, userId: string, conceptId: string): Promise<string[]> {
  const { data: edges, error } = await learn
    .from('concept_edges')
    .select('prerequisite_id')
    .eq('user_id', userId)
    .eq('dependent_id', conceptId);
  if (error) throw new Error(`Reading what the concept builds on failed: ${error.message}`);
  const ids = ((edges ?? []) as { prerequisite_id: string }[]).map((edge) => edge.prerequisite_id);
  if (ids.length === 0) return [];
  const { data: concepts, error: conceptError } = await learn
    .from('concepts')
    .select('name')
    .eq('user_id', userId)
    .in('id', ids)
    .order('name');
  if (conceptError) throw new Error(`Reading what the concept builds on failed: ${conceptError.message}`);
  return ((concepts ?? []) as { name: string }[]).map((concept) => concept.name);
}

/** What writing one lesson needs to know about its concept and track. */
export type LessonToStore = Pick<LessonPick, 'subjectId' | 'subjectName' | 'unitId'> & {
  concept: Pick<LessonPick['concept'], 'id' | 'name' | 'claim' | 'mastery'>;
};

/**
 * Write one concept's lesson and store it as a `lesson` card (plan #978).
 * The top-up calls it for the chooser's picks, and a piece's page for an idea
 * of the piece with no lesson yet (plan #1141). A lesson the model would not
 * write is stored as dropped, so it is not paid for again; a call that failed
 * stores nothing. `already` is the unique index refusing a second lesson for
 * the concept, written by another run or another tab first.
 */
export async function writeLessonCard(
  context: { learn: LearnSupabaseClient; core: SpendClient; apiKey: string },
  userId: string,
  pick: LessonToStore,
): Promise<{ outcome: LessonOutcome | 'already'; detail?: string }> {
  const { learn, core, apiKey } = context;
  const [unit, prerequisites] = await Promise.all([
    loadUnit(learn, userId, pick.unitId),
    loadPrerequisites(learn, userId, pick.concept.id),
  ]);

  const writeSpend: SpendReport[] = [];
  const embedSpend: SpendReport[] = [];
  const record = async () => {
    // Awaited, so the rows land before the function is frozen.
    for (const report of writeSpend) {
      await recordSpend(core, userId, { module: 'learn', operation: WRITE_OPERATION, model: report.model, usage: report.usage });
    }
    for (const report of embedSpend) {
      await recordSpend(core, userId, { module: 'learn', operation: EMBED_OPERATION, model: report.model, usage: report.usage });
    }
  };

  const found: LessonSource | null = await findLessonSource(learn, pick.concept.claim, {
    onSpend: (report) => embedSpend.push(report),
  });
  const result = await writeLesson({
    lesson: {
      concept: { name: pick.concept.name, claim: pick.concept.claim, mastery: pick.concept.mastery },
      trackName: pick.subjectName,
      unit: unit ? { title: unit.title, outcome: unit.outcome } : null,
      prerequisites,
      source: found,
    },
    anthropicApiKey: apiKey,
    onSpend: (report) => writeSpend.push(report),
  });
  await record();
  // Nothing is stored, so the concept is chosen again on a later run.
  if (result.outcome === 'failed') return { outcome: 'failed', detail: result.detail };

  // The source the lesson named is the one it was given; its item comes from there.
  const cited = result.source && found?.segmentId === result.source.segmentId ? found : null;
  const row: Record<string, unknown> = {
    user_id: userId,
    reason: 'lesson',
    subject_id: pick.subjectId,
    concept_id: pick.concept.id,
    track_name: pick.subjectName,
    unit_id: pick.unitId,
    unit_title: unit?.title ?? null,
    source_item_id: cited?.itemId ?? null,
    source_segment_id: cited?.segmentId ?? null,
    idea_name: pick.concept.name,
    idea_index: 0,
    write_model: WRITE_LESSON_MODEL,
    written_at: new Date().toISOString(),
    ...(result.outcome === 'ready'
      ? {
          status: 'ready',
          takeaway: result.card.takeaway,
          context: result.card.context,
          hook: result.card.hook,
          summary: result.card.summary,
          example: result.card.example,
          check_question: result.card.question,
          check_answer: result.card.answer,
          why: lessonWhy(pick.subjectName, prerequisites),
        }
      : { status: 'dropped', drop_reason: result.reason }),
  };
  const { error } = await learn.from('feed_cards').insert(row);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { outcome: 'already', detail: 'Written by another run first.' };
    return { outcome: 'failed', detail: `Saving the lesson failed: ${error.message}` };
  }
  return result.outcome === 'ready' ? { outcome: 'ready' } : { outcome: 'dropped', detail: result.reason };
}

export function createLessonPorts(context: {
  learn: LearnSupabaseClient;
  core: SpendClient;
  apiKey: string;
}): LessonTopUpPorts {
  const { learn, core, apiKey } = context;

  const write = async (userId: string, pick: LessonPick): Promise<{ outcome: LessonOutcome; detail?: string }> => {
    const result = await writeLessonCard(context, userId, pick);
    return result.outcome === 'already' ? { outcome: 'failed', detail: result.detail } : { outcome: result.outcome, detail: result.detail };
  };

  /**
   * The check for a done unit (plan #971). A check the model would not write
   * is stored as dropped, so the unit is not offered one again every hour; a
   * call that failed stores nothing, and a later run tries again.
   */
  const writeCheck = async (userId: string, due: UnitCheckDue): Promise<{ outcome: LessonOutcome; detail?: string }> => {
    const unit = await loadUnitForCheck(learn, userId, {
      unitId: due.unitId,
      trackName: due.subjectName,
      conceptIds: due.conceptIds,
    });
    if (!unit) return { outcome: 'failed', detail: 'The unit is no longer there.' };

    const spend: SpendReport[] = [];
    const result = await writeUnitCheck({ unit, anthropicApiKey: apiKey, onSpend: (report) => spend.push(report) });
    for (const report of spend) {
      await recordSpend(core, userId, { module: 'learn', operation: CHECK_OPERATION, model: report.model, usage: report.usage });
    }
    if (result.outcome === 'failed') return { outcome: 'failed', detail: result.detail };

    const { error } = await learn.from('feed_cards').insert({
      user_id: userId,
      reason: 'unit_check',
      subject_id: due.subjectId,
      track_name: due.subjectName,
      unit_id: due.unitId,
      unit_title: unit.title,
      check_concept_ids: due.conceptIds,
      write_model: UNIT_CHECK_MODEL,
      written_at: new Date().toISOString(),
      ...(result.outcome === 'ready'
        ? {
            status: 'ready',
            why: unitCheckWhy(due.subjectName),
            // The deck reads a card as ready only with a context and a hook,
            // so the check carries its outcome and its question in both.
            context: unit.outcome?.trim() || unit.title,
            summary: unit.outcome?.trim() || unit.title,
            hook: result.question,
            check_question: result.question,
            check_answer: result.expected,
          }
        : { status: 'dropped', drop_reason: result.reason }),
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { outcome: 'failed', detail: 'Written by another run first.' };
      return { outcome: 'failed', detail: `Saving the check failed: ${error.message}` };
    }
    return result.outcome === 'ready' ? { outcome: 'ready' } : { outcome: 'dropped', detail: result.reason };
  };

  return {
    choose: (userId, slots) => chooseLessonsFor(learn, userId, slots),
    layOut: async (userId, subjectId) => {
      const result = await layOutNextUnit(learn, core, userId, subjectId, apiKey);
      // A goal's unit is split into pieces as soon as its ideas are laid out
      // (plan #1140). A failure here leaves it to the pieces pass, which finds
      // laid-out units without pieces on a later run.
      if (result.outcome === 'laid-out') {
        const goalTracks = await loadGoalTracks(learn, userId).catch(() => new Set<string>());
        if (goalTracks.has(subjectId)) {
          const pieces = await writeUnitPiecesRecorded(learn, core, userId, { subjectId, unitId: result.unitId }, apiKey);
          if (pieces.outcome === 'failed') console.error('[learn lesson top-up] pieces', pieces.detail);
        }
      }
      return result;
    },
    addUnit: (userId, subjectId, lastUnitId) => addNextUnit(learn, core, userId, subjectId, lastUnitId, apiKey),
    outline: async (userId, subjectId) => {
      const track = await aimTrackFor(learn, userId, subjectId);
      if (!track) return { outcome: 'failed', detail: 'The track is no longer an open goal.' };
      const spend: SpendReport[] = [];
      const result = await ensureOutline(learn, userId, track, apiKey, (report) => spend.push(report));
      // Awaited, so the rows land before a background function is frozen.
      for (const report of spend) {
        await recordSpend(core, userId, { module: 'learn', operation: 'write-outline', model: report.model, usage: report.usage });
      }
      return result;
    },
    hold: async (userId, subjectId, until) => {
      const { error } = await learn
        .from('subjects')
        .update({ lessons_held_until: until.toISOString() })
        .eq('id', subjectId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    floorsDue: (userId, limit) => loadFloorsDue(learn, userId, limit),
    addFloor: (userId, due) => addLessonFloor(learn, core, userId, due, apiKey),
    writeCheck,
    write,
    now: Date.now,
  };
}
