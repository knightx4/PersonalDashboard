import 'server-only';

import { mapPool } from '@/lib/async/map-pool';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';
import { emptyLinkerCounters, type DomainLinker, type LinkerCounters } from '@/lib/core/inbox/fan-out';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { askJev, type JevFailure } from '@/lib/jev/client';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { MAIL_PILE_QUESTION, mailState, type MailPile } from './question';

/**
 * The mailroom: Jev sorts every email into a pile, beside the linkers that
 * route it (plan #1173).
 *
 * Offered every envelope like the other linkers, and last among them. It
 * asks Jev which pile each email belongs in and writes the answer to
 * core.mail_piles. Nothing reads the pile to route mail yet: the four
 * linkers' rules stay in charge, and core.mail_pile_agreement compares the
 * two so the rules are retired only where the numbers support it (#1174).
 *
 * The pile is stored at any confidence. Whoever acts on it applies the 0.8
 * floor (JEV_CONFIDENCE_FLOOR) and its own fallback; here the fallback is the
 * rules, which are already running.
 *
 * It claims nothing, so it never keeps an email from the scrub, and it sends
 * nothing for an account that has not agreed to Jev (lib/jev/enabled.ts).
 * A failed ask writes no row, so the email is asked again by the sweep, which
 * also sorts mail that arrived before this linker existed.
 */

/** Jev calls in flight at once. It answers in 70 to 500 ms. */
const ASK_CONCURRENCY = 6;
/**
 * Wall clock one page may spend asking. Past it the rest of the page is left
 * for the sweep, so sorting never slows the reading of the mailbox much.
 */
const LINK_BUDGET_MS = 15_000;
/** Envelopes one sweep asks about at most. */
const SWEEP_LIMIT = 150;
/**
 * Shorter than the client's ten seconds: an email left unsorted is asked
 * again by the next sweep, and a slow call should not hold the sync.
 */
const ASK_TIMEOUT_MS = 3_000;

export type MailPileRow = {
  id: string;
  user_id: string;
  pile: MailPile;
  confidence: number;
  model: string;
};

export type SortResult = {
  rows: MailPileRow[];
  spend: SpendReport[];
  /** Envelopes Jev gave no answer for, by reason. */
  failed: Partial<Record<JevFailure['reason'], number>>;
  /** Envelopes with nothing to read, or left unasked when time ran out or the run stopped. */
  skipped: number;
};

/**
 * A missing key, or a key TypeSafe refuses, fails every call the same way,
 * so the first one ends the batch. Any other failure is about one call.
 */
export function stopsTheBatch(failure: Pick<JevFailure, 'reason' | 'detail'>): boolean {
  if (failure.reason === 'no-key') return true;
  return failure.reason === 'refused' && /^40[13]\b/.test(failure.detail);
}

/** Ask Jev about each envelope. Pure apart from the calls, so a test hands in `fetch`. */
export async function sortEnvelopes(opts: {
  userId: string;
  envelopes: readonly Pick<MessageEnvelope, 'id' | 'fromAddress' | 'replyToAddress' | 'subject'>[];
  /** Epoch ms after which no new call is started. */
  deadline?: number;
  apiKey?: string | null;
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<SortResult> {
  const now = opts.now ?? Date.now;
  const result: SortResult = { rows: [], spend: [], failed: {}, skipped: 0 };
  let stopped = false;

  await mapPool(opts.envelopes, ASK_CONCURRENCY, async (envelope) => {
    const state = mailState(envelope);
    if (!state || stopped || (opts.deadline !== undefined && now() > opts.deadline)) {
      result.skipped += 1;
      return;
    }
    const answer = await askJev({
      state,
      question: MAIL_PILE_QUESTION,
      onSpend: (report) => result.spend.push(report),
      apiKey: opts.apiKey,
      fetch: opts.fetch,
      timeoutMs: ASK_TIMEOUT_MS,
    });
    if (!answer.ok) {
      result.failed[answer.reason] = (result.failed[answer.reason] ?? 0) + 1;
      if (stopsTheBatch(answer)) stopped = true;
      return;
    }
    result.rows.push({
      id: envelope.id,
      user_id: opts.userId,
      pile: answer.answer.choice,
      confidence: answer.answer.confidence,
      model: answer.model,
    });
  });

  const failures = Object.entries(result.failed).filter(([reason]) => reason !== 'no-key');
  if (failures.length > 0) {
    console.warn(`[mailroom] Jev gave no answer: ${failures.map(([r, n]) => `${r} ${n}`).join(', ')}`);
  }
  return result;
}

async function writeSorted(
  core: CoreSupabaseClient,
  userId: string,
  sorted: SortResult,
): Promise<void> {
  if (sorted.rows.length > 0) {
    // ignoreDuplicates: a sync racing this one may have sorted the same email,
    // and either answer will do.
    const { error } = await core
      .from('mail_piles')
      .upsert(sorted.rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`mail pile write failed: ${error.message}`);
  }
  if (sorted.spend.length > 0) {
    await recordSpendReports(core, userId, { module: 'core', operation: 'sort-email' }, sorted.spend);
  }
}

function failedCount(sorted: SortResult): number {
  return Object.values(sorted.failed).reduce((sum, n) => sum + (n ?? 0), 0);
}

export function mailroomLinker(
  core: CoreSupabaseClient,
  jev: { apiKey?: string | null; fetch?: typeof fetch } = {},
): DomainLinker {
  return {
    domain: 'mailroom',

    async link({ userId, envelopes }): Promise<LinkerCounters> {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;
      if (envelopes.length === 0) return counters;
      if (!(await jevEnabledFor(core, userId))) return counters;

      const { data: known, error } = await core
        .from('mail_piles')
        .select('id')
        .in(
          'id',
          envelopes.map((e) => e.id),
        );
      if (error) throw new Error(`mail pile lookup failed: ${error.message}`);
      const sortedAlready = new Set((known ?? []).map((row) => row.id as string));

      const unsorted = envelopes.filter((e) => !sortedAlready.has(e.id));
      counters.alreadyJudged = envelopes.length - unsorted.length;

      const sorted = await sortEnvelopes({
        userId,
        envelopes: unsorted,
        deadline: Date.now() + LINK_BUDGET_MS,
        ...jev,
      });
      await writeSorted(core, userId, sorted);

      counters.classified = sorted.rows.length;
      counters.failed = failedCount(sorted);
      return counters;
    },

    async sweep({ userId, accountId, budgetMs }) {
      if (!(await jevEnabledFor(core, userId))) return;
      const { data, error } = await core.rpc('mail_piles_unsorted', {
        p_account_id: accountId,
        p_limit: SWEEP_LIMIT,
      });
      if (error) throw new Error(`unsorted mail lookup failed: ${error.message}`);
      const rows = (data ?? []) as {
        id: string;
        from_address: string | null;
        reply_to_address: string | null;
        subject: string | null;
      }[];
      if (rows.length === 0) return;

      const sorted = await sortEnvelopes({
        userId,
        envelopes: rows.map((row) => ({
          id: row.id,
          fromAddress: row.from_address,
          replyToAddress: row.reply_to_address,
          subject: row.subject,
        })),
        deadline: Date.now() + budgetMs - ASK_TIMEOUT_MS,
        ...jev,
      });
      await writeSorted(core, userId, sorted);
    },
  };
}
