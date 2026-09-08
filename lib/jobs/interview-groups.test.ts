import { describe, expect, it } from 'vitest';
import {
  dayIn,
  groupableDays,
  sectionInterviews,
  type GroupableInterview,
  type InterviewGroup,
} from '@/lib/jobs/interview-groups';

function interview(over: Partial<GroupableInterview> & { id: string }): GroupableInterview {
  return { scheduledAt: null, groupId: null, ...over };
}

const SUPERDAY: InterviewGroup = { id: 'g1', label: '12 March', notes: '' };

describe('sectionInterviews', () => {
  it('gathers a group at the position of its first round', () => {
    const sections = sectionInterviews(
      [
        interview({ id: 'a' }),
        interview({ id: 'b', groupId: 'g1' }),
        interview({ id: 'c' }),
        interview({ id: 'd', groupId: 'g1' }),
      ],
      [SUPERDAY],
    );

    expect(sections.map((s) => (s.kind === 'group' ? s.group.id : s.interview.id))).toEqual([
      'a',
      'g1',
      'c',
    ]);
    const group = sections[1];
    expect(group.kind === 'group' && group.interviews.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('shows every round exactly once', () => {
    const rounds = [
      interview({ id: 'a', groupId: 'g1' }),
      interview({ id: 'b', groupId: 'g1' }),
      interview({ id: 'c' }),
    ];
    const seen = sectionInterviews(rounds, [SUPERDAY]).flatMap((s) =>
      s.kind === 'group' ? s.interviews.map((i) => i.id) : [s.interview.id],
    );
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });

  it('lists a round with nothing booked into it yet, after the rest', () => {
    const empty: InterviewGroup = { id: 'g2', label: 'Technical round', notes: '' };
    const sections = sectionInterviews(
      [interview({ id: 'a' }), interview({ id: 'b', groupId: 'g1' })],
      [SUPERDAY, empty],
    );

    expect(sections.map((s) => (s.kind === 'group' ? s.group.id : s.interview.id))).toEqual([
      'a',
      'g1',
      'g2',
    ]);
    const round = sections[2];
    expect(round.kind === 'group' && round.interviews).toEqual([]);
  });

  it('renders a round on its own rather than losing it when its group is missing', () => {
    const sections = sectionInterviews([interview({ id: 'a', groupId: 'gone' })], []);
    expect(sections).toEqual([{ kind: 'single', interview: interview({ id: 'a', groupId: 'gone' }) }]);
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
