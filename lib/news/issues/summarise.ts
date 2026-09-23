import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { digestIssue, type DigestOutcome } from './digest';

/**
 * When a newsletter is summarised (plan #787). #784 settled it: on arrival, so
 * the summary is there before the issue is opened.
 *
 * Two ways in. `digestOnArrival` runs from the inbound route once a new issue
 * is stored, after Mailgun has had its answer. `digestPending` is the catch-up
 * over every issue with no `digested_at`, which covers the issues stored before
 * this existed and any arrival whose digest never finished (no key on the
 * deployment, or the function stopped mid-call). A failed digest sets
 * `digested_at` too, so the catch-up does not pay for the same failure twice;
 * clearing `digested_at` on a row queues it again.
 *
 * The catch-up also redoes the issues summarised before the one-line summary
 * existed (plan #824), rewriting each in place so its summary is never cleared
 * in between. It picks those by `digested_at` before LINE_SINCE: a redo moves
 * `digested_at` past it whether or not it wrote a line, so no issue is redone
 * twice, and a failed redo keeps the summary it had.
 */

/**
 * When the code that writes `summary_line` was committed (61af3ee, 06:48 UTC).
 * Every summary before it was written without a line; the last was at 06:13.
 */
export const LINE_SINCE = '2026-09-23T06:48:00Z';

/** Never attempted, or summarised without a line before LINE_SINCE. */
export const PENDING_FILTER = `digested_at.is.null,and(summary.not.is.null,summary_line.is.null,digested_at.lt."${LINE_SINCE}")`;

type Clients = {
  /** May be the service role: digestIssue names the account on every query. */
  news: NewsSupabaseClient;
  /** Bound to the core schema, for core.model_spend. */
  spend: Pick<CoreSupabaseClient, 'from'>;
  client?: Pick<Anthropic, 'messages'>;
};

export type ArrivalDigest = DigestOutcome['status'] | 'no-key' | 'error';

/**
 * Summarise one issue that has just been stored. Never throws: the issue is
 * already saved and readable, and nothing here may change that.
 *
 * With no API key the issue is left untouched, so `digested_at` stays null and
 * the catch-up summarises it once a key is set.
 */
export async function digestOnArrival(
  input: Clients & { userId: string; issueId: string; anthropicApiKey: string | undefined },
): Promise<ArrivalDigest> {
  if (!input.anthropicApiKey) {
    console.warn(`news: issue ${input.issueId} not summarised, ANTHROPIC_API_KEY is not set`);
    return 'no-key';
  }
  try {
    const outcome = await digestIssue({ ...input, anthropicApiKey: input.anthropicApiKey });
    if (outcome.status === 'failed') {
      console.warn(`news: summarising issue ${input.issueId} failed (${outcome.error})`);
    }
    return outcome.status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`news: summarising issue ${input.issueId} stopped (${message})`);
    return 'error';
  }
}

/** Most issues one catch-up run takes on. Well above the 42 stored now. */
const PENDING_LIMIT = 500;

/**
 * What one catch-up run did. `left` counts issues it listed but did not reach
 * before its deadline; they are still pending and the next run takes them.
 */
export type PendingTally = { digested: number; failed: number; missing: number; left: number };

/**
 * Summarise every issue not yet attempted, oldest first, one at a time, then
 * redo the ones summarised without a line. The never-attempted come first so
 * the redo never holds up a new issue.
 *
 * Reads across all accounts, which is why it takes the service-role client;
 * each issue's own `user_id` is passed on, so the spend lands on the account
 * that owns the newsletter. Stops on the first issue that cannot be saved,
 * since the next one would fail the same way; running it again carries on from
 * there. With `deadline` (a time in epoch milliseconds) it starts no issue
 * after that time, so a scheduled run ends inside its route's limit.
 */
export async function digestPending(
  input: Clients & {
    anthropicApiKey: string;
    limit?: number;
    deadline?: number;
    now?: () => number;
    onIssue?: (issueId: string, outcome: DigestOutcome) => void;
  },
): Promise<PendingTally> {
  const { data, error } = await input.news
    .from('issues')
    .select('id, user_id')
    .or(PENDING_FILTER)
    .order('digested_at', { ascending: true, nullsFirst: true })
    .order('received_at', { ascending: true })
    .limit(input.limit ?? PENDING_LIMIT);
  if (error) throw new Error(`news: listing issues to summarise failed (${error.message})`);

  const rows = data ?? [];
  const now = input.now ?? Date.now;
  const tally: PendingTally = { digested: 0, failed: 0, missing: 0, left: 0 };
  for (const [index, row] of rows.entries()) {
    if (input.deadline !== undefined && now() >= input.deadline) {
      tally.left = rows.length - index;
      break;
    }
    const issueId = row.id as string;
    const outcome = await digestIssue({
      news: input.news,
      spend: input.spend,
      client: input.client,
      anthropicApiKey: input.anthropicApiKey,
      userId: row.user_id as string,
      issueId,
    });
    tally[outcome.status] += 1;
    input.onIssue?.(issueId, outcome);
  }
  return tally;
}
