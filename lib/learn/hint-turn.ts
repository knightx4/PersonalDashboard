import type { CleanSignals } from '@/lib/learn/confidence';
import { earnsHint, missKindOf, wantsHint, type FirstTry } from '@/lib/learn/hint';

/**
 * One press on a written question that can earn a hint (plan #2522.7), as a
 * piece's own check and a review question take it: both are marked by one
 * written-answer grader and recorded on a row with `hints_used`, `miss_kind`
 * and `first_try`. The cell questions' store has its own, since a cell answer
 * writes evidence as well as a mark.
 */

/** A marker's verdict, as the written-answer graders return it. */
export type Mark =
  | { ok: true; correct: boolean; why: string; hint?: string | null; missKind?: FirstTry['kind'] }
  | { ok: false; detail: string };

/** What one press on a written question comes to (plan #2522.7). */
export type Turn =
  | { ok: true; hold: FirstTry; grade?: undefined }
  | { ok: true; hold?: undefined; grade: { correct: boolean; why: string; missKind: FirstTry['kind'] } }
  | { ok: false; error: string };

/**
 * One press on a written question that can earn a hint: Show the answer
 * gives back the first try as it was marked; otherwise the answer is marked,
 * with a hint asked for when none has been given, and a first miss with a
 * usable hint comes back as the first try to hold.
 */
export async function markTurn(input: {
  reveal: boolean;
  first: FirstTry | null;
  hintsUsed: number;
  mark:(wantHint: boolean) => Promise<Mark>;
}): Promise<Turn> {
  if (input.reveal) {
    if (!input.first) return { ok: false, error: 'There is no hint on this question to show the answer after.' };
    return { ok: true, grade: { correct: false, why: input.first.why ?? '', missKind: input.first.kind } };
  }
  const wantHint = wantsHint(input.hintsUsed);
  const grade = await input.mark(wantHint);
  if (!grade.ok) return { ok: false, error: `Marking failed: ${grade.detail}` };
  const hint = grade.hint ?? null;
  if (wantHint && earnsHint({ correct: grade.correct, hintsUsed: input.hintsUsed, hint }) && hint) {
    return { ok: true, hold: { response: '', why: grade.why, hint, kind: grade.missKind ?? null } };
  }
  return { ok: true, grade: { correct: grade.correct, why: grade.why, missKind: grade.missKind ?? null } };
}

/** The columns a held first try writes: the question stays open. */
export function holdColumns(hold: FirstTry, response: string, signals: CleanSignals, hintsUsed: number) {
  const kind = missKindOf({ correct: false, confidence: signals.confidence, graderKind: hold.kind });
  return {
    hints_used: hintsUsed + 1,
    miss_kind: kind,
    first_try: { ...hold, response, kind },
    ...(signals.confidence !== null && { confidence: signals.confidence }),
    ...(signals.reasoning !== null && { reasoning: signals.reasoning }),
  };
}

/** The miss kind a marked row keeps: this miss's, or on a right answer after a hint, the first try's. */
export function finalMissKind(
  grade: { correct: boolean; missKind: FirstTry['kind'] },
  confidence: number | null,
  first: FirstTry | null,
): FirstTry['kind'] {
  if (grade.correct) return first?.kind ?? null;
  return missKindOf({ correct: false, confidence, graderKind: grade.missKind ?? first?.kind ?? null });
}
