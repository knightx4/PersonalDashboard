import { describe, expect, it } from 'vitest';
import {
  fromStoredDraft,
  mergeApplicationDrafts,
  parseApplicationDraftPayload,
  parseDraftAsks,
  questionsToDraft,
  renderDraftRequest,
  renderRetryRequest,
  toStoredDraft,
  type DraftedAnswer,
} from './draft-application-payload';
import type { AnswerLimit } from './limits';
import type { StoredAsk } from './store';
import type { GatheredQuestion } from './types';

const WORDS_5: AnswerLimit = { count: 5, unit: 'words', from: 'set' };
const CHARS_20: AnswerLimit = { count: 20, unit: 'characters', from: 'question' };

const context = {
  requested: ['a1', 'a2'],
  known: ['a1', 'a2', 'a3'],
  offeredEvidenceIds: ['e1', 'e2'],
  banned: ['leverage'],
  limits: { a1: WORDS_5, a2: CHARS_20, a3: null },
};

function entry(answerId: string, answer: string, extra: Record<string, unknown> = {}) {
  return { answer_id: answerId, answer, evidence_item_ids: [], unsupported_claims: [], ...extra };
}

function question(answerId: string, answer: string | null, extra: Partial<GatheredQuestion> = {}): GatheredQuestion {
  return {
    answerId,
    questionId: `q-${answerId}`,
    text: `Question ${answerId}?`,
    kind: null,
    answer,
    status: answer ? 'draft' : null,
    limit: null,
    defaultAnswer: null,
    comments: [],
    ...extra,
  };
}

describe('parseApplicationDraftPayload', () => {
  it('keeps a draft for every requested answer, with what it cites', () => {
    const result = parseApplicationDraftPayload(
      {
        answers: [entry('a1', 'I cut burn.', { evidence_item_ids: ['e2'] }), entry('a2', 'Short one.')],
        asks: [],
      },
      context,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers).toEqual([
      { answerId: 'a1', text: 'I cut burn.', evidenceItemIds: ['e2'], unsupportedClaims: [], bannedFound: [] },
      { answerId: 'a2', text: 'Short one.', evidenceItemIds: [], unsupportedClaims: [], bannedFound: [] },
    ]);
    expect(result.payload.missing).toEqual([]);
  });

  it('ignores answer ids it was not asked for and lists the requested ones that did not come back', () => {
    const result = parseApplicationDraftPayload(
      { answers: [entry('a1', 'Fine.'), entry('a3', 'Not asked for.'), entry('zzz', 'Invented.')], asks: [] },
      context,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers.map((a) => a.answerId)).toEqual(['a1']);
    expect(result.payload.missing).toEqual(['a2']);
  });

  it('flags a cited id that was never offered, as the single drafter does', () => {
    const result = parseApplicationDraftPayload(
      { answers: [entry('a1', 'Did it.', { evidence_item_ids: ['e1', 'made-up'] })], asks: [] },
      context,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers[0].evidenceItemIds).toEqual(['e1']);
    expect(result.payload.answers[0].unsupportedClaims.join(' ')).toMatch(/does not exist/);
  });

  it('finds banned constructions in each answer', () => {
    const result = parseApplicationDraftPayload(
      { answers: [entry('a1', 'I leverage data.')], asks: [] },
      context,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers[0].bannedFound).toEqual(['leverage']);
  });

  it('measures each answer against its own limit, in words or characters', () => {
    const result = parseApplicationDraftPayload(
      {
        answers: [
          entry('a1', 'one two three four five six'),
          entry('a2', 'twenty-one characters'),
        ],
        asks: [],
      },
      context,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers[0].overLimit).toEqual({ count: 6, limit: 5, unit: 'words' });
    expect(result.payload.answers[1].overLimit).toEqual({ count: 21, limit: 20, unit: 'characters' });
  });

  it('leaves an answer within its limit unflagged', () => {
    const result = parseApplicationDraftPayload({ answers: [entry('a1', 'one two three four five')], asks: [] }, context);
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers[0]).not.toHaveProperty('overLimit');
  });

  it('reads answers sent as a JSON string', () => {
    const result = parseApplicationDraftPayload(
      { answers: JSON.stringify([entry('a1', 'From a string.')]), asks: '[]' },
      context,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers[0].text).toBe('From a string.');
  });

  it('skips a malformed entry and refuses a payload with no usable draft', () => {
    const partial = parseApplicationDraftPayload({ answers: [entry('a1', ''), entry('a2', 'Kept.')] }, context);
    if (!partial.ok) throw new Error(partial.error);
    expect(partial.payload.answers.map((a) => a.answerId)).toEqual(['a2']);
    expect(partial.payload.missing).toEqual(['a1']);

    expect(parseApplicationDraftPayload({ answers: [entry('zzz', 'Unknown.')] }, context).ok).toBe(false);
    expect(parseApplicationDraftPayload({ asks: [] }, context).ok).toBe(false);
    expect(parseApplicationDraftPayload('nope', context).ok).toBe(false);
  });

  it('takes the first draft when an id comes back twice', () => {
    const result = parseApplicationDraftPayload({ answers: [entry('a1', 'First.'), entry('a1', 'Second.')] }, context);
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.answers.map((a) => a.text)).toEqual(['First.']);
  });
});

describe('parseDraftAsks', () => {
  it('keeps asks tied to an answer on the application, and makes the rest about the whole application', () => {
    expect(
      parseDraftAsks(
        [
          { answer_id: 'a1', question: 'Why did you leave?' },
          { answer_id: 'unknown', question: 'Can you start in May?' },
          { answer_id: null, question: 'Who referred you?' },
        ],
        ['a1'],
      ),
    ).toEqual([
      { answerId: 'a1', question: 'Why did you leave?' },
      { answerId: null, question: 'Can you start in May?' },
      { answerId: null, question: 'Who referred you?' },
    ]);
  });

  it('drops repeats, blanks and questions asked before', () => {
    expect(
      parseDraftAsks(
        [
          { answer_id: 'a1', question: 'Why did you leave?' },
          { answer_id: 'a1', question: '  why did you  LEAVE? ' },
          { answer_id: 'a1', question: '   ' },
          { answer_id: 'a1', question: 'What was the team size?' },
        ],
        ['a1'],
        { askedBefore: ['What was the team size?'] },
      ),
    ).toEqual([{ answerId: 'a1', question: 'Why did you leave?' }]);
  });

  it('caps asks per answer and in all', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ answer_id: 'a1', question: `Question ${i}?` }));
    expect(parseDraftAsks(many, ['a1'])).toHaveLength(2);
    const spread = Array.from({ length: 20 }, (_, i) => ({ answer_id: `a${i}`, question: `Q ${i}?` }));
    expect(parseDraftAsks(spread, spread.map((s) => s.answer_id))).toHaveLength(8);
  });

  it('reads nothing from something that is not a list', () => {
    expect(parseDraftAsks(undefined, ['a1'])).toEqual([]);
    expect(parseDraftAsks('not json', ['a1'])).toEqual([]);
  });
});

describe('questionsToDraft', () => {
  const questions = [question('a1', null), question('a2', 'Already written.'), question('a3', '  ')];

  it('takes every question with no answer by default', () => {
    const result = questionsToDraft(questions);
    if (!result.ok) throw new Error(result.error);
    expect(result.selected.map((q) => q.answerId)).toEqual(['a1', 'a3']);
  });

  it('takes the named ones, answered or not', () => {
    const result = questionsToDraft(questions, ['a2']);
    if (!result.ok) throw new Error(result.error);
    expect(result.selected.map((q) => q.answerId)).toEqual(['a2']);
  });

  it('refuses a named id that is not on the application', () => {
    expect(questionsToDraft(questions, ['elsewhere'])).toEqual({
      ok: false,
      error: 'That question is not on this application.',
    });
  });

  it('says so when there is nothing left to draft', () => {
    expect(questionsToDraft([question('a2', 'Done.')]).ok).toBe(false);
    expect(questionsToDraft([]).ok).toBe(false);
  });
});

describe('mergeApplicationDrafts', () => {
  const drafted: DraftedAnswer = {
    answerId: 'a1',
    text: 'New draft.',
    evidenceItemIds: ['e1'],
    unsupportedClaims: [],
    bannedFound: [],
    overLimit: { count: 6, limit: 5, unit: 'words' },
  };
  const existing = {
    drafts: {
      a1: { answer: 'Old draft.', evidence_item_ids: [], unsupported_claims: [] },
      a2: { answer: 'Other draft.', evidence_item_ids: [], unsupported_claims: [] },
    },
    asks: [
      { id: 'k1', answer_id: 'a1', question: 'Answered about a1?', reply: 'Yes.' },
      { id: 'k2', answer_id: 'a1', question: 'Unanswered about a1?', reply: null },
      { id: 'k3', answer_id: 'a2', question: 'Unanswered about a2?', reply: null },
      { id: 'k4', answer_id: null, question: 'About the whole thing?', reply: null },
    ] satisfies StoredAsk[],
  };
  let n = 0;
  const newId = () => `new-${++n}`;

  it('replaces the redrafted answers and keeps the rest', () => {
    const merged = mergeApplicationDrafts(existing, { answers: [drafted], asks: [], wholeApplication: false }, newId);
    expect(merged.drafts.a1).toEqual({
      answer: 'New draft.',
      evidence_item_ids: ['e1'],
      unsupported_claims: [],
      over_limit: { count: 6, limit: 5, unit: 'words' },
    });
    expect(merged.drafts.a2.answer).toBe('Other draft.');
  });

  it('keeps every replied ask, and replaces unanswered asks about what was redrafted', () => {
    const one = mergeApplicationDrafts(
      existing,
      { answers: [drafted], asks: [{ answerId: 'a1', question: 'New ask?' }], wholeApplication: false },
      () => 'fresh',
    );
    expect(one.asks.map((a) => a.id)).toEqual(['k1', 'k3', 'k4', 'fresh']);
    expect(one.asks.at(-1)).toEqual({ id: 'fresh', answer_id: 'a1', question: 'New ask?', reply: null });

    const whole = mergeApplicationDrafts(existing, { answers: [drafted], asks: [], wholeApplication: true }, newId);
    expect(whole.asks.map((a) => a.id)).toEqual(['k1', 'k3']);
  });

  it('starts from nothing when no draft was stored', () => {
    const merged = mergeApplicationDrafts(null, { answers: [drafted], asks: [], wholeApplication: true }, newId);
    expect(Object.keys(merged.drafts)).toEqual(['a1']);
    expect(merged.asks).toEqual([]);
  });
});

describe('stored drafts', () => {
  it('round-trips a draft through the stored shape', () => {
    const draft = {
      text: 'An answer.',
      evidenceItemIds: ['e1'],
      unsupportedClaims: ['led nine people'],
      considerations: ['Lead with the result.'],
      bannedFound: ['leverage'],
      overLimit: { count: 9, limit: 5, unit: 'words' as const },
    };
    expect(toStoredDraft(draft)).toEqual({
      answer: 'An answer.',
      evidence_item_ids: ['e1'],
      unsupported_claims: ['led nine people'],
      considerations: ['Lead with the result.'],
      banned_found: ['leverage'],
      over_limit: { count: 9, limit: 5, unit: 'words' },
    });
    expect(fromStoredDraft(toStoredDraft(draft))).toEqual(draft);
    expect(fromStoredDraft({ answer: 'Old row.', evidence_item_ids: [], unsupported_claims: [] })).toEqual({
      text: 'Old row.',
      evidenceItemIds: [],
      unsupportedClaims: [],
      bannedFound: [],
    });
  });
});

describe('renderDraftRequest', () => {
  const asks: StoredAsk[] = [
    { id: 'k1', answer_id: 'a1', question: 'Why did you leave Brex?', reply: 'The team was cut in half.' },
    { id: 'k2', answer_id: 'a2', question: 'How big was the team?', reply: null },
    { id: 'k3', answer_id: 'a1', question: 'Anything else about a1?', reply: null },
  ];

  it('sends the questions to draft, the answered ones, and the replies as facts', () => {
    const text = renderDraftRequest({
      selected: [question('a1', null, { limit: WORDS_5 })],
      others: [question('a2', 'I ran the close.'), question('a3', null)],
      asks,
      wholeApplication: false,
    });
    expect(text).toContain('## The questions to answer now');
    expect(text).toContain('answer id: a1');
    expect(text).toContain('limit: 5 words');
    expect(text).toContain('## Answered already on this application');
    expect(text).toContain('I ran the close.');
    // An unanswered question that is not being drafted now is not shown as answered.
    expect(text).not.toContain('answer id: a3');
    expect(text).toContain('You asked: Why did you leave Brex?\nThey said: The team was cut in half.');
    // The pending ask about another answer stays; the one about a1 is replaced by this run.
    expect(text).toContain('- How big was the team?');
    expect(text).not.toContain('Anything else about a1?');
    expect(text).toContain('Call report_drafts');
  });

  it('leaves out the sections that have nothing in them', () => {
    const text = renderDraftRequest({ selected: [question('a1', null)], others: [], asks: [], wholeApplication: true });
    expect(text).not.toContain('Answered already');
    expect(text).not.toContain('What they told you');
    expect(text).not.toContain('Asked before');
  });
});

describe('renderRetryRequest', () => {
  it('names each answer over its limit and by how much', () => {
    const text = renderRetryRequest(
      [
        {
          answerId: 'a2',
          text: 'x'.repeat(30),
          evidenceItemIds: [],
          unsupportedClaims: [],
          bannedFound: [],
          overLimit: { count: 30, limit: 20, unit: 'characters' },
        },
      ],
      { a2: CHARS_20 },
    );
    expect(text).toContain('answer id a2: 30 characters, over the 20-character limit (limit 20 characters)');
    expect(text).toContain('only these answers');
  });
});
