import 'server-only';

import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { providerKey, type AppointmentExtraction } from './extraction';
import { resolveAppointment, type StoredAppointment } from './resolve';

/**
 * Filing one reading: find the appointment it is about among the person's
 * appointments with that provider, and insert, move or cancel it.
 *
 * Service role only (the linker runs in the sync), so every read and write
 * names the user explicitly rather than leaning on RLS.
 */
export async function fileAppointmentReading(
  supabase: TodoSupabaseClient,
  opts: {
    userId: string;
    messageId: string;
    /** ISO instant the email arrived. */
    receivedAt: string;
    timezone: string;
    /** The sender's display name, when the reading names no provider. */
    senderName: string | null;
    reading: AppointmentExtraction;
  },
): Promise<{ appointmentId: string | null; unmatched: boolean }> {
  const { userId, reading } = opts;
  const provider = reading.provider ?? opts.senderName;
  const key = providerKey(provider ?? reading.title);

  const { data, error } = await supabase
    .from('appointments')
    .select('id, reference, starts_on, starts_at, status, as_of')
    .eq('user_id', userId)
    .eq('provider_key', key)
    .order('starts_on', { ascending: false })
    .limit(50);
  if (error) throw new Error(`appointment lookup failed: ${error.message}`);

  const candidates: StoredAppointment[] = (data ?? []).map((row) => ({
    id: row.id as string,
    reference: (row.reference as string | null) ?? null,
    startsOn: row.starts_on as string,
    startsAt: (row.starts_at as string | null) ?? null,
    status: row.status as StoredAppointment['status'],
    asOf: row.as_of as string,
  }));

  const decision = resolveAppointment({
    reading,
    candidates,
    receivedAt: opts.receivedAt,
    timezone: opts.timezone,
  });

  switch (decision.action) {
    case 'unmatched':
      return { appointmentId: null, unmatched: true };

    case 'stale':
      return { appointmentId: decision.id, unmatched: false };

    case 'insert': {
      const { data: inserted, error: insertError } = await supabase
        .from('appointments')
        .insert({
          user_id: userId,
          title: reading.title,
          provider,
          provider_key: key,
          reference: reading.reference,
          starts_on: decision.when.startsOn,
          starts_at: decision.when.startsAt,
          ends_at: decision.when.endsAt,
          location: reading.location,
          status: decision.status,
          as_of: opts.receivedAt,
          source_message_id: opts.messageId,
        })
        .select('id')
        .single();
      if (insertError) throw new Error(`appointment insert failed: ${insertError.message}`);
      return { appointmentId: inserted.id as string, unmatched: false };
    }

    case 'update': {
      const patch: Record<string, unknown> = {
        status: decision.status,
        as_of: opts.receivedAt,
        source_message_id: opts.messageId,
      };
      if (decision.when) {
        patch.starts_on = decision.when.startsOn;
        patch.starts_at = decision.when.startsAt;
        patch.ends_at = decision.when.endsAt;
      }
      // A cancellation's title is often "Your appointment"; keep the booking's.
      if (decision.status === 'booked') patch.title = reading.title;
      if (reading.reference) patch.reference = reading.reference;
      if (reading.location) patch.location = reading.location;

      const { error: updateError } = await supabase
        .from('appointments')
        .update(patch)
        .eq('id', decision.id)
        .eq('user_id', userId);
      if (updateError) throw new Error(`appointment update failed: ${updateError.message}`);
      return { appointmentId: decision.id, unmatched: false };
    }
  }
}
