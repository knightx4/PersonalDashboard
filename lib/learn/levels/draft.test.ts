import { describe, expect, it, vi } from 'vitest';
import { DRAFT_TOOL, draftPrompt, readDraftReport } from './draft';

/**
 * The drafting prompt and the check a written draft goes through, around the
 * rules in draft-payload.test.ts: what the routine is told, that a draft is
 * settled against the map, and that a too-broad goal and a malformed report
 * stay two different answers. Nothing here calls a model (learn 0193).
 */

vi.mock('server-only', () => ({}));

const DRAFT = {
  name: 'Discounted cash flow',
  scope: 'Valuing a company as the discounted sum of its future free cash flows; multiples are a neighbour.',
  ceiling: 2,
  fields: ['finance'],
  levels: [
    { level: 1, checks: ['Can say it is a way of valuing a company', 'Can name what it is used for'] },
    { level: 2, checks: ['Can define it in their own words', 'Can say what is discounted and why'] },
  ],
  links: [{ from_level: 2, topic: 'Return', level: 2 }],
  missing: [],
};

const MAP = [{ id: 't-return', name: 'Return', scope: 'What a return is.', ceiling: 6, approved: true }];

describe('readDraftReport', () => {
  it('settles a written draft against the map and the fields', () => {
    const result = readDraftReport(DRAFT, { map: MAP, fields: [{ id: 'f-fin', slug: 'finance', name: 'Finance' }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.cells).toHaveLength(2);
      expect(result.draft.links[0]).toMatchObject({ topicId: 't-return', fromLevel: 2, level: 2 });
      expect(result.draft.fieldIds).toEqual(['f-fin']);
    }
  });

  it('says a too-broad goal is too vague', () => {
    expect(readDraftReport({ ...DRAFT, too_vague: true }, { map: [], fields: [] })).toMatchObject({ ok: false, reason: 'too-vague' });
  });

  it('reports a malformed draft as an error', () => {
    expect(readDraftReport({ name: 'DCF' }, { map: [], fields: [] })).toMatchObject({ ok: false, reason: 'error' });
  });

  it('gives the routine the tool the draft is written as', () => {
    expect(DRAFT_TOOL.name).toBe('report_topic');
    expect(DRAFT_TOOL.input_schema.required).toEqual(['name', 'scope', 'ceiling', 'levels']);
  });
});

describe('draftPrompt', () => {
  it('names the approved topics with their ceilings and leaves drafts out', () => {
    const prompt = draftPrompt({
      goal: 'CAPM',
      map: [...MAP, { id: 't-draft', name: 'Beta', scope: 'Draft.', ceiling: 5, approved: false }],
      fields: [],
    });
    expect(prompt).toContain('- Return (to 6): What a return is.');
    expect(prompt).not.toContain('Beta');
  });

  it('numbers the sources and performances to cite, and says when there are none', () => {
    const prompt = draftPrompt({
      goal: 'DCF',
      map: [],
      fields: [],
      sources: { sources: [{ id: 'S1', label: 'CFA syllabus', items: ['Calculate FCFF'] }], performances: ['Value a company'] },
    });
    expect(prompt).toContain('P1. Value a company');
    expect(prompt).toContain('  S1.1 Calculate FCFF');
    expect(draftPrompt({ goal: 'DCF', map: [], fields: [] })).toContain('No sources were given');
  });

  it('carries the scope a link gave a wanted topic', () => {
    const prompt = draftPrompt({ goal: 'Risk-free rate', scope: 'The return on a riskless asset.', map: [], fields: [] });
    expect(prompt).toContain('with this scope: The return on a riskless asset.');
  });
});
