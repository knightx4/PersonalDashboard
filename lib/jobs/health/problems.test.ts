import { describe, expect, it } from 'vitest';
import { healthProblems, type HealthInput } from './problems';

const now = new Date('2026-10-10T15:00:00Z');
const healthy: HealthInput = {
  now,
  rolesRun: { state: 'done', startedAt: '2026-10-10T13:47:00Z', boardsRead: 48, error: null },
  peopleRun: { state: 'done', startedAt: '2026-10-09T13:47:00Z', boardsRead: 0, error: null },
  followedBoards: 50,
  boardLimit: 80,
  discovery: { stage: 'done', startedAt: '2026-10-05T06:17:00Z', offered: 812, error: null },
  jevOn: true,
  staleUnscored: 0,
};

const keys = (input: HealthInput) => healthProblems(input).map((problem) => problem.key);

describe('healthProblems', () => {
  it('finds nothing wrong when the runs went well', () => {
    expect(keys(healthy)).toEqual([]);
  });

  it('raises a recent failed or cut-off search, with its reason', () => {
    const failed = healthProblems({
      ...healthy,
      rolesRun: { ...healthy.rolesRun!, state: 'failed', error: 'Dash is rate-limited right now.' },
      peopleRun: { ...healthy.peopleRun!, state: 'stopped' },
    });
    expect(failed.map((p) => p.key)).toEqual(['roles-search', 'people-search']);
    expect(failed[0].detail).toBe('Dash is rate-limited right now.');
  });

  it('lets an old failure go, since a newer run would have replaced it', () => {
    expect(keys({ ...healthy, rolesRun: { ...healthy.rolesRun!, state: 'failed', startedAt: '2026-10-01T00:00:00Z' } })).toEqual([]);
  });

  it('raises a run that read under half the followed boards', () => {
    const problems = healthProblems({ ...healthy, rolesRun: { ...healthy.rolesRun!, boardsRead: 10 } });
    expect(problems.map((p) => p.key)).toEqual(['boards']);
    expect(problems[0].title).toBe('Only 10 of 50 followed job boards could be read');
    expect(keys({ ...healthy, followedBoards: 3, rolesRun: { ...healthy.rolesRun!, boardsRead: 0 } })).toEqual([]);
  });

  it('raises a failed or empty discovery week', () => {
    expect(keys({ ...healthy, discovery: { ...healthy.discovery!, stage: 'failed', error: 'Feed down' } })).toEqual(['discovery-failed']);
    expect(keys({ ...healthy, discovery: { ...healthy.discovery!, offered: 0 } })).toEqual(['discovery-empty']);
  });

  it('raises roles left unscored only when Jev is on', () => {
    expect(keys({ ...healthy, staleUnscored: 5 })).toEqual(['scoring']);
    expect(keys({ ...healthy, staleUnscored: 5, jevOn: false })).toEqual([]);
  });
});
