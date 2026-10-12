import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { handStepToClaude } from '@/lib/plan/handover';
import { loadPlan } from '@/lib/plan/load';
import { OVERNIGHT_AT_ONCE } from '@/lib/plan/overnight';
import { appendCommentLine } from '@/lib/plan/screen-change';
import {
  backstopSentLine,
  historyLines,
  unactedAnswers,
  type AnswerRun,
  type AnswerStep,
  type UnactedAnswer,
} from '@/lib/plan/unacted-answers';

/**
 * The overnight tick's backstop for answers no session was sent to.
 *
 * Every tick, in every account with a not-started step whose newest history
 * line is an answer, `unactedAnswers` finds the steps that have had no run
 * since the answer and this sends the oldest of them, one per account a tick,
 * with the same send as the plan page's Send button. After a send it writes a
 * `Sent …` line on the step's history, which is what keeps it from being sent
 * again for the same answer.
 *
 * It runs whether or not the account's runner is on. An answered step is the
 * person's go for that step, and a runner switched off says nothing about
 * that; the steps the backstop finds are the ones that were meant to be sent
 * the moment they were answered. The one thing it does stand back for is a
 * runner the person has paused, which is an explicit "hold".
 *
 * The runner's slot rule holds too: an account with `OVERNIGHT_AT_ONCE` step
 * or feature sessions still marked started gets nothing new this tick. The
 * send keeps its own refusals (a session live elsewhere in the feature, a
 * re-shape rewriting it), and a refused step costs that step and not the
 * tick: the next is tried, up to `TRIES_PER_TICK`.
 */

/** How many candidates one account's turn tries before it waits for the next tick. */
const TRIES_PER_TICK = 3;

/** What the backstop did for one account. */
export type AnswerSend =
  | { act: 'sent'; step: number; refused: { number: number; error: string }[] }
  | { act: 'none'; refused: { number: number; error: string }[] }
  | { act: 'paused' }
  | { act: 'full'; running: number }
  | { act: 'failed'; error: string };

/** Everything the backstop needs from outside, handed in so it can be tested. */
export type AnswerPorts = {
  /** Accounts with at least one not-started step whose newest line is an answer. */
  accounts: () => Promise<string[]>;
  /** True when the account's overnight runner is running and paused. */
  paused: (userId: string) => Promise<boolean>;
  /** Step and feature sessions the account has marked started. */
  running: (userId: string) => Promise<number>;
  load: (userId: string) => Promise<{ steps: AnswerStep[]; runs: AnswerRun[] }>;
  send: (userId: string, step: UnactedAnswer) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Write the `Sent …` line on the step's history. */
  markSent: (userId: string, step: UnactedAnswer) => Promise<void>;
};

/** One account's turn. */
async function sendForAccount(ports: AnswerPorts, userId: string): Promise<AnswerSend> {
  if (await ports.paused(userId)) return { act: 'paused' };
  const running = await ports.running(userId);
  if (running >= OVERNIGHT_AT_ONCE) return { act: 'full', running };

  const { steps, runs } = await ports.load(userId);
  const refused: { number: number; error: string }[] = [];
  for (const step of unactedAnswers(steps, runs).slice(0, TRIES_PER_TICK)) {
    const sent = await ports.send(userId, step);
    if (!sent.ok) {
      refused.push({ number: step.number, error: sent.error });
      continue;
    }
    try {
      await ports.markSent(userId, step);
    } catch (err) {
      // The send happened and its run is on record, which also counts as
      // acting on the answer, so a missing line costs nothing worse than the
      // same-day rule in unacted-answers.ts.
      console.error(
        `#${step.number} was sent but its history line could not be written: ${
          err instanceof Error ? err.message : 'failed'
        }`,
      );
    }
    return { act: 'sent', step: step.number, refused };
  }
  return { act: 'none', refused };
}

/** Every account's turn. One account failing does not stop the next. */
export async function sendUnactedAnswers(ports: AnswerPorts): Promise<Record<string, AnswerSend>> {
  const out: Record<string, AnswerSend> = {};
  for (const userId of await ports.accounts()) {
    try {
      out[userId] = await sendForAccount(ports, userId);
    } catch (err) {
      out[userId] = { act: 'failed', error: err instanceof Error ? err.message : 'failed' };
    }
    const done = out[userId];
    if (done.act === 'sent') console.log(`overnight: sent answered step #${done.step} to a session.`);
    if ((done.act === 'sent' || done.act === 'none') && done.refused.length > 0) {
      console.log(
        `overnight: answered steps the send refused: ${done.refused
          .map((one) => `#${one.number} (${one.error})`)
          .join('; ')}`,
      );
    }
    if (done.act === 'failed') console.error(`overnight: answered steps not sent: ${done.error}`);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/** How many candidate rows the account read takes, across every account. */
const CANDIDATE_LIMIT = 500;

/** How far back a session marked started is still counted against the slots. */
const RUNNING_LOOKBACK_MS = 6 * 60 * 60 * 1000;

/** True when the newest dated line on a history is an answer after a block. */
function endsOnAnswer(comment: string | null): boolean {
  const lines = historyLines(comment);
  const newest = lines[lines.length - 1];
  return (
    !!newest &&
    (newest.word === 'Answered' || newest.word === 'Accepted') &&
    lines.some((line) => line.word === 'Blocked')
  );
}

/** The real reads and writes behind the backstop. */
export function answerPortsFor(input: { supabase: Db; now: number }): AnswerPorts {
  const { supabase, now } = input;
  return {
    accounts: async () => {
      const { data, error } = await supabase
        .from('plan_items')
        .select('user_id, comment')
        .eq('status', 'not_started')
        .or('comment.like.*Answered 2*,comment.like.*Accepted 2*')
        .limit(CANDIDATE_LIMIT);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ user_id: string; comment: string | null }>;
      return [...new Set(rows.filter((row) => endsOnAnswer(row.comment)).map((row) => row.user_id))];
    },
    paused: async (userId) => {
      const { data, error } = await supabase
        .from('plan_overnight_runs')
        .select('running, paused')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as { running?: boolean; paused?: boolean } | null;
      return row?.running === true && row.paused === true;
    },
    running: async (userId) => {
      const { count, error } = await supabase
        .from('plan_runs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'started')
        .in('job', ['step', 'feature'])
        .gte('created_at', new Date(now - RUNNING_LOOKBACK_MS).toISOString());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    load: async (userId) => {
      const { items } = await loadPlan(supabase, userId);
      const candidates = items.filter(
        (item) => item.status === 'not_started' && endsOnAnswer(item.comment),
      );
      if (candidates.length === 0) return { steps: [], runs: [] };

      const earliest = candidates
        .map((item) => historyLines(item.comment).at(-1)?.date ?? '9999-12-31')
        .sort()[0];
      const [rounds, runRows, unblocks] = await Promise.all([
        supabase
          .from('ui_checks')
          .select('step, created_at')
          .eq('user_id', userId)
          .eq('verdict', 'accepted')
          .in('step', candidates.map((item) => item.number)),
        supabase
          .from('plan_runs')
          .select('plan_item_id, created_at')
          .eq('user_id', userId)
          .neq('status', 'failed')
          .not('plan_item_id', 'is', null)
          .gte('created_at', `${earliest}T00:00:00Z`),
        // The exact time each answer lifted its block (plan #1830).
        supabase
          .from('plan_history')
          .select('item_id, created_at')
          .eq('user_id', userId)
          .eq('action', 'update')
          .eq('old_status', 'blocked')
          .neq('new_status', 'blocked')
          .in('item_id', candidates.map((item) => item.id))
          .gte('created_at', `${earliest}T00:00:00Z`),
      ]);
      if (rounds.error) throw new Error(rounds.error.message);
      if (runRows.error) throw new Error(runRows.error.message);
      if (unblocks.error) throw new Error(unblocks.error.message);

      const unblockedAt = new Map<string, string[]>();
      for (const row of (unblocks.data ?? []) as Array<{ item_id: string; created_at: string }>) {
        unblockedAt.set(row.item_id, [...(unblockedAt.get(row.item_id) ?? []), row.created_at]);
      }

      const acceptedAt = new Map<number, string[]>();
      for (const row of (rounds.data ?? []) as Array<{ step: number; created_at: string }>) {
        acceptedAt.set(row.step, [...(acceptedAt.get(row.step) ?? []), row.created_at]);
      }
      const wanted = new Set(candidates.map((item) => item.id));
      const steps: AnswerStep[] = items.map((item) => ({
        id: item.id,
        number: item.number,
        // Only the candidates are judged; the rest are here for their parents.
        status: wanted.has(item.id) ? item.status : 'other',
        parentId: item.parentId,
        comment: wanted.has(item.id) ? item.comment : null,
        turns: item.thread
          .filter((turn) => turn.author === 'me')
          .map((turn) => ({ body: turn.body, createdAt: turn.createdAt })),
        acceptedAt: acceptedAt.get(item.number) ?? [],
        unblockedAt: unblockedAt.get(item.id) ?? [],
      }));
      const runs: AnswerRun[] = (
        (runRows.data ?? []) as Array<{ plan_item_id: string; created_at: string }>
      ).map((row) => ({ planItemId: row.plan_item_id, createdAt: row.created_at }));
      return { steps, runs };
    },
    send: async (userId, step) => {
      const sent = await handStepToClaude({ supabase, userId, id: step.id });
      return sent.ok ? { ok: true } : { ok: false, error: sent.error };
    },
    markSent: async (userId, step) => {
      const { data, error } = await supabase
        .from('plan_items')
        .select('comment')
        .eq('user_id', userId)
        .eq('id', step.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const comment = appendCommentLine(
        (data as { comment: string | null } | null)?.comment ?? null,
        backstopSentLine(new Date(now).toISOString().slice(0, 10)),
      );
      const { error: writeError } = await supabase
        .from('plan_items')
        .update({ comment })
        .eq('user_id', userId)
        .eq('id', step.id);
      if (writeError) throw new Error(writeError.message);
    },
  };
}
