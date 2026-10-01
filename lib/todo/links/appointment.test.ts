import { describe, expect, it } from 'vitest';
import { matchAppointments, savedStartAsOccurrence } from '@/lib/todo/links/appointment';
import type { AppointmentRef } from '@/lib/todo/links/model';

const FEED = 'feed-1';

function ref(overrides: Partial<AppointmentRef> = {}): AppointmentRef {
  return {
    feedId: FEED,
    uid: 'review@acme',
    occurrence: '2026-03-24T10:00:00.000Z',
    title: 'Weekly review',
    startsOn: null,
    startsAt: '2026-03-24T10:00:00+00:00',
    ...overrides,
  };
}

function copy(occurrence: string | null, title = 'Weekly review', uid = 'review@acme', feedId = FEED) {
  return { feedId, uid, occurrence, title };
}

describe('matchAppointments', () => {
  it('finds the date of a repeating meeting a task is about, and not its other dates', () => {
    const link = ref();
    const tuesday = copy('2026-03-24T10:00:00.000Z');
    const nextTuesday = copy('2026-03-31T10:00:00.000Z');

    expect(matchAppointments([link], [nextTuesday, tuesday]).get(link)).toBe(tuesday);
  });

  it('follows a moved or renamed date, which keeps its original start', () => {
    const link = ref();
    const moved = copy('2026-03-24T10:00:00.000Z', 'Weekly review (moved to Wednesday)');

    expect(matchAppointments([link], [moved]).get(link)?.title).toBe(
      'Weekly review (moved to Wednesday)',
    );
  });

  it('matches a one-off on its UID alone', () => {
    const link = ref({ uid: 'interview@acme', occurrence: null, startsAt: '2026-04-02T14:00:00Z' });
    const interview = copy(null, 'Interview', 'interview@acme');

    expect(matchAppointments([link], [interview]).get(link)).toBe(interview);
  });

  it('answers null once the calendar no longer has it', () => {
    const link = ref();
    expect(matchAppointments([link], [copy('2026-03-31T10:00:00.000Z')]).get(link)).toBeNull();
  });

  it('keeps two subscriptions apart even when they reuse a UID', () => {
    const link = ref();
    const elsewhere = copy('2026-03-24T10:00:00.000Z', 'Somebody else', 'review@acme', 'feed-2');

    expect(matchAppointments([link], [elsewhere]).get(link)).toBeNull();
  });

  it('finds a link saved before dates were told apart by the start it saved', () => {
    // Linked from a row written before plan #1372, so no occurrence was saved;
    // the refreshed copy now carries one, equal to the start the link saved.
    const link = ref({ occurrence: null });
    const tuesday = copy('2026-03-24T10:00:00.000Z');

    expect(matchAppointments([link], [copy('2026-03-31T10:00:00.000Z'), tuesday]).get(link)).toBe(
      tuesday,
    );
  });
});

describe('savedStartAsOccurrence', () => {
  it('writes a whole-day start as its day and a timed one as a UTC instant', () => {
    expect(savedStartAsOccurrence({ startsOn: '2026-03-24', startsAt: null })).toBe('2026-03-24');
    expect(savedStartAsOccurrence({ startsOn: null, startsAt: '2026-03-24T11:00:00+01:00' })).toBe(
      '2026-03-24T10:00:00.000Z',
    );
  });
});
