import { describe, expect, it } from 'vitest';
import { debriefsDue, type DebriefInterview } from './debrief';

const NOW = new Date('2026-10-07T20:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function interview(id: string, scheduledAt: string, extra: Partial<DebriefInterview> = {}): DebriefInterview {
  return {
    id,
    scheduledAt,
    timeKnown: true,
    groupId: null,
    notes: null,
    roleId: `role-${id}`,
    companyName: 'Monzo',
    roleTitle: 'Backend Engineer',
    ...extra,
  };
}

describe('debriefsDue', () => {
  it('asks for the rounds just over with nothing written, the newest first', () => {
    const due = debriefsDue(
      [
        interview('today', hoursAgo(3)),
        interview('yesterday', hoursAgo(27)),
        interview('written', hoursAgo(5), { notes: 'Went well.' }),
        interview('stale', hoursAgo(24 * 5)),
        interview('later', new Date(NOW.getTime() + HOUR).toISOString()),
      ],
      [],
      NOW,
    );
    expect(due.map((d) => d.leadId)).toEqual(['today', 'yesterday']);
  });

  it('takes a round as one, over when its last conversation is and written if any of it is', () => {
    const due = debriefsDue(
      [
        interview('a1', hoursAgo(6), { groupId: 'g1' }),
        interview('a2', hoursAgo(4), { groupId: 'g1' }),
        interview('b1', hoursAgo(6), { groupId: 'g2' }),
        interview('b2', hoursAgo(5), { groupId: 'g2', notes: 'Notes on the second.' }),
        interview('c1', hoursAgo(3), { groupId: 'g3' }),
      ],
      [
        { id: 'g1', label: null, notes: '' },
        { id: 'g2', label: null, notes: '' },
        { id: 'g3', label: null, notes: 'Written on the round.' },
      ],
      NOW,
    );
    expect(due).toEqual([expect.objectContaining({ key: 'g1', leadId: 'a1' })]);
  });

  it('keeps a day-only round open until its day is out', () => {
    const midnight = '2026-10-07T00:00:00.000Z';
    expect(debriefsDue([interview('d', midnight, { timeKnown: false })], [], NOW)).toEqual([]);
  });
});
