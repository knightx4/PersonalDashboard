import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LessonPick } from '@/lib/learn/lessons/choose';
import { chooseLessonsFor } from '@/lib/learn/lessons/choose-load';
import { findLessonSource, type LessonSource } from '@/lib/learn/lessons/closest-source';
import { layOutNextUnit } from '@/lib/learn/lessons/lay-out-unit';
import { lessonWhy, type LessonOutcome, type LessonTopUpPorts } from '@/lib/learn/lessons/top-up';
import { WRITE_LESSON_MODEL, writeLesson } from '@/lib/learn/lessons/write-lesson';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * The real ports for writing Learn now lessons (plan #978), used by the
 * top-up in feed-top-up.ts. The service client bypasses RLS, so every read and
 * write here names the person.
 */

const WRITE_OPERATION: LearnOperation = 'write-lesson';
const EMBED_OPERATION: LearnOperation = 'embed-claim';

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

export function createLessonPorts(context: {
  learn: LearnSupabaseClient;
  core: SpendClient;
  apiKey: string;
}): LessonTopUpPorts {
  const { learn, core, apiKey } = context;

  const write = async (userId: string, pick: LessonPick): Promise<{ outcome: LessonOutcome; detail?: string }> => {
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
      if (error.code === UNIQUE_VIOLATION) return { outcome: 'failed', detail: 'Written by another run first.' };
      return { outcome: 'failed', detail: `Saving the lesson failed: ${error.message}` };
    }
    return result.outcome === 'ready' ? { outcome: 'ready' } : { outcome: 'dropped', detail: result.reason };
  };

  return {
    choose: (userId, slots) => chooseLessonsFor(learn, userId, slots),
    layOut: (userId, subjectId) => layOutNextUnit(learn, core, userId, subjectId, apiKey),
    hold: async (userId, subjectId, until) => {
      const { error } = await learn
        .from('subjects')
        .update({ lessons_held_until: until.toISOString() })
        .eq('id', subjectId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    write,
    now: Date.now,
  };
}
