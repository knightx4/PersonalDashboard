import { describe, expect, it } from 'vitest';
import { SAAS_METRICS } from '@/lib/learn/levels/territories/saas-metrics';
import { areaProblem, strayAreas, territorySources, topicsLeft, unsourcedFrom } from '@/lib/learn/levels/territory';
import { MAX_ITEMS_PER_SOURCE, MAX_PERFORMANCES, MAX_SOURCES } from '@/lib/learn/levels/draft-sources';

describe('the SaaS metrics territory (plan #2172.6)', () => {
  it('names every topic from a line that is in its sources', () => {
    expect(unsourcedFrom(SAAS_METRICS)).toEqual([]);
    for (const topic of SAAS_METRICS.topics) expect(topic.from.length).toBeGreaterThan(0);
  });

  it('has fifteen to twenty-five topics, targets mostly 4 to 6, asks unique', () => {
    const { topics } = SAAS_METRICS;
    expect(topics.length).toBeGreaterThanOrEqual(15);
    expect(topics.length).toBeLessThanOrEqual(25);
    expect(topics.every((t) => t.target >= 4 && t.target <= 6)).toBe(true);
    expect(new Set(topics.map((t) => t.ask.toLowerCase())).size).toBe(topics.length);
  });

  it('fits what the drafting call takes', () => {
    expect(SAAS_METRICS.performances.length).toBeGreaterThanOrEqual(3);
    expect(SAAS_METRICS.performances.length).toBeLessThanOrEqual(MAX_PERFORMANCES);
    expect(SAAS_METRICS.texts.length + SAAS_METRICS.roles.length).toBeLessThanOrEqual(MAX_SOURCES);
    for (const text of SAAS_METRICS.texts) expect(text.items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_SOURCE);
  });
});

describe('territorySources', () => {
  it('puts the roles first, drops a phrase that matched nothing, and numbers from S1', () => {
    const given = territorySources(SAAS_METRICS, [{ label: 'Requirement lines of 2 roles', items: ['Build models'] }, null]);
    expect(given.sources.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(given.sources[0].label).toBe('Requirement lines of 2 roles');
    expect(given.sources[1].label).toContain('Skok');
    expect(given.performances).toBe(SAAS_METRICS.performances);
  });
});

describe('topicsLeft', () => {
  it('leaves out topics already drafted, by ask, whatever the case', () => {
    const first = SAAS_METRICS.topics[0].ask;
    const left = topicsLeft(SAAS_METRICS, [first.toUpperCase(), null, 'Something else']);
    expect(left).toHaveLength(SAAS_METRICS.topics.length - 1);
    expect(left[0]).toBe(SAAS_METRICS.topics[1]);
  });
});

describe('a territory with areas (plan #2483.1)', () => {
  const topic = (ask: string, area?: string) => ({ ask, scope: '', frame: 'F', target: 3, from: [], area });
  const packed = {
    ...SAAS_METRICS,
    areas: ['accounting', 'banking'],
    topics: [topic('Accruals', 'accounting'), topic('Leases', 'accounting'), topic('Liquidity', 'banking')],
  };

  it('leaves only the named area, minus what is drafted', () => {
    expect(topicsLeft(packed, ['accruals'], 'accounting').map((t) => t.ask)).toEqual(['Leases']);
    expect(topicsLeft(packed, [], 'banking').map((t) => t.ask)).toEqual(['Liquidity']);
    expect(topicsLeft(packed, []).map((t) => t.ask)).toEqual(['Accruals', 'Leases', 'Liquidity']);
  });

  it('refuses an area the territory does not declare, and any area on one with none', () => {
    expect(areaProblem(packed, 'accounting')).toBeNull();
    expect(areaProblem(packed, 'strategy')).toMatch(/no area "strategy"/);
    expect(areaProblem(SAAS_METRICS, 'accounting')).toMatch(/has no areas/);
  });

  it('flags a topic whose area is not declared', () => {
    expect(strayAreas(packed)).toEqual([]);
    expect(strayAreas({ ...packed, topics: [topic('Orphan'), topic('Odd', 'tax')] })).toEqual(['Orphan', 'Odd']);
    expect(strayAreas(SAAS_METRICS)).toEqual([]);
  });
});
