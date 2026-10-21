import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { wallClockToInstant } from '@/lib/todo/time';

/**
 * Writing an event.
 *
 * Everything a form sends is parsed through Zod first, the house rule for
 * anything crossing into the database, and the all-day/timed split is decided
 * in exactly one place below -- the same arrangement lib/todo/tasks/write.ts
 * uses for the two due columns, and for the same reason: two callers deciding
 * it separately is two chances to disagree about what 15:00 means.
 */

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-03-10');

/** A date field left blank arrives as ''. Treat it as absent, not as invalid. */
const optionalDay = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(day.nullable());

const optionalTime = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 14:30').nullable());

export const eventInput = z.object({
  title: z.string().trim().min(1, 'Give it a title.').max(500, 'That title is too long.'),
  body: z
    .string()
    .trim()
    .max(20_000)
    .transform((value) => value || null),
  location: z
    .string()
    .trim()
    .max(500, 'That place is too long.')
    .transform((value) => value || null),
  allDay: z.boolean().default(false),
  startDay: day,
  /** Blank means the event ends on the day it starts. */
  endDay: optionalDay,
  startTime: optionalTime,
  endTime: optionalTime,
});

export type EventInput = z.infer<typeof eventInput>;

export interface EventSpan {
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

/**
 * The one place a form's answer about when becomes the four columns.
 *
 * All day is a pair of dates, which never move: a week off is the same week
 * wherever you read it from. A timed event is a pair of instants, built by
 * asking the reader's zone what those wall clocks mean, because "15:00 on
 * Thursday" is a promise about their clock rather than about UTC.
 *
 * An end before its start is refused here as well as by the check constraint
 * on the table, so a form can say which field is wrong instead of showing a
 * database error.
 */
export function resolveSpan(
  input: Omit<EventInput, 'title' | 'body' | 'location'>,
  timezone: string,
): { span: EventSpan | null; error: string | null } {
  // Blank as well as absent: the field arrives as '' from a form and as null
  // once Zod has read it, and both mean "the day it starts on".
  const ends = input.endDay || input.startDay;

  if (input.allDay) {
    if (ends < input.startDay) return { span: null, error: 'It cannot end before it starts.' };
    return {
      span: { starts_on: input.startDay, ends_on: ends, starts_at: null, ends_at: null },
      error: null,
    };
  }

  if (!input.startTime || !input.endTime) {
    return { span: null, error: 'Give it a start and an end time, or mark it all day.' };
  }

  const starts_at = wallClockToInstant(input.startDay, input.startTime, timezone);
  const ends_at = wallClockToInstant(ends, input.endTime, timezone);
  if (ends_at < starts_at) return { span: null, error: 'It cannot end before it starts.' };

  return { span: { starts_on: null, ends_on: null, starts_at, ends_at }, error: null };
}

/** An event as the table holds it, for a caller that keeps what it wrote (Dash's Undo). */
export type EventRow = Record<string, unknown>;

/** When an event is, as the form sends it once parsed. */
export type EventWhen = Omit<EventInput, 'title' | 'body' | 'location'>;

/**
 * Written by the calendar's form and by Dash's add_event (plan #2473.3), so
 * the two keep the same rules.
 */
export async function createEvent(
  userId: string,
  input: EventInput,
  timezone: string,
  client?: TodoSupabaseClient,
): Promise<{ id: string | null; row: EventRow | null; error: string | null }> {
  const { span, error: spanError } = resolveSpan(input, timezone);
  if (!span) return { id: null, row: null, error: spanError };

  const supabase = client ?? (await createTodoClient());

  const { data, error } = await supabase
    .from('events')
    .insert({
      user_id: userId,
      title: input.title,
      body: input.body,
      location: input.location,
      ...span,
    })
    .select('*')
    .single();

  const row = (data as EventRow | null) ?? null;
  return { id: (row?.id as string) ?? null, row, error: error?.message ?? null };
}

export async function updateEvent(
  userId: string,
  id: string,
  input: EventInput,
  timezone: string,
): Promise<{ error: string | null }> {
  const { error } = await updateEventFields(
    userId,
    id,
    { title: input.title, body: input.body, location: input.location, when: input },
    timezone,
  );
  return { error };
}

/** The parts of an event one write changes, each already parsed through eventInput. */
export type EventFields = { title?: string; body?: string | null; location?: string | null; when?: EventWhen };

/**
 * The one write behind changing an event: the calendar's form, which sends
 * every field, and Dash's change_event, which sends what changes (plan
 * #2473.3). A field left out is left alone. Scoped to the user, so a borrowed
 * id changes nothing and comes back as no row.
 */
export async function updateEventFields(
  userId: string,
  id: string,
  fields: EventFields,
  timezone: string,
  client?: TodoSupabaseClient,
): Promise<{ row: EventRow | null; error: string | null }> {
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.body !== undefined) patch.body = fields.body;
  if (fields.location !== undefined) patch.location = fields.location;
  if (fields.when) {
    const { span, error: spanError } = resolveSpan(fields.when, timezone);
    if (!span) return { row: null, error: spanError };
    Object.assign(patch, span);
  }
  if (Object.keys(patch).length === 0) return { row: null, error: 'Nothing to change.' };

  const supabase = client ?? (await createTodoClient());
  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();

  return { row: (data as EventRow | null) ?? null, error: error?.message ?? null };
}

export async function deleteEvent(userId: string, id: string): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();
  const { error } = await supabase.from('events').delete().eq('id', id).eq('user_id', userId);
  return { error: error?.message ?? null };
}
