import 'server-only';

import { mapPool } from '@/lib/async/map-pool';
import { loadAccountSettings } from '@/lib/core/account/settings';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { DomainLinker } from '@/lib/core/inbox/fan-out';
import { emptyLinkerCounters } from '@/lib/core/inbox/fan-out';
import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import { gmailProvider } from '@/lib/email/providers/gmail';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { extractAppointmentFromEmail } from './extract';
import {
  APPOINTMENT_CATCH_UP_VERSION,
  appointmentCatchUpQuery,
  classifyAppointment,
  type AppointmentHint,
} from './rules';
import { fileAppointmentReading } from './store';

/**
 * Appointments and reservations, as a fourth reader of the shared inbox
 * (plan #1127).
 *
 * Beside the commerce, job and recurring-payments linkers
 * (lib/core/inbox/fan-out.ts): offered every envelope, it claims the ones
 * whose sender and subject look like a booking, fetches the body of only
 * those, and has Haiku read each into an appointment in todo.appointments
 * (store.ts). Every message offered gets a verdict in
 * todo.appointment_messages, so it is judged once.
 *
 * Mail read before this linker existed is reached through `catchUp`, the same
 * way the recurring-payments linker reaches old bills.
 */

/** Bodies fetched and read at once. Gmail and Haiku both rate-limit. */
const READ_CONCURRENCY = 3;

type VerdictRow = {
  id: string;
  user_id: string;
  claimed: boolean;
  parse_status: 'parsed' | 'not_appointment' | 'unmatched' | 'skipped' | 'failed';
  error: string | null;
  appointment_id: string | null;
  updated_at: string;
};

export function appointmentLinker(
  supabase: TodoSupabaseClient,
  core: CoreSupabaseClient,
): DomainLinker {
  return {
    domain: 'appointments',

    catchUp: {
      version: APPOINTMENT_CATCH_UP_VERSION,
      query: appointmentCatchUpQuery,
    },

    async link({ userId, accessToken, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;
      if (envelopes.length === 0) return counters;

      const { data: judged, error } = await supabase
        .from('appointment_messages')
        .select('id, parse_status')
        .in(
          'id',
          envelopes.map((e) => e.id),
        );
      if (error) throw new Error(`appointment verdict lookup failed: ${error.message}`);

      // A failed reading is tried again when the message comes back through;
      // every other verdict stands.
      const settled = new Set(
        (judged ?? []).filter((r) => r.parse_status !== 'failed').map((r) => r.id as string),
      );

      const verdicts: VerdictRow[] = [];
      const claimed: { envelope: MessageEnvelope; hint: AppointmentHint }[] = [];
      const now = new Date().toISOString();

      for (const envelope of envelopes) {
        if (settled.has(envelope.id)) {
          counters.alreadyJudged += 1;
          continue;
        }
        counters.classified += 1;
        const verdict = classifyAppointment({
          fromAddress: envelope.fromAddress,
          subject: envelope.subject,
        });
        if (!verdict.claim) {
          verdicts.push({
            id: envelope.id,
            user_id: userId,
            claimed: false,
            parse_status: 'skipped',
            error: null,
            appointment_id: null,
            updated_at: now,
          });
          continue;
        }
        counters.claimed += 1;
        claimed.push({ envelope, hint: verdict.hint });
      }

      const spend: SpendReport[] = [];

      if (claimed.length > 0) {
        // The person's zone turns "3:30 PM" into an instant. Read once per
        // page, and only when something was claimed.
        const { timezone } = await loadAccountSettings(userId, core);

        await mapPool(claimed, READ_CONCURRENCY, async ({ envelope, hint }) => {
          verdicts.push(
            await readOne(supabase, {
              userId,
              accessToken,
              envelope,
              hint,
              timezone,
              onSpend: (report) => spend.push(report),
            }),
          );
        });
      }

      for (const v of verdicts) {
        if (v.parse_status === 'parsed') counters.linked += 1;
        if (v.parse_status === 'failed') counters.failed += 1;
      }

      if (verdicts.length > 0) {
        const { error: writeError } = await supabase
          .from('appointment_messages')
          .upsert(verdicts, { onConflict: 'id' });
        if (writeError) throw new Error(`appointment verdict write failed: ${writeError.message}`);
      }

      if (spend.length > 0) {
        await recordSpendReports(
          core,
          userId,
          { module: 'core', operation: 'read-appointment-email' },
          spend,
        );
      }

      return counters;
    },
  };
}

async function readOne(
  supabase: TodoSupabaseClient,
  opts: {
    userId: string;
    accessToken: string;
    envelope: MessageEnvelope;
    hint: AppointmentHint;
    timezone: string;
    onSpend: (report: SpendReport) => void;
  },
): Promise<VerdictRow> {
  const { envelope } = opts;
  const base = {
    id: envelope.id,
    user_id: opts.userId,
    appointment_id: null,
    updated_at: new Date().toISOString(),
  };

  try {
    const message = await gmailProvider.getMessage(opts.accessToken, envelope.providerMessageId, {
      format: 'full',
    });
    const receivedAt = envelope.receivedAt ?? new Date().toISOString();
    const reading = await extractAppointmentFromEmail({
      subject: message.subject ?? envelope.subject ?? '',
      text: message.text,
      fromAddress: message.fromAddress ?? envelope.fromAddress,
      receivedOn: receivedAt.slice(0, 10),
      hint: opts.hint,
      onSpend: opts.onSpend,
    });

    if (!reading.ok) {
      return reading.notAppointment
        ? { ...base, claimed: false, parse_status: 'not_appointment', error: null }
        : { ...base, claimed: true, parse_status: 'failed', error: reading.reason };
    }

    const filed = await fileAppointmentReading(supabase, {
      userId: opts.userId,
      messageId: envelope.id,
      receivedAt,
      timezone: opts.timezone,
      senderName: displayNameFromAddress(envelope.fromAddress),
      reading: reading.value,
    });
    return {
      ...base,
      claimed: true,
      parse_status: filed.unmatched ? 'unmatched' : 'parsed',
      error: null,
      appointment_id: filed.appointmentId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'read failed';
    return { ...base, claimed: true, parse_status: 'failed', error: message.slice(0, 500) };
  }
}
