import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { optionsOf, type BoardOption } from '@/lib/you/board-questions';

/**
 * Tripwires that fell due (plan #2581.10). Every one-way door the board
 * worked leaves a tripwire on its question (you.board_questions.tripwire,
 * migrations-you/0029): { condition, check_on, status } with status
 * watching, tripped or cleared, plus checked_at and fact once checked. The
 * Sunday meeting checks the ones due (.claude/skills/board/SKILL.md, step
 * 10); the daily notification names them on the day, and the person can
 * settle one on the tab first. A tripped wire reopens the decision for the
 * next meeting: the question goes back to queued, keeping its verdict and
 * the person's earlier choice.
 */

export type Tripwire = {
  condition: string;
  checkOn: string | null;
  status: 'watching' | 'tripped' | 'cleared';
  checkedAt: string | null;
  fact: string | null;
};

export type DueTripwire = Tripwire & {
  questionId: string;
  question: string;
  options: BoardOption[];
  chosen: string | null;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function tripwireOf(value: unknown): Tripwire | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const condition = text(r.condition);
  if (!condition) return null;
  const status = r.status === 'tripped' || r.status === 'cleared' ? r.status : 'watching';
  const checkOn = /^\d{4}-\d{2}-\d{2}/.test(text(r.check_on)) ? text(r.check_on).slice(0, 10) : null;
  return {
    condition,
    checkOn,
    status,
    checkedAt: text(r.checked_at) || null,
    fact: text(r.fact) || null,
  };
}

/** Whether a tripwire is still watching and its day has come. */
export function tripwireDue(wire: Tripwire | null, today: string): boolean {
  return !!wire && wire.status === 'watching' && !!wire.checkOn && wire.checkOn <= today;
}

/** The person's own words on the wire, as its fact. */
export const TRIPPED_FACT = 'You said it happened.';
export const CLEARED_FACT = 'You said it did not happen.';

/** The tripwires watching whose day has come, the earliest first. */
export async function listDueTripwires(
  client: YouSupabaseClient,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DueTripwire[]> {
  const { data, error } = await client
    .from('board_questions')
    .select('id, question, options, decided_option, tripwire')
    .eq('user_id', userId)
    .not('tripwire', 'is', null)
    .eq('tripwire->>status', 'watching')
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[])
    .flatMap((row) => {
      const wire = tripwireOf(row.tripwire);
      if (typeof row.id !== 'string' || !wire || !tripwireDue(wire, today)) return [];
      return [
        {
          ...wire,
          questionId: row.id,
          question: text(row.question),
          options: optionsOf(row.options),
          chosen: text(row.decided_option) || null,
        },
      ];
    })
    .sort((a, b) => (a.checkOn ?? '').localeCompare(b.checkOn ?? ''));
}

/**
 * Settle a tripwire from the person's answer. Tripped puts the question back
 * on the agenda for the next meeting; not tripped clears the wire. Writes
 * only while the wire is still watching and the row has not changed since it
 * was read, so a meeting checking it at the same moment is not overwritten.
 */
export async function answerTripwire(
  client: YouSupabaseClient,
  userId: string,
  questionId: string,
  tripped: boolean,
  when: string = new Date().toISOString(),
): Promise<'saved' | 'missing' | 'changed'> {
  const { data, error } = await client
    .from('board_questions')
    .select('status, tripwire, updated_at')
    .eq('user_id', userId)
    .eq('id', questionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return 'missing';
  const row = data as Record<string, unknown>;
  const wire = tripwireOf(row.tripwire);
  if (!wire || wire.status !== 'watching') return 'changed';
  const settled = {
    ...(row.tripwire as Record<string, unknown>),
    status: tripped ? 'tripped' : 'cleared',
    checked_at: when,
    fact: tripped ? TRIPPED_FACT : CLEARED_FACT,
  };
  const reopen = tripped && ['discussing', 'deferred', 'decided'].includes(String(row.status));
  const { data: written, error: writeError } = await client
    .from('board_questions')
    .update(reopen ? { tripwire: settled, status: 'queued', meeting_id: null, decided_at: null } : { tripwire: settled })
    .eq('user_id', userId)
    .eq('id', questionId)
    .eq('updated_at', row.updated_at as string)
    .select('id');
  if (writeError) throw new Error(writeError.message);
  return (written ?? []).length > 0 ? 'saved' : 'changed';
}
