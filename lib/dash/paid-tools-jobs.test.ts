import { describe, expect, it } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { draftAnswerTool, draftApplicationAnswersTool, draftCoverLetterTool } from './paid-tools-jobs';
import type { DashPaidCheckContext } from './registry';

/** The Jobs drafting tools check what they are asked to draft, as the buttons' actions would (plan #2228.3). */

const ME = '00000000-0000-4000-8000-00000000000a';
const APP = '00000000-0000-4000-8000-0000000000a1';
const ROLE = '00000000-0000-4000-8000-0000000000b1';
const ANSWER = '00000000-0000-4000-8000-0000000000c1';
const QUESTION = '00000000-0000-4000-8000-0000000000d1';

type Tables = Record<string, Record<string, unknown>[]>;

/** A client whose reads return each table's rows, whatever the filters. */
function client(tables: Tables): SchemaClient {
  const from = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const query: Record<string, unknown> = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      then: (resolve: (value: typeof result) => unknown) => resolve(result),
    };
    return query;
  };
  return { from } as unknown as SchemaClient;
}

function context(tables: Tables, seen = true, enabled: DashPaidCheckContext['enabledModules'] = ['jobs']): DashPaidCheckContext {
  return {
    userId: ME,
    today: '2026-10-15',
    timezone: 'UTC',
    enabledModules: enabled,
    db: async () => client(tables),
    searchSources: [],
    seen: () => seen,
  };
}

const TABLES: Tables = {
  applications: [{ id: APP, role_id: ROLE }],
  roles: [{ title: 'Designer', companies: { name: 'Acme' } }],
  application_answers: [
    { id: ANSWER, application_id: APP, question_id: QUESTION, answer: null },
    { id: 'two', application_id: APP, question_id: 'q2', answer: 'Already written.' },
    { id: 'three', application_id: APP, question_id: 'q3', answer: '  ' },
  ],
  questions: [{ text: 'Why do you want to work here?' }],
};

describe('draft_answer', () => {
  it('queues one line naming the question and the role, for the answer it was given', async () => {
    const prepared = await draftAnswerTool.prepare(context(TABLES), { answer_ref: `job_search.application_answers:${ANSWER}` });
    expect(prepared).toEqual({
      ok: true,
      args: { answerId: ANSWER },
      line: 'Draft the answer to "Why do you want to work here?" on Designer at Acme.',
      paths: [`/jobs/roles/${ROLE}`],
    });
  });

  it('refuses a ref no lookup returned, and a workspace that is off', async () => {
    const unseen = await draftAnswerTool.prepare(context(TABLES, false), { answer_ref: ANSWER });
    expect(unseen.ok).toBe(false);
    const off = await draftAnswerTool.prepare(context(TABLES, true, []), { answer_ref: ANSWER });
    expect(off.ok).toBe(false);
  });
});

describe('draft_application_answers', () => {
  it('counts the unanswered questions, which the estimate scales by', async () => {
    const prepared = await draftApplicationAnswersTool.prepare(context(TABLES), { application_ref: APP });
    expect(prepared).toMatchObject({
      ok: true,
      args: { applicationId: APP },
      count: 2,
      line: 'Draft the answers to the 2 unanswered questions on Designer at Acme.',
    });
  });

  it('refuses an application whose questions are all answered', async () => {
    const tables = { ...TABLES, application_answers: [{ id: ANSWER, application_id: APP, question_id: QUESTION, answer: 'Done.' }] };
    const prepared = await draftApplicationAnswersTool.prepare(context(tables), { application_ref: APP });
    expect(prepared.ok).toBe(false);
  });

  it('wants one of application_ref and role_ref', async () => {
    expect((await draftApplicationAnswersTool.prepare(context(TABLES), {})).ok).toBe(false);
    expect((await draftApplicationAnswersTool.prepare(context(TABLES), { application_ref: APP, role_ref: ROLE })).ok).toBe(false);
  });
});

describe('draft_cover_letter', () => {
  it('queues the letter for the role’s latest application', async () => {
    const prepared = await draftCoverLetterTool.prepare(context(TABLES), { role_ref: ROLE });
    expect(prepared).toEqual({
      ok: true,
      args: { applicationId: APP },
      line: 'Draft the cover letter for Designer at Acme.',
      paths: [`/jobs/roles/${ROLE}`],
    });
  });
});
