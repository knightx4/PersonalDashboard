import { describe, expect, it } from 'vitest';
import type { DashChange, NewDashChange } from '@/lib/talk/changes';
import type { AskContext, SchemaClient } from './db';
import { duplicateAnswersLookup } from './duplicate-answers';
import { executeProposal, type ProposeContext } from './propose';

/** duplicate_answers (plan #2232.3) and the proposal that follows it. */

const ME = '00000000-0000-4000-8000-00000000000a';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TABLE = 'job_search.application_answers';

type Row = Record<string, unknown>;

const WHY = 'Because the work matters to me.';

function stub(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      const filters: ((row: Row) => boolean)[] = [];
      const query = {
        select: () => query,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), query),
        order: () => query,
        limit: () => query,
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
      };
      return query;
    },
  } as unknown as SchemaClient;
}

/** Three roles, each with one answer to the Hooli question, worded as asked. */
function world(answers: { n: number; role: number; question: number; text: string; status?: string }[]) {
  const tables: Record<string, Row[]> = {
    roles: [1, 2, 3].map((n) => ({ id: id(70 + n), user_id: ME, title: `Role ${n}` })),
    applications: [1, 2, 3].map((n) => ({ id: id(50 + n), user_id: ME, role_id: id(70 + n) })),
    questions: [
      { id: id(61), user_id: ME, text: 'Why are you interested in Hooli?' },
      { id: id(62), user_id: ME, text: '1. Why are you interested in Hooli?' },
      { id: id(63), user_id: ME, text: 'Why are you interested in Hooli? (max 150 words)' },
      { id: id(64), user_id: ME, text: 'Salary expectations?' },
    ],
    application_answers: answers.map((a) => ({
      id: id(a.n),
      user_id: ME,
      application_id: id(50 + a.role),
      question_id: id(60 + a.question),
      answer: a.text,
      status: a.status ?? 'draft',
      created_at: `2026-09-0${a.n}T10:00:00Z`,
    })),
  };
  const ctx: AskContext = { userId: ME, today: '2026-10-16', enabledModules: ['jobs'], db: async () => stub(tables), searchSources: [] };
  return ctx;
}

async function lookup(ctx: AskContext) {
  const result = await duplicateAnswersLookup(ctx);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('duplicate_answers', () => {
  it('marks the extra copies of identical answers, the Hooli question on three roles, and says which stays', async () => {
    const result = await lookup(
      world([
        { n: 1, role: 1, question: 1, text: WHY },
        { n: 2, role: 2, question: 2, text: WHY },
        { n: 3, role: 3, question: 3, text: `${WHY}  ` },
        { n: 4, role: 1, question: 4, text: 'Negotiable' },
      ]),
    );
    expect(result.rows.map((r) => r.ref)).toEqual([id(2), id(3)]);
    expect(result.rows.every((r) => r.detail?.remove === true && r.detail?.keeps === 'Role 1 (draft)')).toBe(true);
    expect(result.rows[0].href).toBe(`/jobs/roles/${id(72)}`);
    expect(result.totals).toMatchObject({ repeated_questions: 1, to_remove: 2 });
    expect(result.note).toContain('keeps the copy on Role 1 (draft)');
  });

  it('keeps a submitted copy, never lists it, and marks the drafts that match it', async () => {
    const result = await lookup(
      world([
        { n: 1, role: 1, question: 1, text: WHY, status: 'submitted' },
        { n: 2, role: 2, question: 2, text: WHY },
        { n: 3, role: 3, question: 3, text: WHY, status: 'approved' },
      ]),
    );
    expect(result.rows.map((r) => r.ref)).toEqual([id(2), id(3)]);
    expect(result.rows.some((r) => r.ref === id(1))).toBe(false);
    expect(result.rows.every((r) => r.detail?.keeps === 'Role 1 (submitted)')).toBe(true);
  });

  it('lists nothing for removal when every copy is submitted', async () => {
    const result = await lookup(
      world([
        { n: 1, role: 1, question: 1, text: WHY, status: 'submitted' },
        { n: 2, role: 2, question: 2, text: WHY, status: 'submitted' },
      ]),
    );
    expect(result.rows).toEqual([]);
    expect(result.note).toContain('every copy is submitted');
  });

  it('marks nothing for removal where the copies are worded differently, and names each wording', async () => {
    const result = await lookup(
      world([
        { n: 1, role: 1, question: 1, text: WHY },
        { n: 2, role: 2, question: 2, text: 'Hooli is hiring the people I want to learn from.' },
        { n: 3, role: 3, question: 3, text: WHY },
      ]),
    );
    expect(result.rows.map((r) => r.ref)).toEqual([id(1), id(2), id(3)]);
    expect(result.rows.every((r) => r.detail?.remove === false)).toBe(true);
    expect(result.rows.map((r) => r.detail?.wording)).toEqual(['A', 'B', 'A']);
    expect(result.totals).toMatchObject({ to_remove: 0 });
    expect(result.note).toContain('ask which to keep');
  });

  it('leaves out a question answered once, and says so when nothing repeats', async () => {
    const result = await lookup(world([{ n: 1, role: 1, question: 1, text: WHY }, { n: 4, role: 2, question: 4, text: 'x' }]));
    expect(result.rows).toEqual([]);
    expect(result.note).toContain('No question');
  });
});

describe('propose_delete after duplicate_answers', () => {
  function proposing(answers: Parameters<typeof world>[0], seen: number[]) {
    const base = world(answers);
    const kept: NewDashChange[] = [];
    const known = new Set(seen.map((n) => `${TABLE} ${id(n)}`));
    const ctx: ProposeContext = {
      ...base,
      seen: (table, ref) => known.has(`${table} ${ref}`),
      save: async (change) => (kept.push(change), { ...change, id: 'c1', status: 'proposed' } as DashChange),
    };
    return { ctx, kept };
  }

  it('proposes the extra copies with the question as their title', async () => {
    const { ctx, kept } = proposing(
      [
        { n: 1, role: 1, question: 1, text: WHY },
        { n: 2, role: 2, question: 2, text: WHY },
        { n: 3, role: 3, question: 3, text: WHY },
      ],
      [2, 3],
    );
    const result = await executeProposal('propose_delete', { table: TABLE, refs: [id(2), id(3)] }, ctx);
    expect(result.ok).toBe(true);
    expect((kept[0].input as { count: number; titles: string[] }).count).toBe(2);
    expect((kept[0].input as { titles: string[] }).titles).toEqual(['1. Why are you interested in Hooli?', 'Why are you interested in Hooli? (max 150 words)']);
  });

  it('refuses a submitted answer even when a lookup returned it', async () => {
    const { ctx, kept } = proposing(
      [
        { n: 1, role: 1, question: 1, text: WHY, status: 'submitted' },
        { n: 2, role: 2, question: 2, text: WHY },
      ],
      [1, 2],
    );
    const result = await executeProposal('propose_delete', { table: TABLE, refs: [id(1), id(2)] }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('submitted') });
    expect(kept).toEqual([]);
  });
});
