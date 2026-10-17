import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadGradeMap, territoryOf } from '@/lib/learn/levels/loader-grade';
import { readCells } from '@/lib/learn/levels/model';
import { matchPieceCells } from './match-piece-cells';
import { toCellPieceCheck, type CellCheckRow, type PieceCheck } from './piece-check';
import { territoryCells, type PieceCellView, type PieceToMatch, type TerritoryCell } from './piece-cells';

/**
 * The reads and writes behind a piece's cells (plan #2138.13). Run with the
 * service role by the pieces pass and with the person's session by the
 * piece's page, so every query names the person, and reads of the shared
 * territory go through `territoryOf`.
 */

/**
 * The cells a track's goal reaches: every approved topic on the lens of the
 * track's subject, which its learning goals read too (plan #2302.3), up to
 * the target that lens sets. Empty before any topic is on it.
 */
export async function loadTrackTerritory(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<TerritoryCell[]> {
  const { data: lenses, error: lensError } = await learn
    .from('lenses')
    .select('id')
    .eq('user_id', userId)
    .eq('subject_id', subjectId);
  if (lensError) throw new Error(`Reading the track's lenses failed: ${lensError.message}`);
  const lensIds = ((lenses ?? []) as { id: string }[]).map((row) => row.id);
  if (lensIds.length === 0) return [];

  const { data: targets, error: targetError } = await learn
    .from('lens_targets')
    .select('topic_id, target_level')
    .eq('user_id', userId)
    .in('lens_id', lensIds);
  if (targetError) throw new Error(`Reading the track's targets failed: ${targetError.message}`);
  const targetRows = (targets ?? []) as { topic_id: string; target_level: number }[];
  const topicIds = [...new Set(targetRows.map((row) => row.topic_id))];
  if (topicIds.length === 0) return [];

  const [topics, cells] = await Promise.all([
    learn.from('topics').select('id, name').or(territoryOf(userId)).eq('status', 'approved').in('id', topicIds),
    learn.from('topic_cells').select('id, topic_id, level, descriptor').or(territoryOf(userId)).in('topic_id', topicIds),
  ]);
  if (topics.error) throw new Error(`Reading the track's topics failed: ${topics.error.message}`);
  if (cells.error) throw new Error(`Reading the track's levels failed: ${cells.error.message}`);
  const names = new Map(((topics.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

  return territoryCells(
    targetRows.map((row) => ({ topicId: row.topic_id, targetLevel: row.target_level })),
    ((cells.data ?? []) as { id: string; topic_id: string; level: number; descriptor: string[] | null }[])
      .filter((cell) => names.has(cell.topic_id))
      .map((cell) => ({
        id: cell.id,
        topicId: cell.topic_id,
        topicName: names.get(cell.topic_id)!,
        level: cell.level,
        descriptor: cell.descriptor ?? [],
      })),
  );
}

export type PieceCellsMatch =
  /** One list per piece, and whether they were matched against a territory. */
  | { matched: true; cells: string[][] }
  /** No territory yet, or the call failed: the pieces keep empty lists for the next pass. */
  | { matched: false; detail: string | null };

/** Match a unit's pieces to its track's territory. Never throws. */
export async function matchUnitPieces(
  learn: LearnSupabaseClient,
  userId: string,
  input: { subjectId: string; trackName: string; unitTitle: string; pieces: readonly PieceToMatch[] },
  apiKey: string,
  onSpend?: SpendSink,
): Promise<PieceCellsMatch> {
  try {
    const territory = await loadTrackTerritory(learn, userId, input.subjectId);
    if (territory.length === 0) return { matched: false, detail: null };
    const result = await matchPieceCells({
      trackName: input.trackName,
      unitTitle: input.unitTitle,
      pieces: input.pieces,
      cells: territory,
      anthropicApiKey: apiKey,
      onSpend,
    });
    if (!result.ok) return { matched: false, detail: result.detail };
    return { matched: true, cells: result.cells };
  } catch (error) {
    return { matched: false, detail: error instanceof Error ? error.message : 'Matching the pieces failed.' };
  }
}

/** Units at most whose pieces are matched to cells in one pass. Each is one Haiku call. */
export const MAX_CELL_FILLS_PER_RUN = 2;

/**
 * Pieces written before their goal had a territory get their cells on a
 * later pass (plan #2138.13): up to `MAX_CELL_FILLS_PER_RUN` units whose
 * pieces were never matched and whose track now has a territory, one call a
 * unit. Returns the units filled and any failures. Never throws.
 */
export async function fillDuePieceCells(
  learn: LearnSupabaseClient,
  userId: string,
  apiKey: string | undefined,
  onSpend?: SpendSink,
): Promise<{ filled: number; failed: string[] }> {
  const out = { filled: 0, failed: [] as string[] };
  if (!apiKey) return out;
  try {
    const { data, error } = await learn
      .from('plan_pieces')
      .select('id, subject_id, unit_id, ordinal, title, concept_ids')
      .eq('user_id', userId)
      .is('cells_matched_at', null)
      .order('ordinal');
    if (error) throw new Error(`Reading the pieces without cells failed: ${error.message}`);
    const rows = (data ?? []) as {
      id: string;
      subject_id: string;
      unit_id: string;
      ordinal: number;
      title: string;
      concept_ids: string[];
    }[];
    const units = new Map<string, typeof rows>();
    for (const row of rows) units.set(row.unit_id, [...(units.get(row.unit_id) ?? []), row]);

    const hasTerritory = new Map<string, boolean>();
    for (const [unitId, pieces] of units) {
      if (out.filled + out.failed.length >= MAX_CELL_FILLS_PER_RUN) break;
      const subjectId = pieces[0]!.subject_id;
      if (!hasTerritory.has(subjectId)) {
        hasTerritory.set(subjectId, (await loadTrackTerritory(learn, userId, subjectId)).length > 0);
      }
      if (!hasTerritory.get(subjectId)) continue;

      const [subject, unit, concepts] = await Promise.all([
        learn.from('subjects').select('name').eq('id', subjectId).eq('user_id', userId).maybeSingle(),
        learn.from('curriculum_units').select('title').eq('id', unitId).eq('user_id', userId).maybeSingle(),
        learn
          .from('concepts')
          .select('id, name, claim')
          .eq('user_id', userId)
          .in('id', [...new Set(pieces.flatMap((piece) => piece.concept_ids))]),
      ]);
      if (!subject.data || !unit.data) continue;
      const ideas = new Map(
        ((concepts.data ?? []) as { id: string; name: string; claim: string }[]).map((c) => [c.id, c]),
      );
      const match = await matchUnitPieces(
        learn,
        userId,
        {
          subjectId,
          trackName: (subject.data as { name: string }).name,
          unitTitle: (unit.data as { title: string }).title,
          pieces: pieces.map((piece) => ({
            title: piece.title,
            ideas: piece.concept_ids.flatMap((id) => (ideas.has(id) ? [ideas.get(id)!] : [])),
          })),
        },
        apiKey,
        onSpend,
      );
      if (!match.matched) {
        if (match.detail) out.failed.push(match.detail);
        continue;
      }
      const now = new Date().toISOString();
      for (const [index, piece] of pieces.entries()) {
        const { error: writeError } = await learn
          .from('plan_pieces')
          .update({ cell_ids: match.cells[index] ?? [], cells_matched_at: now })
          .eq('id', piece.id)
          .eq('user_id', userId)
          .is('cells_matched_at', null);
        if (writeError) throw new Error(`Saving the piece's cells failed: ${writeError.message}`);
      }
      out.filled += 1;
    }
  } catch (error) {
    out.failed.push(error instanceof Error ? error.message : 'Filling the pieces’ cells failed.');
  }
  return out;
}

/**
 * The cells a piece names, in its order, with where the person stands on
 * each. A cell no longer on the map drops out.
 */
export async function loadPieceCells(
  learn: LearnSupabaseClient,
  userId: string,
  cellIds: readonly string[],
): Promise<PieceCellView[]> {
  return (await loadPieceCellsAndLadder(learn, userId, cellIds)).cells;
}

/**
 * The piece's cells as `loadPieceCells` reads them, and `ladder`: every cell
 * of the topics they sit on, lowest level first, which a held piece's check
 * climbs (plan #2292.5).
 */
export async function loadPieceCellsAndLadder(
  learn: LearnSupabaseClient,
  userId: string,
  cellIds: readonly string[],
): Promise<{ cells: PieceCellView[]; ladder: PieceCellView[] }> {
  if (cellIds.length === 0) return { cells: [], ladder: [] };
  const map = await loadGradeMap(learn, userId);
  const readings = readCells(map);
  const byId = new Map(map.cells.map((cell) => [cell.id, cell]));
  const names = new Map(map.topics.map((topic) => [topic.id, topic.name]));
  const view = (cell: { id: string; topicId: string; level: number }): PieceCellView => ({
    cellId: cell.id,
    topicId: cell.topicId,
    topicName: names.get(cell.topicId) ?? '',
    level: cell.level,
    status: readings.get(cell.id)?.status ?? 'open',
  });
  const cells = cellIds.flatMap((id) => {
    const cell = byId.get(id);
    return cell ? [view(cell)] : [];
  });
  const topics = new Set(cells.map((cell) => cell.topicId));
  const ladder = map.cells
    .filter((cell) => topics.has(cell.topicId))
    .sort((a, b) => a.level - b.level)
    .map(view);
  return { cells, ladder };
}

const CELL_CHECK_COLUMNS =
  'id, cell_id, question, response, answered_at, grade, cell:topic_cells(level, topic:topics(id, name))';

type CellCheckJoined = CellCheckRow & {
  cell: { level: number; topic: { id: string; name: string } | null } | null;
};

/** The questions among these whose answer wrote a met on the cell asked, as `question:cell`. */
async function metByQuestion(
  learn: LearnSupabaseClient,
  userId: string,
  questionIds: readonly string[],
): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const { data, error } = await learn
    .from('cell_evidence')
    .select('question_id, cell_id')
    .eq('user_id', userId)
    .eq('verdict', 'met')
    .in('question_id', [...questionIds]);
  if (error) throw new Error(`Reading what the check showed failed: ${error.message}`);
  return new Set(
    ((data ?? []) as { question_id: string; cell_id: string }[]).map((r) => `${r.question_id}:${r.cell_id}`),
  );
}

async function toCheck(learn: LearnSupabaseClient, userId: string, row: CellCheckJoined): Promise<PieceCheck> {
  const met = row.answered_at ? await metByQuestion(learn, userId, [row.id]) : new Set<string>();
  return toCellPieceCheck(
    row,
    { topicId: row.cell?.topic?.id ?? '', topicName: row.cell?.topic?.name ?? '', level: row.cell?.level ?? 0 },
    met.has(`${row.id}:${row.cell_id}`),
  );
}

/**
 * The piece's cell question: the one named by `questionId`, or the latest
 * asked when none is named. Null when there is none on this piece.
 */
export async function loadCellCheck(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
  questionId?: string,
): Promise<PieceCheck | null> {
  const query = learn
    .from('cell_questions')
    .select(CELL_CHECK_COLUMNS)
    .eq('user_id', userId)
    .eq('piece_id', pieceId);
  const { data, error } = await (questionId ? query.eq('id', questionId) : query)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the piece's check failed: ${error.message}`);
  const row = data as unknown as CellCheckJoined | null;
  return row ? toCheck(learn, userId, row) : null;
}

/** Whether any cell question asked as the piece's check wrote a met on its cell. */
export async function cellCheckPassed(learn: LearnSupabaseClient, userId: string, pieceId: string): Promise<boolean> {
  const { data, error } = await learn
    .from('cell_questions')
    .select('id, cell_id')
    .eq('user_id', userId)
    .eq('piece_id', pieceId)
    .not('answered_at', 'is', null);
  if (error) throw new Error(`Reading the piece's check failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; cell_id: string }[];
  const met = await metByQuestion(
    learn,
    userId,
    rows.map((r) => r.id),
  );
  return rows.some((r) => met.has(`${r.id}:${r.cell_id}`));
}
