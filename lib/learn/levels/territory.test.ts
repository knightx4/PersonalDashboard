import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@/lib/learn/levels/territories/business';
import { TERRITORIES } from '@/lib/learn/levels/territories';
import { SAAS_METRICS } from '@/lib/learn/levels/territories/saas-metrics';
import {
  areaProblem,
  areaTerritory,
  offAreaFrom,
  strayAreas,
  strayTextAreas,
  territorySources,
  textsFor,
  topicsLeft,
  unsourcedFrom,
} from '@/lib/learn/levels/territory';
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

describe('the business territory (plan #2483.2)', () => {
  const area = (name: string) => BUSINESS.topics.filter((t) => t.area === name);

  it('is drafted by key, beside SaaS metrics', () => {
    expect(TERRITORIES.business).toBe(BUSINESS);
    expect(TERRITORIES['saas-metrics']).toBe(SAAS_METRICS);
  });

  it('names every topic from a line that is in its sources, and in a text of its own area', () => {
    expect(unsourcedFrom(BUSINESS)).toEqual([]);
    expect(offAreaFrom(BUSINESS)).toEqual([]);
    for (const topic of BUSINESS.topics) expect(topic.from.length).toBeGreaterThan(0);
  });

  it('puts every topic and text in a declared area', () => {
    expect(strayAreas(BUSINESS)).toEqual([]);
    expect(strayTextAreas(BUSINESS)).toEqual([]);
  });

  it('has about 150 corporate finance and accounting topics, asks unique, targets 3 to 6', () => {
    const written = [...area('corporate-finance'), ...area('accounting')];
    expect(written.length).toBeGreaterThanOrEqual(140);
    expect(written.length).toBeLessThanOrEqual(170);
    expect(area('corporate-finance').length).toBeGreaterThanOrEqual(60);
    expect(area('accounting').length).toBeGreaterThanOrEqual(60);
    expect(BUSINESS.topics.every((t) => t.target >= 3 && t.target <= 6)).toBe(true);
    expect(new Set(BUSINESS.topics.map((t) => t.ask.trim().toLowerCase())).size).toBe(BUSINESS.topics.length);
  });

  it('has about 150 banking, strategy and operations topics (plan #2483.3)', () => {
    const written = [...area('banking'), ...area('strategy'), ...area('operations')];
    expect(written.length).toBeGreaterThanOrEqual(140);
    expect(written.length).toBeLessThanOrEqual(170);
    for (const name of ['banking', 'strategy', 'operations']) expect(area(name).length).toBeGreaterThanOrEqual(45);
  });

  it('lists the SaaS metrics territory as its SaaS area, outside its own areas (plan #2483.3)', () => {
    expect(areaTerritory(BUSINESS, 'saas')).toBe(SAAS_METRICS.key);
    expect(areaTerritory(BUSINESS, 'banking')).toBeNull();
    expect(areaTerritory(SAAS_METRICS, 'saas')).toBeNull();
    for (const [name, key] of Object.entries(BUSINESS.areaTerritories ?? {})) {
      expect(TERRITORIES[key]).toBeDefined();
      expect(BUSINESS.areas).not.toContain(name);
    }
  });

  it('shares no ask with the SaaS metrics territory', () => {
    const saas = new Set(SAAS_METRICS.topics.map((t) => t.ask.trim().toLowerCase()));
    expect(BUSINESS.topics.filter((t) => saas.has(t.ask.trim().toLowerCase()))).toEqual([]);
  });

  it('fits what the drafting call takes, area by area', () => {
    expect(BUSINESS.performances.length).toBeGreaterThanOrEqual(3);
    expect(BUSINESS.performances.length).toBeLessThanOrEqual(MAX_PERFORMANCES);
    for (const name of BUSINESS.areas ?? []) {
      expect(textsFor(BUSINESS, name).length + BUSINESS.roles.length).toBeLessThanOrEqual(MAX_SOURCES);
    }
    for (const text of BUSINESS.texts) expect(text.items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_SOURCE);
  });
});

describe('texts by area (plan #2483.2)', () => {
  it('gives an area its own texts and those naming none', () => {
    const keys = (name?: string) => textsFor(BUSINESS, name).map((t) => t.key);
    expect(keys('accounting')).toEqual(['osacct', 'mit501', 'mit535', 'acc520', 'acc530']);
    expect(keys('corporate-finance')).toEqual(['osfin', 'fin410', 'fin420', 'fin610', 'acc520']);
    expect(keys()).toHaveLength(BUSINESS.texts.length);
    const given = territorySources(BUSINESS, [null], 'accounting');
    expect(given.sources.map((s) => s.label)).toEqual(textsFor(BUSINESS, 'accounting').map((t) => t.label));
  });

  it('flags a line citing a text outside the topic\'s area, and an undeclared text area', () => {
    const [topic] = BUSINESS.topics.filter((t) => t.area === 'accounting');
    const off = { ...BUSINESS, topics: [{ ...topic, from: ['osfin: Bond Valuation'] }] };
    expect(offAreaFrom(off)).toEqual(['osfin: Bond Valuation']);
    expect(strayTextAreas({ ...BUSINESS, texts: [{ ...BUSINESS.texts[0], areas: ['tax'] }] })).toEqual(['osfin: tax']);
  });
});
