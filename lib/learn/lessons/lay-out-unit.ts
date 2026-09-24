import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { unitGoal } from '@/lib/learn/graph/curriculum-payload';
import { generateChain } from '@/lib/learn/graph/generate';
import { existingConcepts, saveChain } from '@/lib/learn/graph/save';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * Laying out a track's next unit when its ready concepts run out (plan #977,
 * LEARN-LESSONS-SPEC "The next lesson in a track").
 *
 * The same chain a person gets by opening a unit on the track page: one
 * `generateChain` call asked for the unit's title and outcome, saved with
 * `saveChain` and the unit's id. There is no approval screen, the same as
 * Test me on this (lib/learn/feed/test-me.ts), because nobody is looking.
 *
 * It runs from the background top-up with the service role, which bypasses
 * RLS, so every read here names the person and the track is checked to be
 * theirs before anything is written into it. `saveChain` is handed the track's
 * id rather than its name, because its lookup by name counts on RLS to see
 * only the person's own tracks.
 *
 * A track with every unit opened is left alone. Adding units as you go is a
 * later step (plan #969).
 */

const OPERATION: LearnOperation = 'generate-chain';

export type UnitToOpen = { id: string; ordinal: number; title: string; outcome: string };

export type FiledGoal = { unitId: string | null; status: string };

/**
 * The first unit, by ordinal, with no goal filed under it.
 *
 * An abandoned goal does not count, so a unit whose only goal was given up
 * reads as unopened, as it does on the track page. A goal whose chain named no
 * goal concept does count, unlike on the page: the chain was still written, and
 * counting it stops the top-up laying the same unit out again every hour.
 */
export function nextUnitToOpen<U extends { id: string; ordinal: number }>(
  units: readonly U[],
  goals: readonly FiledGoal[],
): U | null {
  const opened = new Set(
    goals.flatMap((goal) => (goal.unitId && goal.status !== 'abandoned' ? [goal.unitId] : [])),
  );
  const sorted = [...units].sort((a, b) => a.ordinal - b.ordinal);
  return sorted.find((unit) => !opened.has(unit.id)) ?? null;
}

export type LaidOutUnit =
  | { outcome: 'laid-out'; unitId: string; goalId: string | null; conceptIds: string[] }
  | { outcome: 'no-unit-left' }
  | { outcome: 'failed'; detail: string };

async function loadUnits(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<UnitToOpen[]> {
  const { data, error } = await learn
    .from('curriculum_units')
    .select('id, ordinal, title, outcome')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .order('ordinal');
  if (error) throw new Error(`Reading the curriculum failed: ${error.message}`);
  return (data ?? []) as UnitToOpen[];
}

async function loadFiledGoals(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<FiledGoal[]> {
  const { data, error } = await learn
    .from('goals')
    .select('unit_id, status')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .not('unit_id', 'is', null);
  if (error) throw new Error(`Reading the track's goals failed: ${error.message}`);
  return ((data ?? []) as { unit_id: string | null; status: string }[]).map((row) => ({
    unitId: row.unit_id,
    status: row.status,
  }));
}

/** The first unopened unit, read fresh. */
async function findNextUnit(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<UnitToOpen | null> {
  const [units, goals] = await Promise.all([
    loadUnits(learn, userId, subjectId),
    loadFiledGoals(learn, userId, subjectId),
  ]);
  return nextUnitToOpen(units, goals);
}

/**
 * Write the chain for the track's first unopened unit. Never throws.
 *
 * `core` is a service-role client on the core schema, for the spend ledger,
 * as the top-up in inngest/learn/feed-top-up.ts uses. The spend is recorded
 * whether or not the chain is saved.
 */
export async function layOutNextUnit(
  learn: LearnSupabaseClient,
  core: SpendClient,
  userId: string,
  subjectId: string,
  apiKey: string,
): Promise<LaidOutUnit> {
  try {
    const { data: subject, error: subjectError } = await learn
      .from('subjects')
      .select('id, name')
      .eq('id', subjectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (subjectError) throw new Error(`Reading the track failed: ${subjectError.message}`);
    if (!subject) return { outcome: 'failed', detail: 'No track of this person has that id.' };
    const name = (subject as { name: string }).name;

    const unit = await findNextUnit(learn, userId, subjectId);
    if (!unit) return { outcome: 'no-unit-left' };

    // Scoped by the track, which was just checked to be this person's.
    const existing = await existingConcepts(learn, subjectId);

    const spend: SpendReport[] = [];
    const result = await generateChain({
      goal: unitGoal(unit),
      subject: name,
      existing,
      anthropicApiKey: apiKey,
      onSpend: (report) => spend.push(report),
    });
    // Awaited, so the rows land before a background function is frozen.
    for (const report of spend) {
      await recordSpend(core, userId, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
    }
    if (!result.ok) return { outcome: 'failed', detail: result.detail };

    // The call takes a minute. A second top-up, or the person on the track
    // page, may have opened this unit meanwhile, and a second chain under it
    // would repeat the first.
    const still = await findNextUnit(learn, userId, subjectId);
    if (still?.id !== unit.id) {
      return { outcome: 'failed', detail: `The unit "${unit.title}" was opened while its chain was being written.` };
    }

    const saved = await saveChain(learn, userId, { ...result.chain, subject: name }, unitGoal(unit), {
      origin: 'generated',
      unitId: unit.id,
      subjectId,
    });
    return { outcome: 'laid-out', unitId: unit.id, goalId: saved.goalId, conceptIds: saved.conceptIds };
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Could not lay out the next unit.' };
  }
}
