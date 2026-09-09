import { describe, expect, it } from 'vitest';
import {
  dayIn,
  groupableDays,
  roundsOf,
  sectionInterviews,
  type GroupableInterview,
  type InterviewGroup,
} from '@/lib/jobs/interview-groups';

function interview(over: Partial<GroupableInterview> & { id: string }): GroupableInterview {
  return { scheduledAt: null, groupId: null, ...over };
}

const SUPERDAY: InterviewGroup = { id: 'g1', label: '12 March', roundNumber: 2, notes: '' };
const SCREEN: InterviewGroup = { id: 'g0', label: null, roundNumber: 1, notes: '' };

describe('sectionInterviews', () => {
  it('gathers each round, with its interviews inside it', () => {
    const sections = sectionInterviews(
      [
        interview({ id: 'a', groupId: 'g0' }),
        interview({ id: 'b', groupId: 'g1' }),
        interview({ id: 'd', groupId: 'g1' }),
      ],
      [SCREEN, SUPERDAY],
    );

    expect(sections.map((s) => (s.kind === 'group' ? s.group.id : s.interview.id))).toEqual([
      'g0',
      'g1',
    ]);
    const group = sections[1];
    expect(group.kind === 'group' && group.interviews.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('puts the first round first, whatever order the rounds arrive in', () => {
    const third: InterviewGroup = { id: 'g2', label: 'Final', roundNumber: 3, notes: '' };
    const sections = sectionInterviews(
      [
        interview({ id: 'c', groupId: 'g2' }),
        interview({ id: 'b', groupId: 'g1' }),
        interview({ id: 'a', groupId: 'g0' }),
      ],
      [third, SUPERDAY, SCREEN],
    );

    expect(sections.map((s) => (s.kind === 'group' ? s.group.id : s.interview.id))).toEqual([
      'g0',
      'g1',
      'g2',
    ]);
  });

  it('sorts a round nobody has numbered after the ones that are placed', () => {
    const unplaced: InterviewGroup = { id: 'g9', label: null, roundNumber: null, notes: '' };
    const sections = sectionInterviews(
      [interview({ id: 'a', groupId: 'g9' }), interview({ id: 'b', groupId: 'g0' })],
      [unplaced, SCREEN],
    );

    expect(sections.map((s) => (s.kind === 'group' ? s.group.id : s.interview.id))).toEqual([
      'g0',
      'g9',
    ]);
  });

  it('shows every interview exactly once', () => {
    const rounds = [
      interview({ id: 'a', groupId: 'g1' }),
      interview({ id: 'b', groupId: 'g1' }),
      interview({ id: 'c', groupId: 'g0' }),
    ];
    const seen = sectionInterviews(rounds, [SCREEN, SUPERDAY]).flatMap((s) =>
      s.kind === 'group' ? s.interviews.map((i) => i.id) : [s.interview.id],
    );
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });

  it('lists a round with nothing booked into it yet, in its own place', () => {
    const empty: InterviewGroup = { id: 'g2', label: 'Technical round', roundNumber: 3, notes: '' };
    const sections = sectionInterviews([interview({ id: 'b', groupId: 'g1' })], [SUPERDAY, empty]);

    expect(sections.map((s) => (s.kind === 'group' ? s.group.id : s.interview.id))).toEqual([
      'g1',
      'g2',
    ]);
    const round = sections[1];
    expect(round.kind === 'group' && round.interviews).toEqual([]);
  });

  it('renders an interview on its own rather than losing it when its round is missing', () => {
    const sections = sectionInterviews([interview({ id: 'a', groupId: 'gone' })], []);
    expect(sections).toEqual([{ kind: 'single', interview: interview({ id: 'a', groupId: 'gone' }) }]);
  });

  it('keeps a stray interview at the end rather than among the rounds', () => {
    const sections = sectionInterviews(
      [interview({ id: 'stray', groupId: 'gone' }), interview({ id: 'a', groupId: 'g0' })],
      [SCREEN],
    );

    expect(sections.map((s) => (s.kind === 'group' ? s.group.id : s.interview.id))).toEqual([
      'g0',
      'stray',
    ]);
  });
});

describe('groupableDays', () => {
  it('offers a day that holds interviews from more than one round', () => {
    expect(
      groupableDays(
        [
          interview({ id: 'a', scheduledAt: '2026-03-12T14:00:00.000Z', groupId: 'r1' }),
          interview({ id: 'b', scheduledAt: '2026-03-12T16:00:00.000Z', groupId: 'r2' }),
          interview({ id: 'c', scheduledAt: '2026-03-19T16:00:00.000Z', groupId: 'r3' }),
        ],
        'UTC',
      ),
    ).toEqual([{ day: '2026-03-12', interviewIds: ['a', 'b'] }]);
  });

  it('says nothing about a day whose interviews are already one round', () => {
    expect(
      groupableDays(
        [
          interview({ id: 'a', scheduledAt: '2026-03-12T14:00:00.000Z', groupId: 'r1' }),
          interview({ id: 'b', scheduledAt: '2026-03-12T16:00:00.000Z', groupId: 'r1' }),
        ],
        'UTC',
      ),
    ).toEqual([]);
  });

  it('leaves a round somebody has built up out of it entirely', () => {
    // r1 holds two conversations because the user put them together. Offering
    // to gather one of them into a new round would undo that decision.
    expect(
      groupableDays(
        [
          interview({ id: 'a', scheduledAt: '2026-03-12T14:00:00.000Z', groupId: 'r1' }),
          interview({ id: 'b', scheduledAt: '2026-03-12T16:00:00.000Z', groupId: 'r1' }),
          interview({ id: 'c', scheduledAt: '2026-03-12T18:00:00.000Z', groupId: 'r2' }),
        ],
        'UTC',
      ),
    ).toEqual([]);
  });

  it('says nothing about a day holding a single round', () => {
    expect(
      groupableDays(
        [interview({ id: 'a', scheduledAt: '2026-03-12T14:00:00.000Z', groupId: 'r1' })],
        'UTC',
      ),
    ).toEqual([]);
  });

  it('ignores a round with no time on it at all', () => {
    expect(
      groupableDays([interview({ id: 'a' }), interview({ id: 'b' })], 'UTC'),
    ).toEqual([]);
  });

  it('reads the day in the reader’s zone, not UTC', () => {
    // 23:00 and 01:00 UTC are one Tokyo day; in UTC they are two.
    const rounds = [
      interview({ id: 'a', scheduledAt: '2026-03-12T23:00:00.000Z', groupId: 'r1' }),
      interview({ id: 'b', scheduledAt: '2026-03-13T01:00:00.000Z', groupId: 'r2' }),
    ];
    expect(groupableDays(rounds, 'Asia/Tokyo')).toEqual([
      { day: '2026-03-13', interviewIds: ['a', 'b'] },
    ]);
    expect(groupableDays(rounds, 'UTC')).toEqual([]);
  });
});

describe('dayIn', () => {
  it('formats as YYYY-MM-DD in the given zone', () => {
    expect(dayIn('2026-03-12T23:00:00.000Z', 'Asia/Tokyo')).toBe('2026-03-13');
    expect(dayIn('2026-03-12T23:00:00.000Z', 'UTC')).toBe('2026-03-12');
  });
});

describe('roundsOf', () => {
  it('collapses a round into one row, keeping its interviews in order', () => {
    const rows = roundsOf(
      [
        interview({ id: 'a', scheduledAt: '2026-03-12T09:00:00.000Z', groupId: 'g1' }),
        interview({ id: 'b', scheduledAt: '2026-03-12T10:00:00.000Z', groupId: 'g1' }),
        interview({ id: 'c', scheduledAt: '2026-03-12T11:00:00.000Z', groupId: 'g1' }),
      ],
      [SUPERDAY],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].group).toBe(SUPERDAY);
    expect(rows[0].interviews.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0].lead.id).toBe('a');
  });

  it('keeps the order it was given, per round', () => {
    const rows = roundsOf(
      [
        interview({ id: 'screen', scheduledAt: '2026-03-10T09:00:00.000Z', groupId: 'g0' }),
        interview({ id: 'day-1', scheduledAt: '2026-03-12T09:00:00.000Z', groupId: 'g1' }),
        interview({ id: 'day-2', scheduledAt: '2026-03-12T10:00:00.000Z', groupId: 'g1' }),
      ],
      [SUPERDAY, SCREEN],
    );
    // The superday is round 2 and sorts first by number, but this list was
    // given in date order and stays in it.
    expect(rows.map((row) => row.lead.id)).toEqual(['screen', 'day-1']);
  });

  it('stands an interview on its own when its round is not among the groups', () => {
    const rows = roundsOf(
      [interview({ id: 'a', groupId: 'gone' }), interview({ id: 'b', groupId: null })],
      [SCREEN],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.group)).toEqual([null, null]);
  });

  it('has no row for a round with nothing in it', () => {
    expect(roundsOf([], [SUPERDAY])).toEqual([]);
  });
});
