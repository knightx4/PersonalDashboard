import { describe, expect, it } from 'vitest';
import { firedFrom, firedLine, firedSinceMark, type FiredTripwire } from './insight-fired';
import { insightFromRow } from './insights';

const date = (iso: string) => iso.slice(5, 10);

describe('firedFrom', () => {
  it('keeps tripwires that fired and drops the rest', () => {
    const fired = firedFrom([
      { kind: 'rule_broken', last_fired_at: '2026-10-17T02:00:00Z', fired_evidence: { applications: [] } },
      { kind: 'rule_broken', last_fired_at: null, fired_evidence: null },
      { kind: 'made_up', last_fired_at: '2026-10-17T02:00:00Z', fired_evidence: {} },
      { kind: 'want_recurring', last_fired_at: 'not a date', fired_evidence: {} },
    ]);
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe('rule_broken');
  });

  it('reads a single embedded object and evidence of the wrong shape', () => {
    const fired = firedFrom({ kind: 'want_recurring', last_fired_at: '2026-10-17T02:00:00Z', fired_evidence: [1] });
    expect(fired).toEqual([{ kind: 'want_recurring', firedAt: '2026-10-17T02:00:00Z', evidence: {} }]);
  });

  it('comes through insightFromRow', () => {
    const insight = insightFromRow({
      id: 'i1',
      claim: 'A claim',
      status: 'shown',
      insight_tripwires: [{ kind: 'rule_broken', last_fired_at: '2026-10-17T02:00:00Z', fired_evidence: {} }],
    });
    expect(insight?.fired).toHaveLength(1);
  });
});

describe('firedSinceMark', () => {
  const fired: FiredTripwire[] = [
    { kind: 'rule_broken', firedAt: '2026-10-15T02:00:00Z', evidence: {} },
    { kind: 'want_recurring', firedAt: '2026-10-17T02:00:00Z', evidence: {} },
  ];

  it('returns the latest fire when the card was never marked', () => {
    expect(firedSinceMark(fired, null)?.kind).toBe('want_recurring');
  });

  it('returns nothing once the mark is later than every fire', () => {
    expect(firedSinceMark(fired, '2026-10-17T09:00:00Z')).toBeNull();
  });

  it('returns only a fire after the mark', () => {
    expect(firedSinceMark(fired, '2026-10-16T09:00:00Z')?.kind).toBe('want_recurring');
    expect(firedSinceMark(fired, '2026-10-17T02:00:00Z')).toBeNull();
  });
});

describe('firedLine', () => {
  it('names the longest wait and counts the others', () => {
    const line = firedLine(
      {
        kind: 'building_while_waiting',
        firedAt: '2026-10-18T02:00:00Z',
        evidence: {
          build_days: ['2026-10-14'],
          waiting: [
            { company: 'Northwind', role: 'Designer', submitted_at: '2026-10-14T10:00:00Z', build_days_since: 2 },
            { company: 'ReSpark', role: 'Lead', submitted_at: '2026-10-13T10:00:00Z', build_days_since: 3 },
          ],
        },
      },
      date,
    );
    expect(line.headline).toBe('Three days building while ReSpark waits and 1 other');
    expect(line.details).toHaveLength(3);
  });

  it('words a deadline, a broken rule and a recurring want', () => {
    expect(
      firedLine(
        { kind: 'deadline_during_building', firedAt: '2026-10-18T02:00:00Z', evidence: { deadlines: [{ title: 'Tax form', day: '2026-10-16', build_views: 4 }] } },
        date,
      ).headline,
    ).toBe('A deadline passed, Tax form, on a day you were building');
    expect(
      firedLine(
        { kind: 'rule_broken', firedAt: '2026-10-18T02:00:00Z', evidence: { applications: [{ company: 'Coinly', role: 'PM', rule: 'Crypto', submitted_at: '2026-10-17T10:00:00Z' }] } },
        date,
      ).headline,
    ).toBe('You applied to Coinly, PM, against your rule on Crypto');
    expect(
      firedLine(
        { kind: 'want_recurring', firedAt: '2026-10-18T02:00:00Z', evidence: { words: ['woodworking'], mentions: [{ source: 'goals.captures', at: '2026-10-02T00:00:00Z' }] } },
        date,
      ).headline,
    ).toBe('You have named woodworking 1 time lately and started nothing');
  });

  it('says something sensible for empty evidence', () => {
    for (const kind of ['building_while_waiting', 'deadline_during_building', 'rule_broken', 'want_recurring'] as const) {
      expect(firedLine({ kind, firedAt: '2026-10-18T02:00:00Z', evidence: {} }, date).headline.length).toBeGreaterThan(5);
    }
  });
});
