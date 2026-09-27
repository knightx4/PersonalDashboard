import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { markPiecePassed } from './piece-store';
import {
  HANDIN_COLUMNS,
  PRACTICE_COLUMNS,
  piecePasses,
  toPracticeView,
  type HandInRow,
  type PracticeRow,
  type PracticeView,
} from './practice';

/**
 * The reads and writes behind a piece's practice (plan #1142), and the rule
 * that a piece is passed only when its practice and its check both are. Every
 * query names the person.
 */

/** The piece's task as stored, or null before it is written. */
export async function loadPracticeRow(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
): Promise<PracticeRow | null> {
  const { data, error } = await learn
    .from('piece_practice')
    .select(PRACTICE_COLUMNS)
    .eq('user_id', userId)
    .eq('piece_id', pieceId)
    .maybeSingle();
  if (error) throw new Error(`Reading the practice task failed: ${error.message}`);
  return (data as PracticeRow | null) ?? null;
}

/** The latest hand-in for a task, and whether any hand-in has passed it. */
async function loadHandIns(
  learn: LearnSupabaseClient,
  userId: string,
  practiceId: string,
): Promise<{ latest: HandInRow | null; passed: boolean }> {
  const [latest, passed] = await Promise.all([
    learn
      .from('piece_practice_handins')
      .select(HANDIN_COLUMNS)
      .eq('user_id', userId)
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    learn
      .from('piece_practice_handins')
      .select('id')
      .eq('user_id', userId)
      .eq('practice_id', practiceId)
      .eq('passed', true)
      .limit(1),
  ]);
  if (latest.error) throw new Error(`Reading what was handed in failed: ${latest.error.message}`);
  if (passed.error) throw new Error(`Reading what was handed in failed: ${passed.error.message}`);
  return { latest: (latest.data as HandInRow | null) ?? null, passed: (passed.data ?? []).length > 0 };
}

/** The piece's practice as the page shows it, or null before the task is written. */
export async function loadPracticeView(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
): Promise<PracticeView | null> {
  const row = await loadPracticeRow(learn, userId, pieceId);
  if (!row) return null;
  return practiceViewOf(learn, userId, row);
}

export async function practiceViewOf(
  learn: LearnSupabaseClient,
  userId: string,
  row: PracticeRow,
): Promise<PracticeView> {
  const handIns = await loadHandIns(learn, userId, row.id);
  return toPracticeView(row, handIns.latest, handIns.passed);
}

/** Whether the piece's practice has been passed. */
async function practicePassed(learn: LearnSupabaseClient, userId: string, pieceId: string): Promise<boolean> {
  const row = await loadPracticeRow(learn, userId, pieceId);
  if (!row) return false;
  return (await loadHandIns(learn, userId, row.id)).passed;
}

/** Whether any question of the piece's check has been answered right. */
async function checkPassed(learn: LearnSupabaseClient, userId: string, pieceId: string): Promise<boolean> {
  const { data, error } = await learn
    .from('piece_checks')
    .select('id')
    .eq('user_id', userId)
    .eq('piece_id', pieceId)
    .eq('correct', true)
    .limit(1);
  if (error) throw new Error(`Reading the piece's check failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Whether the piece's practice and its check are each passed. */
export async function loadPieceStanding(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
): Promise<{ practicePassed: boolean; checkPassed: boolean }> {
  const [practice, check] = await Promise.all([
    practicePassed(learn, userId, pieceId),
    checkPassed(learn, userId, pieceId),
  ]);
  return { practicePassed: practice, checkPassed: check };
}

export type PieceStanding = { practicePassed: boolean; checkPassed: boolean; passedAt: string | null };

/**
 * After the practice or the check is passed: set the piece passed when the
 * other one is too, keeping the first date it was passed on. Returns where
 * the piece now stands.
 */
export async function passPieceIfDone(
  learn: LearnSupabaseClient,
  userId: string,
  pieceId: string,
  passedAt: string | null,
): Promise<PieceStanding> {
  const standing = await loadPieceStanding(learn, userId, pieceId);
  if (!piecePasses(standing)) return { ...standing, passedAt };
  return { ...standing, passedAt: passedAt ?? (await markPiecePassed(learn, userId, pieceId)) };
}
