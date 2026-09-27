import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPool } from '@/lib/async/map-pool';
import type { DomainLinker } from '@/lib/core/inbox/fan-out';
import { emptyLinkerCounters } from '@/lib/core/inbox/fan-out';
import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports, type SpendClient } from '@/lib/core/spend/record';
import { bareAddress, domainFromAddress } from '@/lib/email/extract/classify';
import { gmailProvider } from '@/lib/email/providers/gmail';
import { extractRecurringFromEmail } from './extract';
import {
  classifyRecurring,
  recurringCatchUpQuery,
  RECURRING_CATCH_UP_VERSION,
} from './rules';
import { fileRecurringReading } from './store';

/**
 * Subscriptions and bills, as a third reader of the shared inbox.
 *
 * Beside the commerce and job linkers (lib/core/inbox/fan-out.ts): offered
 * every envelope, it claims the ones whose sender and subject look like a
 * recurring payment, fetches the body of only those, and has Haiku read each
 * into a charge on a payment (lib/recurring/store.ts). Every message offered
 * gets a verdict in public.recurring_messages, so it is judged once.
 *
 * Mail read before this linker existed is reached through `catchUp`: the sync
 * pages through a Gmail search of its own and offers what it finds to every
 * linker, this one included.
 */

/** Bodies fetched and read at once. Gmail and Haiku both rate-limit. */
const READ_CONCURRENCY = 3;

type VerdictRow = {
  id: string;
  user_id: string;
  claimed: boolean;
  parse_status: 'parsed' | 'not_recurring' | 'skipped' | 'failed';
  error: string | null;
  charge_id: string | null;
  updated_at: string;
};

export function recurringLinker(supabase: SupabaseClient, core?: SpendClient): DomainLinker {
  return {
    domain: 'recurring',

    catchUp: {
      version: RECURRING_CATCH_UP_VERSION,
      query: recurringCatchUpQuery,
    },

    async link({ userId, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;
      if (envelopes.length === 0) return counters;

      const { data: judged, error } = await supabase
        .from('recurring_messages')
        .select('id, parse_status')
        .in(
          'id',
          envelopes.map((e) => e.id),
        );
      if (error) throw new Error(`recurring verdict lookup failed: ${error.message}`);

      // A failed reading is tried again when the message comes back through;
      // every other verdict stands.
      const settled = new Set(
        (judged ?? []).filter((r) => r.parse_status !== 'failed').map((r) => r.id as string),
      );

      const verdicts: VerdictRow[] = [];
      const claimed: { envelope: MessageEnvelope; hint: ReturnType<typeof classifyClaim> }[] = [];
      const now = new Date().toISOString();

      for (const envelope of envelopes) {
        if (settled.has(envelope.id)) {
          counters.alreadyJudged += 1;
          continue;
        }
        counters.classified += 1;
        const hint = classifyClaim(envelope);
        if (!hint) {
          verdicts.push({
            id: envelope.id,
            user_id: userId,
            claimed: false,
            parse_status: 'skipped',
            error: null,
            charge_id: null,
            updated_at: now,
          });
          continue;
        }
        counters.claimed += 1;
        claimed.push({ envelope, hint });
      }

      const spend: SpendReport[] = [];

      await mapPool(claimed, READ_CONCURRENCY, async ({ envelope, hint }) => {
        verdicts.push(
          await readOne(supabase, {
            userId,
            accessToken,
            envelope,
            hint: hint!,
            onSpend: (report) => spend.push(report),
          }),
        );
      });

      for (const v of verdicts) {
        if (v.parse_status === 'parsed') counters.linked += 1;
        if (v.parse_status === 'failed') counters.failed += 1;
      }

      if (verdicts.length > 0) {
        const { error: writeError } = await supabase
          .from('recurring_messages')
          .upsert(verdicts, { onConflict: 'id' });
        if (writeError) throw new Error(`recurring verdict write failed: ${writeError.message}`);
      }

      if (core && spend.length > 0) {
        await recordSpendReports(
          core,
          userId,
          { module: 'shopping', operation: 'read-bill-email' },
          spend,
        );
      }

      return counters;
    },
  };
}

function classifyClaim(envelope: MessageEnvelope) {
  const verdict = classifyRecurring({
    fromAddress: envelope.fromAddress,
    subject: envelope.subject,
  });
  return verdict.claim ? verdict.hint : null;
}

async function readOne(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accessToken: string;
    envelope: MessageEnvelope;
    hint: NonNullable<ReturnType<typeof classifyClaim>>;
    onSpend: (report: SpendReport) => void;
  },
): Promise<VerdictRow> {
  const { envelope } = opts;
  const base = {
    id: envelope.id,
    user_id: opts.userId,
    charge_id: null,
    updated_at: new Date().toISOString(),
  };

  try {
    const message = await gmailProvider.getMessage(opts.accessToken, envelope.providerMessageId, {
      format: 'full',
    });
    const receivedOn = (envelope.receivedAt ?? new Date().toISOString()).slice(0, 10);
    const reading = await extractRecurringFromEmail({
      subject: message.subject ?? envelope.subject ?? '',
      text: message.text,
      fromAddress: message.fromAddress ?? envelope.fromAddress,
      receivedOn,
      hint: opts.hint,
      onSpend: opts.onSpend,
    });

    if (!reading.ok) {
      return reading.notRecurring
        ? { ...base, claimed: false, parse_status: 'not_recurring', error: null }
        : { ...base, claimed: true, parse_status: 'failed', error: reading.reason };
    }

    const filed = await fileRecurringReading(supabase, {
      userId: opts.userId,
      messageId: envelope.id,
      senderDomain: domainFromAddress(bareAddress(envelope.fromAddress) ?? envelope.fromAddress),
      reading: reading.value,
    });
    return { ...base, claimed: true, parse_status: 'parsed', error: null, charge_id: filed.chargeId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'read failed';
    return { ...base, claimed: true, parse_status: 'failed', error: message.slice(0, 500) };
  }
}
