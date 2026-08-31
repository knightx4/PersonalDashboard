import 'server-only';

import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';

/**
 * Offering every message to every workspace.
 *
 * One mailbox, two readers. A message is fetched once into core and then shown
 * to each workspace's linker, which decides on its own whether it wants it and
 * records its own verdict. Neither can see the other's answer and neither has a
 * veto: the same email can be an order confirmation to one and nothing at all
 * to the other, and both of those are true.
 *
 * A linker only fetches a message body for the messages it actually claimed,
 * which is what keeps "one fetch" from meaning "one enormous fetch".
 */

export type LinkerCounters = {
  /** Envelopes this linker was offered. */
  offered: number;
  /** Envelopes it had already judged on an earlier run. */
  alreadyJudged: number;
  /** Verdicts written this run. */
  classified: number;
  /** Of those, the ones it claimed as relevant. */
  claimed: number;
  /** Records it created or updated in its own domain (orders, applications). */
  linked: number;
  failed: number;
};

export function emptyLinkerCounters(): LinkerCounters {
  return { offered: 0, alreadyJudged: 0, classified: 0, claimed: 0, linked: 0, failed: 0 };
}

export interface DomainLinker {
  /** Short name, used in logs and in the sync summary. */
  readonly domain: string;
  /**
   * Another look at mail this workspace could not place earlier.
   *
   * Separate from `link` because it is not per-page work. It used to run
   * inside it, so every page of six new messages also paid for a twenty-second
   * pass over the held queue -- which is most of why a first scan crawled: the
   * invocation spent its minute re-reading old mail instead of reading the
   * mailbox. The pump calls this once per invocation, when the mailbox is
   * exhausted or there is time to spare.
   */
  sweep?(opts: {
    userId: string;
    accountId: string;
    accountEmail: string;
    accessToken: string;
    /** Wall clock this pass may spend. */
    budgetMs: number;
  }): Promise<void>;
  link(opts: {
    userId: string;
    accountId: string;
    /**
     * The connected address itself. A workspace needs it to tell the user
     * apart from everyone else on a message -- you are on every calendar
     * invite in this mailbox and are not one of your own interviewers.
     */
    accountEmail: string;
    accessToken: string;
    envelopes: MessageEnvelope[];
  }): Promise<LinkerCounters>;
}

export type FanOutResult = Record<string, LinkerCounters | { error: string }>;

/**
 * Run every linker over the same envelopes.
 *
 * Sequential rather than parallel: both linkers hit Gmail for bodies and the
 * same rate limit, and interleaving them buys nothing while making a 429 twice
 * as likely.
 *
 * A linker that throws is recorded and the others still run. The failure being
 * isolated matters more here than anywhere else in the sync -- the commerce
 * linker has years of working history behind it and the job linker is new, and
 * a new linker crashing must not cost the mailbox its order confirmations.
 */
export async function fanOut(
  linkers: readonly DomainLinker[],
  opts: {
    userId: string;
    accountId: string;
    accountEmail: string;
    accessToken: string;
    envelopes: MessageEnvelope[];
  },
): Promise<FanOutResult> {
  const result: FanOutResult = {};

  for (const linker of linkers) {
    try {
      result[linker.domain] = await linker.link(opts);
    } catch (err) {
      result[linker.domain] = {
        error: err instanceof Error ? err.message : 'linker failed',
      };
    }
  }

  return result;
}

/**
 * The held-queue pass, for every linker that has one.
 *
 * Sequential and failure-isolated for the same reasons `fanOut` is: they share
 * a Gmail rate limit, and a workspace that throws here must not cost the other
 * one its sweep -- or, worse, the hand-off that keeps the sync alive.
 */
export async function sweepLinkers(
  linkers: readonly DomainLinker[],
  opts: {
    userId: string;
    accountId: string;
    accountEmail: string;
    accessToken: string;
    budgetMs: number;
  },
): Promise<void> {
  const startedAt = Date.now();

  for (const linker of linkers) {
    if (!linker.sweep) continue;
    const remaining = opts.budgetMs - (Date.now() - startedAt);
    if (remaining <= 0) return;

    try {
      await linker.sweep({ ...opts, budgetMs: remaining });
    } catch (err) {
      console.error('linker sweep failed', linker.domain, err);
    }
  }
}
