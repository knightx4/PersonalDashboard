import { movedColumns } from '@/lib/core/dash-actions';
import { recordScheduled, scheduledBefore } from '@/lib/core/scheduled-actions';
import { formatWeekday } from '@/lib/goals/dates';

/**
 * Recording the appointments the mail sync files into Todo (plan #1577,
 * feature #1456).
 *
 * A booking email adds an appointment and a later one moves or cancels it.
 * Each is one record on the appointment, so Home lists it with an Undo: the
 * add's removes the appointment, and a move's or cancellation's puts back the
 * day, time and status it had. The verdict on the email stays, so an undone
 * appointment is not read in again by the next sync.
 */

type Row = Record<string, unknown>;

/** The ref an appointment is recorded under. */
export function appointmentRef(id: string): string {
  return `todo.appointments:${id}`;
}

/** Which email last spoke for the row: moves on every filing, and nobody reads it. */
const BOOKKEEPING = new Set(['as_of', 'source_message_id']);

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function which(row: Row): string {
  const provider = text(row.provider);
  if (provider) return `your appointment with ${provider}`;
  const title = text(row.title);
  return title ? `"${title}"` : 'your appointment';
}

function when(row: Row): string {
  const day = text(row.starts_on);
  return day ? formatWeekday(day) : 'its day';
}

/** The sentence Home reads for an appointment the sync added or changed. */
export function appointmentSummary(op: 'insert' | 'update', after: Row, before: Row | null): string {
  const name = which(after);
  if (op === 'insert') {
    return after.status === 'cancelled'
      ? `Dash filed ${name} on ${when(after)} in Todo, already cancelled.`
      : `Dash added ${name} on ${when(after)} to Todo.`;
  }
  if (after.status === 'cancelled' && before?.status !== 'cancelled') {
    return `Dash marked ${name} on ${when(after)} cancelled.`;
  }
  if (after.status === 'booked' && before?.status === 'cancelled') {
    return `Dash marked ${name} on ${when(after)} booked again.`;
  }
  if (before && (before.starts_on !== after.starts_on || before.starts_at !== after.starts_at)) {
    return `Dash moved ${name} to ${when(after)}.`;
  }
  return `Dash updated ${name} on ${when(after)}.`;
}

/** Record an appointment the sync has just added. */
export async function recordAppointmentAdded(client: unknown, userId: string, id: string): Promise<string | null> {
  const ref = appointmentRef(id);
  const after = await scheduledBefore(client, userId, ref);
  if (!after) return null;
  return recordScheduled(client, userId, {
    kind: 'add_appointment',
    subjectRef: ref,
    op: 'insert',
    summary: appointmentSummary('insert', after, null),
  });
}

/**
 * Record a later email's change to an appointment, given the row as it was
 * before. An email that only confirmed what the row already held records
 * nothing.
 */
export async function recordAppointmentChanged(
  client: unknown,
  userId: string,
  id: string,
  before: Row | null,
): Promise<string | null> {
  if (!before) return null;
  const ref = appointmentRef(id);
  const after = await scheduledBefore(client, userId, ref);
  if (!after) return null;
  const seen = Object.fromEntries(Object.entries(before).filter(([key]) => !BOOKKEEPING.has(key)));
  if (movedColumns(after, seen).length === 0) return null;
  return recordScheduled(client, userId, {
    kind: 'update_appointment',
    subjectRef: ref,
    op: 'update',
    beforeValues: before,
    summary: appointmentSummary('update', after, before),
  });
}
