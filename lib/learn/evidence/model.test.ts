import { describe, expect, it } from 'vitest';
import { evidenceFromRows, type EvidenceRow } from './model';

const row = (over: Partial<EvidenceRow>): EvidenceRow => ({
  id: 'a',
  target_kind: 'idea',
  target_id: 'idea-1',
  source_kind: 'note',
  source_id: 'n1',
  similarity: 0.7,
  weight: 0.5,
  basis: 'you wrote about this in Notes',
  found_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe("an idea's evidence", () => {
  it('puts the strongest weight first', () => {
    const links = evidenceFromRows([
      row({ id: 'clipping', weight: 0.25 }),
      row({ id: 'own', weight: 1 }),
      row({ id: 'course', weight: 0.6 }),
    ]);
    expect(links.map((l) => l.id)).toEqual(['own', 'course', 'clipping']);
  });

  it('breaks a tie on similarity, then the newer find, then the id', () => {
    const links = evidenceFromRows([
      row({ id: 'd', similarity: 0.6 }),
      row({ id: 'c', similarity: 0.8, found_at: '2026-09-01T00:00:00Z' }),
      row({ id: 'b', similarity: 0.8, found_at: '2026-10-02T00:00:00Z' }),
      row({ id: 'a', similarity: 0.8, found_at: '2026-10-02T00:00:00Z' }),
    ]);
    expect(links.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the source and the basis for the card', () => {
    const [link] = evidenceFromRows([
      row({ source_kind: 'course', source_id: 'c9', basis: 'from MGT 541 Corporate Finance, A, 2025' }),
    ]);
    expect(link).toMatchObject({
      sourceKind: 'course',
      sourceId: 'c9',
      basis: 'from MGT 541 Corporate Finance, A, 2025',
    });
  });
});
