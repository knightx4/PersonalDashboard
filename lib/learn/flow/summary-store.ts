import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { buildSummary, SUMMARY_WINDOW_MS, type RunSummary, type SummaryAnswer } from './summary';

/**
 * The reads behind the end-of-run card (plan #2164.6, `summary.ts`): the
 * probes and piece checks answered in the last hour, the ideas they were
 * about, and which ideas the held ones put on the fringe. Every read is the
 * person's own, through their client, and nothing is written.
 */

type ProbeRow = {
  concept_id: string;
  options: unknown;
  chosen_index: number | null;
  correct_index: number | null;
  response: string | null;
  response_correct: boolean | null;
  grade_reason: string | null;
  dont_know: boolean;
  answered_at: string;
};
type CheckRow = {
  piece_id: string;
  response: string | null;
  correct: boolean | null;
  marked_why: string | null;
  answered_at: string;
};

const SETTLED = new Set(['known', 'sharp']);

function pickedText(row: ProbeRow): string | null {
  if (!Array.isArray(row.options) || row.chosen_index === null) return null;
  const option = row.options[row.chosen_index];
  return typeof option === 'string' ? option : null;
}

export async function loadRunSummary(
  learn: LearnSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<RunSummary | null> {
  const since = new Date(now.getTime() - SUMMARY_WINDOW_MS).toISOString();
  const [probes, checks] = await Promise.all([
    learn
      .from('probes')
      .select(
        'concept_id, options, chosen_index, correct_index, response, response_correct, grade_reason, dont_know, answered_at',
      )
      .eq('user_id', userId)
      .gte('answered_at', since),
    learn
      .from('piece_checks')
      .select('piece_id, response, correct, marked_why, answered_at')
      .eq('user_id', userId)
      .gte('answered_at', since),
  ]);
  if (probes.error) throw new Error(`Reading your answers failed: ${probes.error.message}`);
  if (checks.error) throw new Error(`Reading your checks failed: ${checks.error.message}`);
  const probeRows = (probes.data ?? []) as ProbeRow[];
  const checkRows = (checks.data ?? []) as CheckRow[];
  if (probeRows.length + checkRows.length === 0) return null;

  const conceptIds = [...new Set(probeRows.map((row) => row.concept_id))];
  const pieceIds = [...new Set(checkRows.map((row) => row.piece_id))];
  const [concepts, pieces] = await Promise.all([
    conceptIds.length
      ? learn.from('concepts').select('id, name').in('id', conceptIds)
      : Promise.resolve({ data: [], error: null }),
    pieceIds.length
      ? learn.from('plan_pieces').select('id, title').in('id', pieceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (concepts.error) throw new Error(`Reading the ideas failed: ${concepts.error.message}`);
  if (pieces.error) throw new Error(`Reading the pieces failed: ${pieces.error.message}`);
  const conceptNames = new Map(
    ((concepts.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const pieceTitles = new Map(
    ((pieces.data ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]),
  );

  const answers: SummaryAnswer[] = [
    ...probeRows.map((row) => ({
      name: conceptNames.get(row.concept_id) ?? 'An idea',
      quote: row.dont_know ? null : (row.response ?? pickedText(row)),
      held: !row.dont_know && (row.response_correct ?? row.chosen_index === row.correct_index),
      why: row.grade_reason,
      conceptId: row.concept_id,
      answeredAt: row.answered_at,
    })),
    ...checkRows.map((row) => ({
      name: pieceTitles.get(row.piece_id) ?? 'A piece',
      quote: row.response,
      held: row.correct === true,
      why: row.marked_why,
      conceptId: null,
      answeredAt: row.answered_at,
    })),
  ];

  const held = new Set(answers.filter((a) => a.held && a.conceptId).map((a) => a.conceptId as string));
  return buildSummary(answers, await fringeAfter(learn, userId, [...held]));
}

/**
 * Ideas that stand ready because of the ones shown: unsettled, every
 * prerequisite settled, and one of those prerequisites among the shown.
 */
async function fringeAfter(learn: LearnSupabaseClient, userId: string, shown: string[]): Promise<string[]> {
  if (shown.length === 0) return [];
  const out = await learn
    .from('concept_edges')
    .select('dependent_id')
    .eq('user_id', userId)
    .in('prerequisite_id', shown);
  if (out.error) throw new Error(`Reading what follows failed: ${out.error.message}`);
  const dependents = [
    ...new Set(((out.data ?? []) as { dependent_id: string }[]).map((e) => e.dependent_id)),
  ];
  if (dependents.length === 0) return [];

  const into = await learn
    .from('concept_edges')
    .select('prerequisite_id, dependent_id')
    .eq('user_id', userId)
    .in('dependent_id', dependents);
  if (into.error) throw new Error(`Reading what they rest on failed: ${into.error.message}`);
  const edges = (into.data ?? []) as { prerequisite_id: string; dependent_id: string }[];

  const needed = [...new Set([...dependents, ...edges.map((e) => e.prerequisite_id)])];
  const [states, names] = await Promise.all([
    learn.from('concept_state').select('concept_id, state').eq('user_id', userId).in('concept_id', needed),
    learn.from('concepts').select('id, name').in('id', dependents),
  ]);
  if (states.error) throw new Error(`Reading where ideas stand failed: ${states.error.message}`);
  if (names.error) throw new Error(`Reading the ideas failed: ${names.error.message}`);
  const settled = new Set(
    ((states.data ?? []) as { concept_id: string; state: string }[])
      .filter((row) => SETTLED.has(row.state))
      .map((row) => row.concept_id),
  );
  const nameOf = new Map(((names.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  return dependents
    .filter(
      (id) =>
        !settled.has(id) &&
        edges.filter((e) => e.dependent_id === id).every((e) => settled.has(e.prerequisite_id)),
    )
    .map((id) => nameOf.get(id))
    .filter((name): name is string => Boolean(name));
}
