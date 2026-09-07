import { describe, expect, it } from 'vitest';
import type { Requirement } from '../jd/requirements';
import { matchKey, parseMatchPayload } from './match-payload';

const requirements: Requirement[] = [
  { text: 'Five years of forecasting', kind: 'must_have' },
  { text: 'German localisation', kind: 'nice_to_have' },
];

const shortlisted = ['item-a', 'item-b'];

describe('parseMatchPayload', () => {
  it('scores each requirement against the item it cited', () => {
    const result = parseMatchPayload(
      {
        matches: [
          { requirement_index: 0, verdict: 'strong', evidence_item_id: 'item-a', why: 'Six years of it.' },
          { requirement_index: 1, verdict: 'gap', evidence_item_id: null, why: 'No German.' },
        ],
      },
      requirements,
      shortlisted,
    );
    expect(result).toEqual({
      ok: true,
      matches: [
        {
          requirement: 'Five years of forecasting',
          kind: 'must_have',
          verdict: 'strong',
          evidenceItemId: 'item-a',
          why: 'Six years of it.',
        },
        {
          requirement: 'German localisation',
          kind: 'nice_to_have',
          verdict: 'gap',
          evidenceItemId: null,
          why: 'No German.',
        },
      ],
    });
  });

  it('downgrades a match citing an item that was never offered', () => {
    const result = parseMatchPayload(
      { matches: [{ requirement_index: 0, verdict: 'strong', evidence_item_id: 'invented', why: 'Trust me.' }] },
      requirements,
      shortlisted,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0].verdict).toBe('gap');
    expect(result.matches[0].evidenceItemId).toBeNull();
    expect(result.matches[0].why).toMatch(/not offered/);
  });

  it('downgrades a strong verdict that cites nothing at all', () => {
    const result = parseMatchPayload(
      { matches: [{ requirement_index: 0, verdict: 'partial', evidence_item_id: null, why: 'Close enough.' }] },
      requirements,
      shortlisted,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0].verdict).toBe('gap');
  });

  it('fills in a requirement the match skipped rather than shortening the map', () => {
    const result = parseMatchPayload(
      { matches: [{ requirement_index: 0, verdict: 'strong', evidence_item_id: 'item-a', why: 'Yes.' }] },
      requirements,
      shortlisted,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(2);
    expect(result.matches[1]).toMatchObject({ verdict: 'gap', why: 'Not scored.' });
  });

  it('ignores an index that is not a requirement', () => {
    const result = parseMatchPayload(
      {
        matches: [
          { requirement_index: 99, verdict: 'strong', evidence_item_id: 'item-a', why: 'Nowhere.' },
          { requirement_index: 0, verdict: 'partial', evidence_item_id: 'item-b', why: 'Some of it.' },
        ],
      },
      requirements,
      shortlisted,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].verdict).toBe('partial');
  });

  it('keeps the first verdict when an index repeats', () => {
    const result = parseMatchPayload(
      {
        matches: [
          { requirement_index: 0, verdict: 'strong', evidence_item_id: 'item-a', why: 'First.' },
          { requirement_index: 0, verdict: 'gap', evidence_item_id: null, why: 'Second.' },
        ],
      },
      requirements,
      shortlisted,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0].why).toBe('First.');
  });

  it('reports an empty match rather than a map of gaps', () => {
    expect(parseMatchPayload({ matches: [] }, requirements, shortlisted).ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    expect(parseMatchPayload({ matches: 'nope' }, requirements, shortlisted).ok).toBe(false);
  });
});

describe('matchKey', () => {
  const bank = [
    { id: 'b', strength: 3, skills: ['sql'] },
    { id: 'a', strength: 5, skills: ['forecasting', 'sql'] },
  ];

  it('is stable across the order the bank came back in', () => {
    expect(matchKey('jd1', bank)).toBe(matchKey('jd1', [...bank].reverse()));
  });

  it('is stable across the order of an item’s tags', () => {
    expect(matchKey('jd1', bank)).toBe(
      matchKey('jd1', [bank[0], { ...bank[1], skills: ['sql', 'forecasting'] }]),
    );
  });

  it('changes when the description changes', () => {
    expect(matchKey('jd1', bank)).not.toBe(matchKey('jd2', bank));
  });

  it('changes when an item is added', () => {
    expect(matchKey('jd1', bank)).not.toBe(
      matchKey('jd1', [...bank, { id: 'c', strength: 1, skills: [] }]),
    );
  });

  it('changes when an item is edited without being added or removed', () => {
    expect(matchKey('jd1', bank)).not.toBe(
      matchKey('jd1', [bank[0], { ...bank[1], skills: ['forecasting', 'sql', 'german'] }]),
    );
    expect(matchKey('jd1', bank)).not.toBe(
      matchKey('jd1', [bank[0], { ...bank[1], strength: 4 }]),
    );
  });

  it('still keys a role with no description hash', () => {
    expect(matchKey(null, bank)).toHaveLength(40);
  });
});
