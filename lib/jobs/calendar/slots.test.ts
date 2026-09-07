import { describe, expect, it } from 'vitest';
import { pairSlots } from '@/lib/jobs/calendar/slots';

describe('pairing a message with the rounds already booked', () => {
  it('pairs on the instant when the two agree', () => {
    expect(
      pairSlots(
        [{ at: '2026-09-15T14:30:00Z' }],
        [
          { id: 'a', scheduledAt: '2026-09-15T14:30:00Z' },
          { id: 'b', scheduledAt: '2026-09-16T14:30:00Z' },
        ],
      ),
    ).toEqual([{ slotIndex: 0, interviewId: 'a' }]);
  });

  it('pairs a whole schedule stored in the wrong zone', () => {
    // The real Galaxy superday: the invites carry `Eastern Standard Time`,
    // which Intl does not know, so all four are stored four hours early. The
    // gaps between them are still exactly the gaps the body describes.
    const pairs = pairSlots(
      [
        { at: '2026-09-15T10:30:00-04:00' },
        { at: '2026-09-15T11:45:00-04:00' },
        { at: '2026-09-15T12:15:00-04:00' },
        { at: '2026-09-15T12:45:00-04:00' },
      ],
      [
        { id: 'first', scheduledAt: '2026-09-15T10:30:00+00:00' },
        { id: 'second', scheduledAt: '2026-09-15T11:45:00+00:00' },
        { id: 'third', scheduledAt: '2026-09-15T12:15:00+00:00' },
        { id: 'fourth', scheduledAt: '2026-09-15T12:45:00+00:00' },
      ],
    );

    expect(pairs).toEqual([
      { slotIndex: 0, interviewId: 'first' },
      { slotIndex: 1, interviewId: 'second' },
      { slotIndex: 2, interviewId: 'third' },
      { slotIndex: 3, interviewId: 'fourth' },
    ]);
  });

  it('refuses a shift that is a different schedule rather than a zone', () => {
    expect(
      pairSlots(
        [{ at: '2026-09-15T14:30:00Z' }],
        [{ id: 'a', scheduledAt: '2026-09-22T14:30:00Z' }],
      ),
    ).toEqual([]);
  });

  it('refuses times whose gaps do not match', () => {
    expect(
      pairSlots(
        [{ at: '2026-09-15T14:30:00Z' }, { at: '2026-09-15T15:00:00Z' }],
        [
          { id: 'a', scheduledAt: '2026-09-15T10:30:00Z' },
          { id: 'b', scheduledAt: '2026-09-15T16:00:00Z' },
        ],
      ),
    ).toEqual([]);
  });

  it('pairs nothing when the counts differ and no instant matches', () => {
    expect(
      pairSlots(
        [{ at: '2026-09-15T14:30:00Z' }, { at: '2026-09-15T15:00:00Z' }],
        [{ id: 'a', scheduledAt: '2026-09-15T10:30:00Z' }],
      ),
    ).toEqual([]);
  });

  it('ignores a time it cannot read', () => {
    expect(pairSlots([{ at: 'soon' }], [{ id: 'a', scheduledAt: '2026-09-15T14:30:00Z' }])).toEqual(
      [],
    );
  });
});
