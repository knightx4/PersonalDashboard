import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadCurriculum } from '@/lib/learn/graph/curriculum-store';
import { loadGoals, loadGraph } from '@/lib/learn/graph/load';
import type { LearnOperation } from '@/lib/learn/spend';
import { loadGoalTracks } from './aim-tracks';
import { numberIdeas, unitIdeas } from './pieces-payload';
import { PIECES_MODEL, writePieces } from './write-pieces';

/**
 * Writing and finding a goal track's pieces (plan #1140, LEARN-LESSONS-SPEC
 * "A goal's units are split into pieces").
 *
 * A unit of a learning goal's track gets its pieces once its ideas are laid
 * out. Two callers: the top-up's lay-out port, straight after it lays a goal
 * track's unit out, and the top-up's pass over every goal track, which finds
 * laid-out units with no pieces whichever way they were laid out (the top-up,
 * or the person opening the unit on the track page) and writes up to
 * `MAX_PIECES_PER_RUN` of them. The pass is how units laid out before pieces
 * existed get theirs.
 *
 * Both run with the service role, so every read and write names the person.
 */

const OPERATION: LearnOperation = 'write-plan-pieces';

/** Units split into pieces in one pass, at most. Each is one Sonnet call. */
export const MAX_PIECES_PER_RUN = 2;

/** Postgres's unique violation: another run wrote this unit's pieces first. */
const UNIQUE_VIOLATION = '23505';

export type PiecesDue = { subjectId: string; unitId: string };

export type PiecesOutcome =
  | { outcome: 'written'; pieces: number }
  /** The unit already has pieces, or another run wrote them first. */
  | { outcome: 'already' }
  /** The unit has no ideas of its own laid out, so there is nothing to split. */
  | { outcome: 'nothing' }
  | { outcome: 'failed'; detail: string };

/** Units of these tracks that already have pieces. */
async function unitsWithPieces(
  learn: LearnSupabaseClient,
  userId: string,
  subjectIds: readonly string[],
): Promise<Set<string>> {
  const { data, error } = await learn
    .from('plan_pieces')
    .select('unit_id')
    .eq('user_id', userId)
    .in('subject_id', [...subjectIds]);
  if (error) throw new Error(`Reading which units have pieces failed: ${error.message}`);
  return new Set(((data ?? []) as { unit_id: string }[]).map((row) => row.unit_id));
}

/**
 * Laid-out units of the person's goal tracks with no pieces, in track order,
 * at most `limit`. A unit counts as laid out when a goal that is not
 * abandoned and named an idea is filed under it; one whose ideas all belong
 * to earlier units is skipped here and again by `writeUnitPieces`, which
 * reads the graph.
 */
export async function loadPiecesDue(
  learn: LearnSupabaseClient,
  userId: string,
  limit: number = MAX_PIECES_PER_RUN,
): Promise<PiecesDue[]> {
  const tracks = [...(await loadGoalTracks(learn, userId))];
  if (tracks.length === 0 || limit <= 0) return [];

  const [goals, units, done] = await Promise.all([
    learn
      .from('goals')
      .select('subject_id, unit_id')
      .eq('user_id', userId)
      .in('subject_id', tracks)
      .neq('status', 'abandoned')
      .not('unit_id', 'is', null)
      .not('concept_id', 'is', null),
    learn
      .from('curriculum_units')
      .select('id, subject_id, ordinal')
      .eq('user_id', userId)
      .in('subject_id', tracks)
      .order('ordinal'),
    unitsWithPieces(learn, userId, tracks),
  ]);
  if (goals.error) throw new Error(`Reading the goal tracks' goals failed: ${goals.error.message}`);
  if (units.error) throw new Error(`Reading the goal tracks' units failed: ${units.error.message}`);

  const laidOut = new Set(((goals.data ?? []) as { unit_id: string }[]).map((row) => row.unit_id));
  const order = new Map(tracks.map((id, index) => [id, index]));
  return ((units.data ?? []) as { id: string; subject_id: string; ordinal: number }[])
    .filter((unit) => laidOut.has(unit.id) && !done.has(unit.id))
    .sort((a, b) => order.get(a.subject_id)! - order.get(b.subject_id)! || a.ordinal - b.ordinal)
    .slice(0, limit)
    .map((unit) => ({ subjectId: unit.subject_id, unitId: unit.id }));
}

/**
 * Split one unit into pieces, when it has none. Never throws. The spend goes
 * to `onSpend`, reported whether or not the pieces are saved.
 */
export async function writeUnitPieces(
  learn: LearnSupabaseClient,
  userId: string,
  due: PiecesDue,
  apiKey: string | undefined,
  onSpend?: (report: SpendReport) => void,
): Promise<PiecesOutcome> {
  try {
    const { data: subject, error: subjectError } = await learn
      .from('subjects')
      .select('id, name')
      .eq('id', due.subjectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (subjectError) throw new Error(`Reading the track failed: ${subjectError.message}`);
    if (!subject) return { outcome: 'failed', detail: 'No track of this person has that id.' };
    const trackName = (subject as { name: string }).name;

    if ((await unitsWithPieces(learn, userId, [due.subjectId])).has(due.unitId)) return { outcome: 'already' };

    const [graph, goals, units] = await Promise.all([
      loadGraph(learn, due.subjectId, userId),
      loadGoals(learn, due.subjectId, userId),
      loadCurriculum(learn, due.subjectId, userId),
    ]);
    const unit = units.find((one) => one.id === due.unitId);
    if (!unit) return { outcome: 'failed', detail: 'The unit is no longer on its track.' };
    const ideas = unitIdeas({ units, goals, graph }, due.unitId);
    if (ideas.length === 0) return { outcome: 'nothing' };
    if (!apiKey) return { outcome: 'failed', detail: 'Writing pieces needs ANTHROPIC_API_KEY to be set.' };

    const result = await writePieces({
      trackName,
      unit,
      ideas: numberIdeas(ideas, graph),
      anthropicApiKey: apiKey,
      onSpend,
    });
    if (!result.ok) return { outcome: 'failed', detail: result.detail };

    const { error } = await learn.from('plan_pieces').insert(
      result.pieces.map((piece, index) => ({
        user_id: userId,
        subject_id: due.subjectId,
        unit_id: due.unitId,
        ordinal: index + 1,
        title: piece.title,
        concept_ids: piece.ideas.map((number) => ideas[number - 1]!.id),
        write_model: PIECES_MODEL,
      })),
    );
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { outcome: 'already' };
      return { outcome: 'failed', detail: `Saving the pieces failed: ${error.message}` };
    }
    return { outcome: 'written', pieces: result.pieces.length };
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Could not write the pieces.' };
  }
}

/** `writeUnitPieces`, with its spend recorded in the ledger before it returns. */
export async function writeUnitPiecesRecorded(
  learn: LearnSupabaseClient,
  core: SpendClient,
  userId: string,
  due: PiecesDue,
  apiKey: string | undefined,
): Promise<PiecesOutcome> {
  const spend: SpendReport[] = [];
  const result = await writeUnitPieces(learn, userId, due, apiKey, (report) => spend.push(report));
  // Awaited, so the rows land before a background function is frozen.
  for (const report of spend) {
    await recordSpend(core, userId, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
  }
  return result;
}

export type PiecesPassSummary = { written: number; failed: string[] };

/** Laid-out units read per pass, most of which are usually skipped for having no ideas of their own. */
const DUE_READ = 20;

/**
 * The top-up's pass: pieces for up to `MAX_PIECES_PER_RUN` laid-out units of
 * the person's goal tracks that have none. One unit at a time, so a unit with
 * nothing of its own to split, which costs no call, does not use up a place.
 * Never throws.
 */
export async function writeDuePieces(
  learn: LearnSupabaseClient,
  core: SpendClient,
  userId: string,
  apiKey: string | undefined,
): Promise<PiecesPassSummary> {
  const summary: PiecesPassSummary = { written: 0, failed: [] };
  try {
    let calls = 0;
    for (const due of await loadPiecesDue(learn, userId, DUE_READ)) {
      if (calls >= MAX_PIECES_PER_RUN) break;
      const result = await writeUnitPiecesRecorded(learn, core, userId, due, apiKey);
      if (result.outcome === 'written') summary.written += 1;
      else if (result.outcome === 'failed') summary.failed.push(result.detail);
      if (result.outcome === 'written' || result.outcome === 'failed') calls += 1;
    }
  } catch (error) {
    summary.failed.push(error instanceof Error ? error.message : 'Finding units without pieces failed.');
  }
  return summary;
}
