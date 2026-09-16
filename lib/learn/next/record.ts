import 'server-only';

import { assertSchemaExposed, isMissingTable } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { NextKind, NextOutcome } from '@/lib/learn/next/rank';

/**
 * Keeping what came of the things Learn next offered.
 *
 * Three outcomes, settled in #479: a question answered about a claim, a
 * reading marked read, and a row pushed aside with Not now. Nothing else is
 * stored -- not that a row was shown, not that it was pressed, not how long
 * anybody looked at it -- and that is a rule about this module rather than an
 * omission, so it is worth saying twice: the writes below are called from the
 * places an outcome already lands, never from a page render.
 *
 * `learn.next_outcomes` is what the ordering reads, and the table's own
 * comment says why it exists beside the probes and the reading queue.
 */

export type { NextOutcome };

/** What you did, and what you did it to. */
export type NextOutcomeInput =
  | { kind: 'ready' | 'recheck'; conceptId: string; outcome: 'answered' | 'not_now' }
  | { kind: 'reading'; readingId: string; outcome: 'read' | 'not_now' };

/** The row as the table holds it. */
export type NextOutcomeRow = {
  user_id: string;
  kind: NextKind;
  concept_id: string | null;
  reading_id: string | null;
  outcome: NextOutcome;
};

/**
 * Whether an answer counts as starting a claim or as checking one again.
 *
 * Read off where the claim stood before the answer, which is the same thing
 * that decided which list the row was in: a settled claim is only ever offered
 * as a re-check.
 */
export function answerKind(wasSettled: boolean): 'ready' | 'recheck' {
  return wasSettled ? 'recheck' : 'ready';
}

/**
 * The insert, built without touching a database so the shape can be tested.
 *
 * The two columns the table allows are exclusive, so exactly one is filled and
 * the other is written as null rather than left off -- the check constraint
 * refuses anything else, and a row that fails it fails at the insert rather
 * than being quietly dropped.
 */
export function outcomeRow(userId: string, input: NextOutcomeInput): NextOutcomeRow {
  return {
    user_id: userId,
    kind: input.kind,
    concept_id: input.kind === 'reading' ? null : input.conceptId,
    reading_id: input.kind === 'reading' ? input.readingId : null,
    outcome: input.outcome,
  };
}

/** Postgres' unique violation. */
const ALREADY_THERE = '23505';

/**
 * Write one outcome.
 *
 * A reading can only be finished once, which the unique index on the table
 * enforces, so pressing Read it a second time lands here and is dropped rather
 * than counted twice. Every other failure is thrown: this is called from
 * actions that have just written the outcome itself, and a record that
 * silently stops being kept is worse than a visible error.
 *
 * The table not existing is the exception, because it is not this write
 * failing -- it is a deployment a migration ahead of its database, and the
 * work whose outcome this records has already been committed by the caller.
 * Failing here would make marking a reading read or answering a question
 * report an error over something that did happen. So it is logged, naming the
 * migration to run, and the record simply starts once the table is there.
 */
export async function recordOutcome(
  supabase: LearnSupabaseClient,
  userId: string,
  input: NextOutcomeInput,
): Promise<void> {
  const { error } = await supabase.from('next_outcomes').insert(outcomeRow(userId, input));

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (isMissingTable(error)) {
    console.error(
      'learn.next_outcomes is missing, so what you just did was not recorded for Learn next. ' +
        'Apply supabase/migrations-learn/0017_next_outcomes.sql to the project.',
    );
    return;
  }
  if (error && error.code !== ALREADY_THERE) {
    throw new Error(`Recording what you did failed: ${error.message}`);
  }
}
