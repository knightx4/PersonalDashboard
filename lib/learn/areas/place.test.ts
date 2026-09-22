import { describe, expect, it } from 'vitest';
import { readPlacements } from '@/lib/learn/areas/place';

const BATCH = [
  { title: 'Isaac Newton', section: 'People > Scientists' },
  { title: 'Inflation', section: 'Society > Economics' },
  { title: 'Tea', section: 'Everyday life > Food' },
];
const SLUGS = new Set(['physics', 'mathematics-x', 'economics', 'food-cuisine', 'agriculture']);

describe('readPlacements', () => {
  it('keeps placements for titles that were asked about, into real fields', () => {
    const result = readPlacements(
      {
        placements: [
          { title: 'Isaac Newton', kind: 'person', field: 'physics', runner_up: 'mathematics-x', confidence: 'close', basis: 'Known for mechanics and calculus both.' },
          { title: 'inflation', kind: 'topic', field: 'economics', runner_up: null, confidence: 'clear', basis: 'A macroeconomic topic.' },
          { title: 'Tea', kind: 'topic', field: 'food-cuisine', runner_up: 'agriculture', confidence: 'clear', basis: 'A drink.' },
        ],
      },
      BATCH,
      SLUGS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements.map((p) => [p.title, p.field, p.runnerUp])).toEqual([
      ['Isaac Newton', 'physics', 'mathematics-x'],
      ['Inflation', 'economics', null],
      ['Tea', 'food-cuisine', 'agriculture'],
    ]);
    expect(result.dropped).toEqual([]);
  });

  it('drops an invented field, an unasked title and a runner-up equal to the field', () => {
    const result = readPlacements(
      {
        placements: [
          { title: 'Isaac Newton', kind: 'person', field: 'natural-philosophy', confidence: 'none', basis: 'No field fits.' },
          { title: 'Gravity', kind: 'topic', field: 'physics', confidence: 'clear', basis: 'Physics.' },
          { title: 'Inflation', kind: 'topic', field: 'economics', runner_up: 'economics', confidence: 'clear', basis: 'Economics.' },
        ],
      },
      BATCH,
      SLUGS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]).toMatchObject({ title: 'Inflation', runnerUp: null });
    expect(result.dropped).toEqual(['Isaac Newton', 'Tea']);
  });

  it('places an umbrella article at a real domain, and refuses an invented one', () => {
    const result = readPlacements(
      {
        placements: [
          { title: 'Isaac Newton', kind: 'person', field: 'physics', confidence: 'clear', basis: 'Physics.' },
          { title: 'Inflation', kind: 'topic', field: 'domain:social-sciences', confidence: 'clear', basis: 'Spans the domain.' },
          { title: 'Tea', kind: 'topic', field: 'domain:everyday-life', confidence: 'clear', basis: 'Invented.' },
        ],
      },
      BATCH,
      SLUGS,
      new Set(['social-sciences', 'arts-culture']),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements.map((p) => [p.title, p.field, p.domain])).toEqual([
      ['Isaac Newton', 'physics', null],
      ['Inflation', null, 'social-sciences'],
    ]);
    expect(result.dropped).toEqual(['Tea']);
  });

  it('refuses a payload in the wrong shape rather than reading part of it', () => {
    expect(readPlacements({ placements: [{ title: 'Tea' }] }, BATCH, SLUGS).ok).toBe(false);
  });
});
