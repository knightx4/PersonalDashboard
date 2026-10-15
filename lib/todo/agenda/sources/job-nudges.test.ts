import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import { tableWorkspace } from '@/lib/sources/catalogue';
import type { DebriefDue } from '@/lib/jobs/today/debrief';
import type { UnpreppedRound } from '@/lib/jobs/today/nudges';

/** The nudges Jobs' Today used to draw, behind a setting (plan #1937.14). */

let wanted = false;
let debriefs: DebriefDue[] = [];
let unprepped: UnpreppedRound[] = [];

vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: { jobs: async () => ({}) } }));
vi.mock('@/lib/jobs/today/nudges', () => ({
  nudgesWanted: async () => wanted,
  loadNudges: async () => ({ debriefs, unprepped }),
}));

const { jobNudgesSource, debriefItem, prepItem } = await import('./job-nudges');

const ctx = {
  userId: 'u',
  timezone: 'UTC',
  from: '2026-10-01',
  to: '2026-10-14',
  now: new Date('2026-10-02T12:00:00Z'),
};

const round = {
  key: 'g1',
  leadId: 'i1',
  roleId: 'r1',
  companyName: 'Monzo',
  roleTitle: 'Senior Designer',
  scheduledAt: '2026-10-01T10:00:00Z',
  timeKnown: true,
};

beforeEach(() => {
  wanted = false;
  debriefs = [round];
  unprepped = [{ ...round, key: 'g2', leadId: 'i2' }];
});

describe('job_nudges', () => {
  it('lists nothing while the setting is off', async () => {
    expect(await jobNudgesSource.fetch(ctx)).toEqual([]);
  });

  it('lists the debrief and the prep, in the jobs workspace, with the setting on', async () => {
    wanted = true;
    const items = await jobNudgesSource.fetch(ctx);
    expect(items.map((item) => item.title)).toEqual([
      'Write up your Monzo round',
      'Prepare for your Monzo round',
    ]);
    for (const item of items) {
      expect(item.workspace).toBe('jobs');
      expect(item.completable).toBe(false);
      const parsed = parseRef(item.ref);
      expect(parsed && tableWorkspace(parsed.table)).toBe('jobs');
    }
  });

  it('keys a debrief and a prep for the same round apart', () => {
    expect(debriefItem(round).key).not.toBe(prepItem(round).key);
  });

  it('is always on, since the setting is its switch', () => {
    expect(jobNudgesSource.alwaysOn).toBe(true);
  });
});
