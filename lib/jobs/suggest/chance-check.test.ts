import { describe, expect, it } from 'vitest';
import {
  averageRanks,
  CHANCE_DISPLAY,
  chanceAuc,
  chanceBand,
  checkChance,
  percentiles,
  quantile,
  tercileEdges,
  type ChanceOutcome,
} from './chance-check';

const row = (chance: number, interviewed: boolean, id = `${chance}-${interviewed}`): ChanceOutcome => ({
  id,
  chance,
  interviewed,
});

describe('averageRanks', () => {
  it('gives tied values the average of their places', () => {
    expect(averageRanks([10, 30, 20, 20])).toEqual([1, 4, 2.5, 2.5]);
  });
});

describe('chanceAuc', () => {
  it('is 1 when every interviewed application scored above every other', () => {
    expect(chanceAuc([row(10, false), row(20, false), row(60, true), row(70, true)])).toBe(1);
  });

  it('is 0 when every one scored below', () => {
    expect(chanceAuc([row(80, false), row(20, true)])).toBe(0);
  });

  it('counts a tie as half', () => {
    expect(chanceAuc([row(50, false), row(50, true)])).toBe(0.5);
  });

  it('is null with nobody in one group', () => {
    expect(chanceAuc([row(50, true)])).toBeNull();
  });
});

describe('percentiles', () => {
  it('runs from 0 for the lowest to 100 for the highest', () => {
    expect(percentiles([row(30, false), row(10, false), row(20, true)])).toEqual([100, 0, 50]);
  });
});

describe('quantile and tercileEdges', () => {
  it('interpolates between neighbours', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
  });

  it('splits into thirds, rounded', () => {
    expect(tercileEdges([0, 10, 20, 30, 40, 50, 60])).toEqual({ medium: 20, high: 40 });
  });
});

describe('chanceBand', () => {
  const edges = { medium: 27, high: 38 };
  it('puts an edge value in the band above it', () => {
    expect(chanceBand(26, edges)).toBe('low');
    expect(chanceBand(27, edges)).toBe('medium');
    expect(chanceBand(38, edges)).toBe('high');
  });
});

describe('checkChance', () => {
  it('shows the number when the interviewed ones rank clearly higher', () => {
    const rows = [row(10, false), row(20, false), row(30, false), row(70, true), row(80, true), row(40, false)];
    const check = checkChance(rows);
    expect(check.auc).toBe(1);
    expect(check.display).toBe('number');
    expect(check.interviewed).toBe(2);
    expect(check.bands.high.interviewed).toBe(2);
  });

  it('falls back to the band when they do not', () => {
    const rows = [row(70, false), row(20, true), row(30, false), row(40, true), row(50, false)];
    const check = checkChance(rows);
    expect(check.auc).toBeLessThan(0.7);
    expect(check.display).toBe('band');
    expect(check.meanChance).toEqual({ interviewed: 30, rest: 50 });
  });
});

describe('CHANCE_DISPLAY', () => {
  it('holds edges in order when it is a band', () => {
    if (CHANCE_DISPLAY.kind === 'band') expect(CHANCE_DISPLAY.edges.medium).toBeLessThan(CHANCE_DISPLAY.edges.high);
  });
});
