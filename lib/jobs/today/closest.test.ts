import { describe, expect, it } from 'vitest';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { TodayBoard } from './load';
import { closestToOffer, withoutClosestDebriefs, type ClosestInterview } from './closest';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

function row(id: string, status: ApplicationStatus): PipelineRow {
  return {
    applicationId: id,
    roleId: `role-${id}`,
    companyName: `Company ${id}`,
    roleTitle: 'Analyst',
    status,
  } as PipelineRow;
}

function interview(
  id: string,
  applicationId: string,
  scheduledAt: string | null,
  extra: Partial<ClosestInterview> = {},
): ClosestInterview {
  return {
    id,
    applicationId,
    scheduledAt,
    timeKnown: true,
    status: 'scheduled',
    groupId: null,
    prepNotes: null,
    hasPrepNote: false,
    notes: null,
    questionsAsked: null,
    group: null,
    ...extra,
  };
}

describe('closestToOffer', () => {
  it('keeps final round and in process only, final first, then the soonest round', () => {
    const apps = closestToOffer(
      [
        row('late', 'in_process'),
        row('none', 'in_process'),
        row('lead', 'lead'),
        row('final', 'final_round'),
        row('soon', 'in_process'),
        row('sent', 'submitted'),
      ],
      [interview('l1', 'late', at(5)), interview('s1', 'soon', at(1))],
      NOW,
    );
    expect(apps.map((app) => app.applicationId)).toEqual(['final', 'soon', 'late', 'none']);
    expect(apps[3].next).toBeNull();
  });

  it('names the next round, says whether it is prepped, and counts what earlier rounds left', () => {
    const group = { id: 'g2', label: 'Technical', roundNumber: 2, notes: '' };
    const [app] = closestToOffer(
      [row('a', 'in_process')],
      [
        interview('r1', 'a', at(-10), {
          notes: 'Asked about the close process.',
          questionsAsked: ['Walk me through a forecast you owned', 'Why leave audit?'],
        }),
        interview('r2a', 'a', at(2), { groupId: 'g2', group }),
        interview('r2b', 'a', at(2.1), { groupId: 'g2', group, hasPrepNote: true }),
        interview('gone', 'a', at(1), { status: 'cancelled' }),
      ],
      NOW,
    );
    expect(app.next).toMatchObject({ key: 'g2', leadId: 'r2a', label: '2 · Technical', prepped: true });
    expect(app.earlierPrep).toBeNull();
    expect(app.earlier).toEqual({
      rounds: 1,
      written: 1,
      questions: 2,
      firstQuestion: 'Walk me through a forecast you owned',
    });
    expect(app.debriefs).toEqual([]);
  });

  it('holds a day-only round as next until its day is out', () => {
    const [app] = closestToOffer(
      [row('a', 'final_round')],
      [interview('d', 'a', '2026-10-13T00:00:00.000Z', { timeKnown: false })],
      NOW,
    );
    expect(app.next?.leadId).toBe('d');
    expect(app.earlier.rounds).toBe(0);
  });

  it('asks for a debrief on the latest round over, and older ones only inside the window', () => {
    const [app] = closestToOffer(
      [row('a', 'final_round')],
      [interview('old', 'a', at(-20)), interview('last', 'a', at(-9), { prepNotes: 'Read the 10-K.' })],
      NOW,
    );
    expect(app.debriefs.map((round) => round.leadId)).toEqual(['last']);
    expect(app.next).toBeNull();
    // No round booked, so the prep already written is offered instead.
    expect(app.earlierPrep?.leadId).toBe('last');

    const [recent] = closestToOffer(
      [row('a', 'in_process')],
      [interview('one', 'a', at(-2)), interview('two', 'a', at(-1))],
      NOW,
    );
    expect(recent.debriefs.map((round) => round.leadId)).toEqual(['two', 'one']);
  });
});

describe('withoutClosestDebriefs', () => {
  it('takes the rounds the section asks about out of This week, and says when the week is clear', () => {
    const board = {
      interviews: [],
      reminders: [],
      waiting: [],
      debriefs: [{ key: 'x' }, { key: 'y' }],
      clear: false,
    } as unknown as TodayBoard;
    const [app] = closestToOffer([row('a', 'in_process')], [interview('x', 'a', at(-1))], NOW);
    const once = withoutClosestDebriefs(board, [app]);
    expect(once.debriefs.map((d) => d.key)).toEqual(['y']);
    expect(once.clear).toBe(false);
    const twice = withoutClosestDebriefs(once, [
      { ...app, debriefs: [{ ...app.debriefs[0], key: 'y' }] },
    ]);
    expect(twice.clear).toBe(true);
  });
});
