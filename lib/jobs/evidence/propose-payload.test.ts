import { describe, expect, it } from 'vitest';
import {
  MAX_CANDIDATES,
  normalizeSkills,
  parseEvidenceProposalPayload,
} from './propose-payload';

const story =
  'The month-end close ran nine days and nobody trusted the numbers. I rebuilt the ' +
  'reconciliation as a set of scheduled jobs and took the manual steps out of it.';

describe('parseEvidenceProposalPayload', () => {
  it('accepts a well-formed candidate', () => {
    const result = parseEvidenceProposalPayload({
      candidates: [
        {
          title: 'Rebuilt the close process',
          body: story,
          context: 'Acme, 2024',
          metrics: 'Close went from 9 days to 4',
          skills: ['Financial Modeling', 'automation'],
          strength: 5,
        },
      ],
    });
    expect(result).toEqual({
      ok: true,
      candidates: [
        {
          title: 'Rebuilt the close process',
          body: story,
          context: 'Acme, 2024',
          metrics: 'Close went from 9 days to 4',
          skills: ['financial_modeling', 'automation'],
          strength: 5,
        },
      ],
    });
  });

  it('defaults the missing optional fields rather than dropping the item', () => {
    const result = parseEvidenceProposalPayload({
      candidates: [{ title: 'A thing', body: story }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]).toMatchObject({
      context: null,
      metrics: null,
      skills: [],
      strength: 3,
    });
  });

  it('drops a one-line skill claim but keeps the real story beside it', () => {
    const result = parseEvidenceProposalPayload({
      candidates: [
        { title: 'Excel', body: 'Proficient in Excel.' },
        { title: 'Rebuilt the close process', body: story },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].title).toBe('Rebuilt the close process');
  });

  it('drops a repeat of the same story', () => {
    const result = parseEvidenceProposalPayload({
      candidates: [
        { title: 'Close process', body: story },
        { title: 'The close, again', body: `${story} And it stayed there.` },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
  });

  it('caps the batch at a reviewable size', () => {
    const result = parseEvidenceProposalPayload({
      candidates: Array.from({ length: MAX_CANDIDATES + 5 }, (_, index) => ({
        title: `Story ${index}`,
        body: `${index} ${story}`,
      })),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(MAX_CANDIDATES);
  });

  it('reports no_data rather than an empty list', () => {
    const result = parseEvidenceProposalPayload({ no_data: true, candidates: [] });
    expect(result.ok).toBe(false);
  });

  it('reports nothing usable when every candidate is too thin', () => {
    const result = parseEvidenceProposalPayload({
      candidates: [{ title: 'Excel', body: 'Proficient in Excel.' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    const result = parseEvidenceProposalPayload({ candidates: 'not an array' });
    expect(result.ok).toBe(false);
  });

  it('rejects a candidate with no title', () => {
    const result = parseEvidenceProposalPayload({ candidates: [{ body: story }] });
    expect(result.ok).toBe(false);
  });
});

describe('normalizeSkills', () => {
  it('lowercases, underscores and dedupes', () => {
    expect(normalizeSkills(['Stakeholder Management', 'stakeholder management', ' automation '])).toEqual([
      'stakeholder_management',
      'automation',
    ]);
  });

  it('drops blanks and caps the count', () => {
    expect(normalizeSkills(['', '   '])).toEqual([]);
    expect(normalizeSkills(Array.from({ length: 20 }, (_, i) => `skill ${i}`))).toHaveLength(8);
  });
});
