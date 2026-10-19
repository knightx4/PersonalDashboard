import { describe, expect, it } from 'vitest';
import {
  MAX_ASKS,
  countWords,
  coverLetterView,
  mergeAsks,
  parseCoverLetterPayload,
  renderLetterRequest,
  storedLetter,
  strongestMatches,
} from './draft-cover-letter-payload';
import type { StoredAsk } from './store';
import type { GatheredMaterial, GatheredRequirement } from './types';

const OFFERED = ['e1', 'e2'];

function payload(extra: Record<string, unknown> = {}) {
  return {
    letter: 'Acme is building the finance team I want to be on.',
    evidence_item_ids: ['e1'],
    unsupported_claims: [],
    asks: [],
    ...extra,
  };
}

describe('parseCoverLetterPayload', () => {
  it('keeps a clean letter as it came', () => {
    const result = parseCoverLetterPayload(payload(), OFFERED, ['leverage']);
    if (!result.ok) throw new Error(result.error);
    expect(result.draft).toEqual({
      letter: 'Acme is building the finance team I want to be on.',
      evidenceItemIds: ['e1'],
      unsupportedClaims: [],
      bannedFound: [],
      asks: [],
    });
  });

  it('finds banned constructions in the letter', () => {
    const result = parseCoverLetterPayload(
      payload({ letter: 'I am Passionate about runway — and I leverage models.' }),
      OFFERED,
      ['passionate about', '—', 'leverage', 'synergy'],
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.draft.bannedFound).toEqual(['passionate about', '—', 'leverage']);
  });

  it('drops an evidence id that was not offered and says so', () => {
    const result = parseCoverLetterPayload(
      payload({ evidence_item_ids: ['e2', 'made-up', 'e2'], unsupported_claims: ['Led a team of 40.'] }),
      OFFERED,
      [],
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.draft.evidenceItemIds).toEqual(['e2']);
    expect(result.draft.unsupportedClaims).toEqual([
      'Led a team of 40.',
      'Part of this cited an evidence item that does not exist.',
    ]);
  });

  it('trims, dedupes and caps the asks', () => {
    const result = parseCoverLetterPayload(
      payload({ asks: [' Why Acme? ', 'why acme?', '', 'Who do you know there?', 'a', 'b', 'c', 'd'] }),
      OFFERED,
      [],
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.draft.asks).toEqual(['Why Acme?', 'Who do you know there?', 'a', 'b']);
    expect(result.draft.asks).toHaveLength(MAX_ASKS);
  });

  it('refuses a report without a letter', () => {
    expect(parseCoverLetterPayload(payload({ letter: '  ' }), OFFERED, []).ok).toBe(false);
    expect(parseCoverLetterPayload('nope', OFFERED, []).ok).toBe(false);
  });

  it('accepts missing arrays', () => {
    const result = parseCoverLetterPayload({ letter: 'Hello.' }, OFFERED, []);
    expect(result.ok && result.draft.evidenceItemIds).toEqual([]);
  });
});

function requirement(text: string, verdict: GatheredRequirement['verdict'], kind: GatheredRequirement['kind'] = 'must_have'): GatheredRequirement {
  return { text, kind, verdict, evidenceItemId: verdict ? 'e1' : null, why: null };
}

describe('strongestMatches', () => {
  it('takes strong matches before partial ones, three at most, never gaps', () => {
    const picked = strongestMatches([
      requirement('A', 'partial'),
      requirement('B', 'strong'),
      requirement('C', 'gap'),
      requirement('D', 'strong', 'nice_to_have'),
      requirement('E', 'partial'),
    ]);
    expect(picked.map((r) => r.text)).toEqual(['B', 'D', 'A']);
  });

  it('returns nothing when no match has been run', () => {
    expect(strongestMatches([requirement('A', null)])).toEqual([]);
  });
});

describe('mergeAsks', () => {
  const earlier: StoredAsk[] = [
    { id: 'a1', answer_id: null, question: 'Why Acme?', reply: 'Their CFO is great.' },
    { id: 'a2', answer_id: null, question: 'Any referral?', reply: null },
  ];

  it('keeps answered asks, replaces unanswered ones and skips repeats', () => {
    let n = 0;
    const merged = mergeAsks(earlier, ['why acme?', 'When can you start?'], () => `new-${++n}`);
    expect(merged).toEqual([
      earlier[0],
      { id: 'new-1', answer_id: null, question: 'When can you start?', reply: null },
    ]);
  });
});

describe('coverLetterView', () => {
  it('reads the letter back and finds banned words again', () => {
    const row = storedLetter(
      { letter: 'I leverage two words.', evidenceItemIds: ['e1'], unsupportedClaims: ['x'], bannedFound: [], asks: [] },
      [],
    );
    expect(coverLetterView(row, ['leverage'])).toEqual({
      letter: 'I leverage two words.',
      words: 4,
      evidenceItemIds: ['e1'],
      unsupportedClaims: ['x'],
      bannedFound: ['leverage'],
      asks: [],
    });
    expect(coverLetterView({ drafts: {}, asks: [] }, [])).toBeNull();
    expect(coverLetterView(null, [])).toBeNull();
  });

  it('counts words', () => {
    expect(countWords('  one two\nthree ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});

describe('renderLetterRequest', () => {
  const material = {
    role: { requirements: [requirement('Ten years in FP&A', 'strong')] },
    questions: [
      { answerId: 'aa1', questionId: 'q1', text: 'Why Acme?', kind: null, answer: 'Runway.', status: 'draft', limit: null, defaultAnswer: null },
      { answerId: 'aa2', questionId: 'q2', text: 'Unanswered?', kind: null, answer: null, status: null, limit: null, defaultAnswer: null },
    ],
    letterComments: [],
  } as unknown as GatheredMaterial;

  it('sends the answers, the best matches, the replies and the previous letter', () => {
    const text = renderLetterRequest({
      material,
      previousLetter: 'Dear Acme, the old draft.',
      asks: [
        { id: 'a1', answer_id: null, question: 'Why Acme?', reply: 'Their CFO.' },
        { id: 'a2', answer_id: null, question: 'Unasked?', reply: null },
      ],
    });
    expect(text).toContain('Q: Why Acme?\nA (draft): Runway.');
    expect(text).not.toContain('Unanswered?');
    expect(text).toContain('- Ten years in FP&A (strong)');
    expect(text).toContain('Q: Why Acme?\nA: Their CFO.');
    expect(text).not.toContain('Unasked?');
    expect(text).toContain('Dear Acme, the old draft.');
  });

  it('sends their comments on the letter', () => {
    const text = renderLetterRequest({ material: { ...material, letterComments: ['Keep it under 250 words.'] } as GatheredMaterial });
    expect(text).toContain('## Their comments on the cover letter\n\n- Keep it under 250 words.');
    expect(renderLetterRequest({ material })).not.toContain('Their comments');
  });

  it('says when there is nothing on file yet', () => {
    const text = renderLetterRequest({ material: { ...material, questions: [], role: { requirements: [] } } as unknown as GatheredMaterial });
    expect(text).toContain('None yet.');
    expect(text).toContain('have not been matched');
    expect(text).not.toContain('previous draft');
  });
});
