import { describe, expect, it } from 'vitest';
import { questionFingerprint } from './fingerprint';
import { planQuestionMerges, planStatements, type AnswerRow, type QuestionRow } from './merge-questions';

const q = (id: string, text: string, created: string, extra: Partial<QuestionRow> = {}): QuestionRow => ({
  id,
  user_id: 'u1',
  text,
  fingerprint: 'old-' + id,
  canonical_answer: null,
  canonical_answer_updated_at: null,
  times_seen: 1,
  created_at: created,
  ...extra,
});
const a = (id: string, app: string, question: string, answer: string | null, extra: Partial<AnswerRow> = {}): AnswerRow => ({
  id,
  application_id: app,
  question_id: question,
  answer,
  generated_from_question_id: null,
  created_at: '2026-01-01',
  ...extra,
});

describe('planQuestionMerges', () => {
  const pair = [
    q('new', 'Why do you want to work here?', '2026-02-01', { times_seen: 2 }),
    q('old', '1. Why do you want to work here?', '2026-01-01', { times_seen: 3 }),
    q('other', 'What is your salary expectation?', '2026-01-05'),
  ];

  it('keeps the oldest and sums times_seen', () => {
    const plan = planQuestionMerges(pair, []);
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0];
    expect(g.keep.id).toBe('old');
    expect(g.drop.map((d) => d.id)).toEqual(['new']);
    expect(g.timesSeen).toBe(5);
    expect(g.canonical).toBeNull();
  });

  it('takes a canonical answer from a dropped row only when the kept one lacks it', () => {
    const donor = { canonical_answer: 'Mine', canonical_answer_updated_at: '2026-03-01' };
    const lacking = planQuestionMerges([{ ...pair[0], ...donor }, pair[1]], []);
    expect(lacking.groups[0].canonical).toEqual({ answer: 'Mine', updatedAt: '2026-03-01' });
    const has = planQuestionMerges([{ ...pair[0], ...donor }, { ...pair[1], canonical_answer: 'Kept' }], []);
    expect(has.groups[0].canonical).toBeNull();
  });

  it('updates the fingerprint of every surviving row and not the dropped one', () => {
    const plan = planQuestionMerges(pair, []);
    expect(plan.fingerprintUpdates.map((u) => u.id).sort()).toEqual(['old', 'other']);
    expect(plan.fingerprintUpdates.find((u) => u.id === 'old')?.to).toBe(
      questionFingerprint('Why do you want to work here?'),
    );
  });

  it('moves an answer from a dropped question and repoints generated_from', () => {
    const g = planQuestionMerges(pair, [
      a('a1', 'app1', 'new', 'text'),
      a('a2', 'app2', 'old', 'text', { generated_from_question_id: 'new' }),
    ]).groups[0];
    expect(g.repointAnswerIds).toEqual(['a1']);
    expect(g.deleteAnswerIds).toEqual([]);
    expect(g.repointGeneratedFromIds).toEqual(['a2']);
  });

  it('keeps the kept question answer when an application answered both', () => {
    const g = planQuestionMerges(pair, [a('a1', 'app1', 'old', 'kept'), a('a2', 'app1', 'new', 'other')]).groups[0];
    expect(g.deleteAnswerIds).toEqual(['a2']);
    expect(g.repointAnswerIds).toEqual([]);
  });

  it('prefers the answer with content when the kept one is empty', () => {
    const g = planQuestionMerges(pair, [a('a1', 'app1', 'old', ' '), a('a2', 'app1', 'new', 'real')]).groups[0];
    expect(g.deleteAnswerIds).toEqual(['a1']);
    expect(g.repointAnswerIds).toEqual(['a2']);
  });

  it('never merges across users', () => {
    const plan = planQuestionMerges([pair[0], { ...pair[1], user_id: 'u2' }], []);
    expect(plan.groups).toHaveLength(0);
  });

  it('writes statements in an order that is safe in one transaction', () => {
    const sql = planStatements(planQuestionMerges(pair, [a('a1', 'app1', 'new', 'x'), a('a2', 'app1', 'old', "y'")]));
    const iDelete = sql.findIndex((s) => s.startsWith('delete from job_search.questions'));
    expect(sql[0]).toBe("delete from job_search.application_answers where id in ('a1')");
    expect(sql.findIndex((s) => s.includes("'merge:'"))).toBeGreaterThan(iDelete);
  });
});
