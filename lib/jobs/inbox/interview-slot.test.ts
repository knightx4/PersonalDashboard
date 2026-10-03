/**
 * Which booked interview a newly read time is the same interview as.
 *
 * Three pursuits have two interview rows at one time in the live data: twice
 * an invite and a date read from the covering note, once two notes read in the
 * same sync. The unique index covers only rows with an ics_uid, so this match
 * is what keeps the second row out.
 */
import { describe, expect, it } from 'vitest';
import { interviewInSlot, SAME_SLOT_MS, type BookedInterview } from '@/lib/jobs/inbox/ingest-messages';

function row(over: Partial<BookedInterview> = {}): BookedInterview {
  return { id: 'i-1', scheduled_at: '2026-10-05 16:30:00+00', status: 'scheduled', ics_uid: null, ...over };
}

describe('interviewInSlot', () => {
  it('matches the same time written the way Postgres and the model each write it', () => {
    expect(interviewInSlot([row()], '2026-10-05T16:30:00Z')?.id).toBe('i-1');
  });

  it('allows a few minutes either side and no more', () => {
    expect(SAME_SLOT_MS).toBe(5 * 60_000);
    expect(interviewInSlot([row()], '2026-10-05T16:35:00Z')?.id).toBe('i-1');
    expect(interviewInSlot([row()], '2026-10-05T16:25:00Z')?.id).toBe('i-1');
    expect(interviewInSlot([row()], '2026-10-05T16:36:00Z')).toBeNull();
  });

  it('takes the nearest where two are close', () => {
    const rows = [row({ id: 'far', scheduled_at: '2026-10-05T16:34:00Z' }), row({ id: 'near', scheduled_at: '2026-10-05T16:31:00Z' })];
    expect(interviewInSlot(rows, '2026-10-05T16:30:00Z')?.id).toBe('near');
  });

  it('passes over a cancelled interview and one with no time', () => {
    expect(interviewInSlot([row({ status: 'cancelled' }), row({ id: 'x', scheduled_at: null })], '2026-10-05T16:30:00Z')).toBeNull();
  });

  it('matches an invite-booked row for a prose date, but not for another invite', () => {
    const invited = row({ ics_uid: 'abc@google.com' });
    expect(interviewInSlot([invited], '2026-10-05T16:30:00Z')?.id).toBe('i-1');
    expect(interviewInSlot([invited], '2026-10-05T16:30:00Z', { uidless: true })).toBeNull();
  });

  it('matches nothing for a time it cannot read', () => {
    expect(interviewInSlot([row()], 'next Tuesday')).toBeNull();
  });
});
