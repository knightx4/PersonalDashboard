import 'server-only';

import { mapPool } from '@/lib/async/map-pool';
import { gmailProvider } from '@/lib/email/providers/gmail';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Fetching every message exactly once.
 *
 * This is the step the two workspaces used to duplicate. Both asked Gmail for
 * metadata on overlapping sets of message ids, both parsed the same headers,
 * and both wrote their own row -- so an order confirmation that also matched a
 * recruiting keyword cost two API calls and two rows for one email.
 *
 * Now the envelope is fetched once into core and handed to both linkers. The
 * unique key on (email_account_id, provider_message_id) is what enforces that:
 * a second sync over the same window finds the rows already there and makes no
 * Gmail calls at all.
 *
 * Headers only. Bodies are never stored -- a linker that needs one fetches it
 * for the message it actually claimed, which is a much smaller set.
 */

/** Gmail metadata calls in flight at once. */
const METADATA_CONCURRENCY = 6;

export type MessageEnvelope = {
  /** core.ingested_messages.id -- the key both workspaces' verdicts hang off. */
  id: string;
  providerMessageId: string;
  threadId: string | null;
  receivedAt: string | null;
  fromAddress: string | null;
  replyToAddress: string | null;
  subject: string | null;
  /** True when this sync is the one that first saw it. */
  isNew: boolean;
};

export type EnvelopeCounters = {
  seen: number;
  fetched: number;
  alreadyKnown: number;
  failed: number;
};

export function emptyEnvelopeCounters(): EnvelopeCounters {
  return { seen: 0, fetched: 0, alreadyKnown: 0, failed: 0 };
}

type CoreRow = {
  id: string;
  provider_message_id: string;
  thread_id: string | null;
  received_at: string | null;
  from_address: string | null;
  reply_to_address: string | null;
  subject: string | null;
  scrubbed_at?: string | null;
};

function toEnvelope(row: CoreRow, isNew: boolean): MessageEnvelope {
  return {
    id: row.id,
    providerMessageId: row.provider_message_id,
    threadId: row.thread_id,
    receivedAt: row.received_at,
    fromAddress: row.from_address,
    replyToAddress: row.reply_to_address,
    subject: row.subject,
    isNew,
  };
}

/**
 * Resolve a page of Gmail message ids to core envelopes, fetching only the ones
 * we have never seen.
 *
 * Returns every id that resolved, new or not, because a linker may still owe a
 * verdict on a message another workspace ingested on an earlier run.
 */
export async function fetchEnvelopes(
  supabase: CoreSupabaseClient,
  opts: {
    accountId: string;
    accessToken: string;
    messageIds: string[];
    counters: EnvelopeCounters;
    /**
     * Re-read headers for messages whose envelope was scrubbed.
     *
     * Normally a scrubbed message stays scrubbed: every workspace looked at it
     * and none wanted it. But a workspace that did not exist when that was
     * decided never got its say -- and most of the history here was scrubbed
     * under the old single-app rule, before there was a job side to ask. Their
     * subjects are gone from the database but not from the mailbox, so a
     * backfill re-reads them, offers them to whoever has not judged them, and
     * the sweep scrubs them again if the answer is still no.
     *
     * Backfills only. An incremental sync leaves them alone, so this is a
     * bounded reconciliation rather than a re-fetch loop that undoes the
     * retention rule on every run.
     */
    refetchScrubbed?: boolean;
  },
): Promise<MessageEnvelope[]> {
  const { accountId, accessToken, messageIds, counters } = opts;
  if (messageIds.length === 0) return [];

  // One ledger lookup for the whole page rather than N round trips.
  const { data: existingRows, error } = await supabase
    .from('ingested_messages')
    .select(
      'id, provider_message_id, thread_id, received_at, from_address, reply_to_address, subject, scrubbed_at',
    )
    .eq('email_account_id', accountId)
    .in('provider_message_id', messageIds);

  if (error) throw new Error(`core envelope lookup failed: ${error.message}`);

  const known = new Map<string, CoreRow>(
    (existingRows ?? []).map((row) => [(row as CoreRow).provider_message_id, row as CoreRow]),
  );

  const envelopes: MessageEnvelope[] = [];
  const missing: string[] = [];

  for (const messageId of messageIds) {
    counters.seen += 1;
    const row = known.get(messageId);
    if (row && !(opts.refetchScrubbed && row.scrubbed_at)) {
      counters.alreadyKnown += 1;
      envelopes.push(toEnvelope(row, false));
    } else {
      missing.push(messageId);
    }
  }

  if (missing.length === 0) return envelopes;

  type Pending = {
    email_account_id: string;
    provider_message_id: string;
    thread_id: string | null;
    received_at: string | null;
    from_address: string | null;
    reply_to_address: string | null;
    subject: string | null;
    scrubbed_at: string | null;
  };

  const pending: Pending[] = [];

  await mapPool(missing, METADATA_CONCURRENCY, async (messageId) => {
    try {
      const meta = await gmailProvider.getMessage(accessToken, messageId, { format: 'metadata' });
      pending.push({
        email_account_id: accountId,
        provider_message_id: messageId,
        thread_id: meta.threadId,
        received_at: meta.internalDate ? meta.internalDate.toISOString() : null,
        from_address: meta.fromAddress,
        reply_to_address: meta.replyToAddress,
        subject: meta.subject,
        // Re-read, so it is no longer scrubbed. The sweep will decide again.
        scrubbed_at: null,
      });
    } catch {
      // A single unreadable message must not fail the page: it would stall the
      // whole sync behind one bad id, forever, since the cursor never advances.
      counters.failed += 1;
    }
  });

  if (pending.length === 0) return envelopes;

  // Upsert rather than insert: two syncs racing over the same window would
  // otherwise collide on the (account, provider_message_id) key, and the
  // loser's whole page would be lost rather than deduplicated. It is also what
  // restores a scrubbed envelope in place, keeping its id and every verdict
  // already hanging off it.
  const { data: inserted, error: insertError } = await supabase
    .from('ingested_messages')
    .upsert(pending, { onConflict: 'email_account_id,provider_message_id' })
    .select('id, provider_message_id, thread_id, received_at, from_address, reply_to_address, subject');

  if (insertError) throw new Error(`core envelope insert failed: ${insertError.message}`);

  for (const row of (inserted ?? []) as CoreRow[]) {
    counters.fetched += 1;
    envelopes.push(toEnvelope(row, true));
  }

  return envelopes;
}
