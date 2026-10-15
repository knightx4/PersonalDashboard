import { describe, expect, it } from 'vitest';
import { questionFingerprint } from '@/lib/jobs/fingerprint';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { JOBS_WRITES, runJobsWrite, undoApplicationQuestions, type JobsWriteEnv } from './jobs-writes';

/**
 * An application's questions and answers, written by an agent (plan
 * #1894.6.8): add_application_questions, save_answer and set_default_answer.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE = '00000000-0000-4000-8000-0000000000bb';
const ROLE = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const QUESTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_QUESTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ANSWER = '99999999-9999-4999-8999-999999999991';
const EVIDENCE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const WHY = 'Why do you want to work here?';

const env = (tables: FakeTables): JobsWriteEnv => {
  const db = fakeSchemaDb(tables);
  return { userId: ME, jobs: db('job_search'), todo: db('todo'), core: db('core') };
};

const write = (name: string) => JOBS_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const result = await runJobsWrite(write(name), env(tables), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const result = await runJobsWrite(write(name), env(tables), input);
  if (!('ok' in result)) throw new Error('expected a refusal');
  return result.error;
}

function tables(): FakeTables {
  return {
    'job_search.companies': [{ id: COMPANY, user_id: ME, name: 'Acme', slug: 'acme' }],
    'job_search.roles': [{ id: ROLE, user_id: ME, company_id: COMPANY, title: 'Data Engineer' }],
    'job_search.applications': [{ id: APP, user_id: ME, role_id: ROLE, attempt: 1 }],
    'job_search.questions': [
      { id: QUESTION, user_id: ME, text: WHY, fingerprint: questionFingerprint(WHY), times_seen: 2, canonical_answer: null },
      {
        id: OTHER_QUESTION,
        user_id: SOMEONE,
        text: 'Tell us about a hard problem.',
        fingerprint: questionFingerprint('Tell us about a hard problem.'),
        times_seen: 1,
        canonical_answer: null,
      },
    ],
    'job_search.application_answers': [],
    'job_search.evidence_items': [{ id: EVIDENCE, user_id: ME, used_count: 0 }],
  };
}

function withAnswer(): FakeTables {
  const t = tables();
  t['job_search.application_answers'] = [
    { id: ANSWER, user_id: ME, application_id: APP, question_id: QUESTION, answer: null, status: 'draft', evidence_item_ids: [], unsupported_claims: [] },
  ];
  return t;
}

const db = (t: FakeTables) => {
  const fake = fakeSchemaDb(t);
  return async (schema: string) => fake(schema);
};

describe('add_application_questions', () => {
  it('adds new questions to the bank and the application, and counts a known one', async () => {
    const t = tables();
    const result = await made('add_application_questions', t, {
      role_ref: ROLE,
      questions: ['Please briefly describe why you want to work here (in your own words)', 'What is your notice period?'],
    });
    const answers = t['job_search.application_answers'];
    expect(answers).toHaveLength(2);
    expect(answers.every((row) => row.application_id === APP)).toBe(true);
    expect(answers[0].question_id).toBe(QUESTION);
    expect(t['job_search.questions'].find((row) => row.id === QUESTION)!.times_seen).toBe(3);
    const created = t['job_search.questions'].find((row) => row.text === 'What is your notice period?')!;
    expect(created).toMatchObject({ user_id: ME, kind: 'logistics' });
    expect(result.kind).toBe('add_application_questions');
    expect(result.summary).toBe('Dash added 2 questions to the application for Data Engineer at Acme.');
    expect(result.undo).toEqual({
      answers: answers.map((row) => row.id),
      created: [created.id],
      seen: [{ id: QUESTION, before: 2, after: 3 }],
    });
  });

  it('splits a pasted block the way the role page does', async () => {
    const t = tables();
    await made('add_application_questions', t, { application_ref: APP, questions: '1. Why us?\n2. Why now, of all times?' });
    expect(t['job_search.application_answers']).toHaveLength(2);
  });

  it('leaves out a question already on the application, and refuses when every one is', async () => {
    const t = withAnswer();
    const result = await made('add_application_questions', t, { application_ref: APP, questions: [WHY, 'Where are you based?'] });
    expect(t['job_search.application_answers']).toHaveLength(2);
    expect(result.summary).toContain('leaving out 1 already on it');
    expect(await refused('add_application_questions', withAnswer(), { application_ref: APP, questions: [WHY] })).toMatch(/already/);
  });

  it('is undone whole: the rows come off, the count goes back, the new question comes out', async () => {
    const t = tables();
    const result = await made('add_application_questions', t, { application_ref: APP, questions: [WHY, 'Where are you based?'] });
    const undone = await undoApplicationQuestions({ userId: ME, db: db(t) as never }, result.undo);
    expect(undone.ok).toBe(true);
    expect(t['job_search.application_answers']).toHaveLength(0);
    expect(t['job_search.questions'].find((row) => row.id === QUESTION)!.times_seen).toBe(2);
    expect(t['job_search.questions'].some((row) => row.text === 'Where are you based?')).toBe(false);
  });

  it('refuses the Undo once one of the questions has been answered', async () => {
    const t = tables();
    const result = await made('add_application_questions', t, { application_ref: APP, questions: [WHY] });
    t['job_search.application_answers'][0].answer = 'Because.';
    const undone = await undoApplicationQuestions({ userId: ME, db: db(t) as never }, result.undo);
    expect(undone).toEqual({ ok: false, error: expect.stringMatching(/answered since/) });
    expect(t['job_search.application_answers']).toHaveLength(1);
  });
});

describe('save_answer', () => {
  it('saves an answer named by its question, and keeps the row before for the Undo', async () => {
    const t = withAnswer();
    const result = await made('save_answer', t, { role_ref: ROLE, question: 'why do you want to work here', answer: 'The data.', status: 'approved' });
    expect(t['job_search.application_answers'][0]).toMatchObject({ answer: 'The data.', status: 'approved' });
    expect(result.op).toBe('update');
    expect(result.before).toMatchObject({ answer: null, status: 'draft' });
    expect(result.undo).toBeNull();
    expect(result.summary).toBe('Dash saved the answer to "Why do you want to work here?" as approved, for Data Engineer at Acme.');
  });

  it('keeps a drafted answer with the evidence it rests on', async () => {
    const t = withAnswer();
    await made('save_answer', t, { answer_ref: ANSWER, answer: 'Draft.', evidence_refs: [EVIDENCE], unsupported_claims: ['Led a team of 40'] });
    expect(t['job_search.application_answers'][0]).toMatchObject({
      answer: 'Draft.',
      evidence_item_ids: [EVIDENCE],
      unsupported_claims: ['Led a team of 40'],
    });
  });

  it('refuses evidence that is not theirs, approving an empty answer, and a question not on the application', async () => {
    expect(await refused('save_answer', withAnswer(), { answer_ref: ANSWER, evidence_refs: [QUESTION] })).toMatch(/not an evidence item/);
    expect(await refused('save_answer', withAnswer(), { answer_ref: ANSWER, status: 'submitted' })).toMatch(/no answer yet/);
    expect(await refused('save_answer', withAnswer(), { application_ref: APP, question: 'salary expectations', answer: 'x' })).toMatch(/It has: "Why/);
  });
});

describe('set_default_answer', () => {
  it("reuses an answer's words for its question", async () => {
    const t = withAnswer();
    t['job_search.application_answers'][0].answer = 'The data.';
    const result = await made('set_default_answer', t, { answer_ref: ANSWER });
    const question = t['job_search.questions'].find((row) => row.id === QUESTION)!;
    expect(question.canonical_answer).toBe('The data.');
    expect(question.canonical_answer_updated_at).toBeTruthy();
    expect(result.subjectRef).toBe(`job_search.questions:${QUESTION}`);
    expect(result.before).toMatchObject({ canonical_answer: null });
  });

  it('takes the words given, and refuses a question that is not theirs', async () => {
    const t = tables();
    await made('set_default_answer', t, { question_ref: QUESTION, answer: 'Mission.' });
    expect(t['job_search.questions'][0].canonical_answer).toBe('Mission.');
    expect(await refused('set_default_answer', tables(), { question_ref: OTHER_QUESTION, answer: 'x' })).toMatch(/no question of theirs/);
    expect(await refused('set_default_answer', withAnswer(), { answer_ref: ANSWER })).toMatch(/empty/);
  });
});

describe('save_answer in one turn', () => {
  it('saves two answers on one application by ref, both as drafts, and names both', async () => {
    const SECOND_ANSWER = '99999999-9999-4999-8999-999999999992';
    const SECOND_QUESTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
    const NOTICE = 'What is your notice period?';
    const t = withAnswer();
    t['job_search.questions'].push({ id: SECOND_QUESTION, user_id: ME, text: NOTICE, fingerprint: questionFingerprint(NOTICE), times_seen: 1, canonical_answer: null });
    t['job_search.application_answers'].push({
      id: SECOND_ANSWER,
      user_id: ME,
      application_id: APP,
      question_id: SECOND_QUESTION,
      answer: 'A long old answer about notice.',
      status: 'draft',
      evidence_item_ids: [],
      unsupported_claims: [],
    });
    const first = await made('save_answer', t, { answer_ref: ANSWER, answer: 'I like the data work here.', evidence_refs: [EVIDENCE] });
    const second = await made('save_answer', t, { answer_ref: SECOND_ANSWER, answer: 'One month.', unsupported_claims: ['Can start sooner'] });
    const rows = t['job_search.application_answers'];
    expect(rows.map((row) => row.status)).toEqual(['draft', 'draft']);
    expect(rows[0]).toMatchObject({ answer: 'I like the data work here.', evidence_item_ids: [EVIDENCE] });
    expect(rows[1]).toMatchObject({ answer: 'One month.', unsupported_claims: ['Can start sooner'] });
    expect(first.summary).toContain('Why do you want to work here?');
    expect(second.summary).toContain('What is your notice period?');
  });
});
