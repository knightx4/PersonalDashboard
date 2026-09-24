import { describe, expect, it } from 'vitest';
import type { WikipediaSection } from '@/lib/learn/providers/wikipedia';
import { NO_PROGRESS, contextFor } from './depth';
import {
  dueAt,
  dueReturns,
  earlierTitles,
  freshSections,
  isDue,
  LEVEL3_RETURN_GAP_DAYS,
  level3Picks,
  resolveLevel3Picks,
  returnGapDays,
  type Level3Claimed,
  type ReturnAngleRequest,
} from './level3';

/**
 * When a claimed Level 3 article comes back, and at what angle (plan #912,
 * decision #911): a week after the Got it, then a month, then three months,
 * each time at a section no earlier card was cut from.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-24T12:00:00Z');

function claimed(title: string, daysAgo: number, overrides: Partial<Level3Claimed> = {}): Level3Claimed {
  const at = new Date(NOW - daysAgo * DAY).toISOString();
  return { title, section: 'Science > Things', claimedAt: at, lastSeenAt: at, returns: 0, earlier: [null], ...overrides };
}

function sections(...headings: (string | null)[]): WikipediaSection[] {
  return headings.map((heading, ordinal) => ({ ordinal, anchor: heading, heading, text: 'Text.' }));
}

const depth = contextFor(NO_PROGRESS, { reason: 'goal', aimId: 'l3', start: 'working' });

describe('the return gaps', () => {
  it('grows from a week to a month to three months, then stays there', () => {
    expect(LEVEL3_RETURN_GAP_DAYS).toEqual([7, 30, 90]);
    expect([0, 1, 2, 3, 9].map((returns) => returnGapDays(returns))).toEqual([7, 30, 90, 90, 90]);
  });

  it('takes other gaps when given them', () => {
    expect(returnGapDays(1, [2, 4])).toBe(4);
    expect(returnGapDays(5, [2, 4])).toBe(4);
  });
});

describe('whether a claimed article is due', () => {
  it('is not due a few days after the Got it, and is due after a week', () => {
    expect(isDue(claimed('Tide', 3), NOW)).toBe(false);
    expect(isDue(claimed('Tide', 7), NOW)).toBe(true);
    expect(isDue(claimed('Tide', 8), NOW)).toBe(true);
  });

  it('waits a month after its first return, and three months after its second', () => {
    expect(isDue(claimed('Tide', 20, { returns: 1 }), NOW)).toBe(false);
    expect(isDue(claimed('Tide', 30, { returns: 1 }), NOW)).toBe(true);
    expect(isDue(claimed('Tide', 60, { returns: 2 }), NOW)).toBe(false);
    expect(isDue(claimed('Tide', 91, { returns: 2 }), NOW)).toBe(true);
  });

  it('counts from the last card, so a return waiting to be read resets the clock', () => {
    const article = claimed('Tide', 40, { lastSeenAt: new Date(NOW - 2 * DAY).toISOString(), returns: 1 });
    expect(dueAt(article)).toBe(NOW + 28 * DAY);
    expect(isDue(article, NOW)).toBe(false);
  });

  it('lists the due ones, longest overdue first', () => {
    const list = [claimed('Tide', 8), claimed('Glacier', 3), claimed('Opera', 20)];
    expect(dueReturns(list, NOW).map((article) => article.title)).toEqual(['Opera', 'Tide']);
  });
});

describe('mixing returns into the draw', () => {
  const lead = (article: string) => ({ article, section: null, basis: 'Untouched.' });

  it('takes an untouched article and a due return in turn', () => {
    const picks = level3Picks({
      untouched: [lead('Vaccine'), lead('Sonnet')],
      due: [claimed('Tide', 8)],
      avoid: [],
    });
    expect(picks.map((pick) => pick.kind)).toEqual(['untouched', 'return']);
  });

  it('fills the draw from whichever there is', () => {
    expect(level3Picks({ untouched: [], due: [claimed('Tide', 8), claimed('Opera', 9)], avoid: [] })).toHaveLength(2);
    expect(level3Picks({ untouched: [lead('Vaccine'), lead('Sonnet')], due: [], avoid: [] })).toHaveLength(2);
  });

  it('leaves out a return already picked in this pass', () => {
    const picks = level3Picks({ untouched: [], due: [claimed('Tide', 8)], avoid: ['tide'] });
    expect(picks).toEqual([]);
  });
});

describe('the new angle on a return', () => {
  it('offers only the sections no earlier card was cut from', () => {
    const offered = freshSections(sections(null, 'History', 'Causes', 'Effects'), [null, 'causes']);
    expect(offered.map((section) => section.heading)).toEqual(['History', 'Effects']);
  });

  it('tells the naming call the earlier card titles and keeps a section that differs from them', async () => {
    const requests: ReturnAngleRequest[] = [];
    const article = claimed('Tide', 40, { returns: 1, earlier: [null, 'History'] });
    const { named, failed } = await resolveLevel3Picks([{ kind: 'return', article }], {
      depth,
      sections: async () => sections(null, 'History', 'Tidal forces', 'Tidal power'),
      nameAngle: async (request) => {
        requests.push(request);
        return { ok: true, section: 'tidal forces', basis: 'The mechanism.', model: 'angle-model' };
      },
    });
    expect(failed).toEqual([]);
    expect(requests[0]).toMatchObject({
      article: 'Tide',
      earlier: ['Tide', 'Tide: History'],
      sections: ['Tidal forces', 'Tidal power'],
      returns: 1,
    });
    expect(named).toEqual([
      {
        article: 'Tide',
        section: 'Tidal forces',
        basis: 'The mechanism.',
        model: 'angle-model',
        returning: { earlier: ['Tide', 'Tide: History'] },
      },
    ]);
    expect(earlierTitles(article)).not.toContain(`Tide: ${named[0]!.section}`);
  });

  it('drops a reply that names an earlier card or a section it was not offered', async () => {
    const article = claimed('Tide', 8, { earlier: [null] });
    for (const section of [null, 'Etymology']) {
      const { named, failed } = await resolveLevel3Picks([{ kind: 'return', article }], {
        depth,
        sections: async () => sections(null, 'History'),
        nameAngle: async () => ({ ok: true, section, basis: 'Again.', model: 'angle-model' }),
      });
      expect(named).toEqual([]);
      expect(failed).toHaveLength(1);
    }
  });

  it('skips an article with no section left and never calls the model for it', async () => {
    let calls = 0;
    const { named, failed } = await resolveLevel3Picks(
      [{ kind: 'return', article: claimed('Tide', 8, { earlier: [null, 'History'] }) }],
      {
        depth,
        sections: async () => sections(null, 'History'),
        nameAngle: async () => {
          calls += 1;
          return { ok: false, detail: 'unused' };
        },
      },
    );
    expect({ named, calls, failed: failed.length }).toEqual({ named: [], calls: 0, failed: 1 });
  });
});
