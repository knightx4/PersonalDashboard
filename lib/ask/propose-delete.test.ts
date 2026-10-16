import { describe, expect, it } from 'vitest';
import type { DashChange, NewDashChange } from '@/lib/talk/changes';
import type { SchemaClient } from './db';
import { executeProposal, type ProposeContext } from './propose';
import { deleteRows, undoDeletedRows, type DeleteRowsInput } from './delete-rows';

/**
 * propose_delete (plan #2232.1): rows of the allowed table, named by refs a
 * lookup returned, read again as the person. A proposal keeps a snapshot and
 * deletes nothing. Job notes joined in plan #2266.2, with the refuse check
 * every entry may give (decision #2266.1).
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const THEM = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TABLE = 'job_search.application_answers';
const NOTES = 'job_search.notes';
const TASKS = 'todo.tasks';
const ROLES = 'job_search.roles';
const LONG = `Spoke to the hiring manager about the team. ${'They want someone who can own the data pipeline. '.repeat(3)}`;

type Row = Record<string, unknown>;

function setup(opts: { enabled?: ProposeContext['enabledModules']; seen?: string[] } = {}) {
  const tables: Record<string, Row[]> = {
    application_answers: [
      { id: id(1), user_id: ME, application_id: id(50), question_id: id(60), answer: 'First', status: 'draft' },
      { id: id(2), user_id: ME, application_id: id(50), question_id: id(61), answer: 'First', status: 'draft' },
      { id: id(3), user_id: THEM, application_id: id(51), question_id: id(62), answer: 'Theirs', status: 'draft' },
      { id: id(4), user_id: ME, application_id: id(50), question_id: id(60), answer: 'Sent', status: 'submitted' },
    ],
    notes: [
      { id: id(20), user_id: ME, body: LONG, role_id: id(70), company_id: null, contact_id: null, pinned: false },
      { id: id(21), user_id: ME, body: 'Ask about\n  the visa', role_id: id(70), company_id: null, contact_id: null, pinned: false },
      { id: id(22), user_id: ME, body: 'Met at the meetup', role_id: null, company_id: null, contact_id: id(80), pinned: false },
      { id: id(23), user_id: THEM, body: 'Not mine', role_id: id(71), company_id: null, contact_id: null, pinned: false },
    ],
    tasks: [
      { id: id(35), user_id: ME, title: 'Renew passport', parent_id: null, status: 'open' },
      { id: id(30), user_id: ME, title: 'Book the dentist', parent_id: null, status: 'open' },
      { id: id(31), user_id: ME, title: 'Plan the move', parent_id: null, status: 'open' },
      { id: id(32), user_id: ME, title: 'Find a van', parent_id: id(31), status: 'open' },
      { id: id(33), user_id: THEM, title: 'Not mine', parent_id: null, status: 'open' },
    ],
    task_links: [{ id: id(40), task_id: id(35), role_id: id(70) }],
    questions: [
      { id: id(60), user_id: ME, text: 'Why us?' },
      { id: id(61), user_id: ME, text: 'Why this role?' },
    ],
    applications: [{ id: id(50), user_id: ME, role_id: id(70) }],
    roles: [
      { id: id(10), user_id: ME, title: 'Data Engineer', company_id: id(90) },
      { id: id(11), user_id: ME, title: 'Analyst', company_id: id(90) },
      { id: id(70), user_id: ME, title: 'Staff Engineer', company_id: id(90) },
      { id: id(72), user_id: ME, title: 'Designer', company_id: id(90) },
      { id: id(71), user_id: THEM, title: 'Not mine', company_id: id(91) },
    ],
    companies: [{ id: id(90), user_id: ME, name: 'Acme' }],
    attachments: [{ id: id(95), user_id: ME, role_id: id(72) }],
    suggestions: [],
  };
  const writes: string[] = [];
  const client = {
    from: (table: string) => {
      const filters: ((row: Row) => boolean)[] = [];
      let op: 'read' | 'delete' | 'insert' = 'read';
      let inserted: Row | null = null;
      const write = (name: string) => (values?: Row) => {
        writes.push(`${name} ${table}`);
        if (name === 'delete') op = 'delete';
        if (name === 'insert') {
          op = 'insert';
          inserted = values ?? null;
        }
        return query;
      };
      const query = {
        select: () => query,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), query),
        insert: write('insert'),
        update: write('update'),
        delete: write('delete'),
        then: (resolve: (value: unknown) => void) => {
          const rows = (tables[table] ??= []);
          if (op === 'insert') {
            if (inserted) rows.push(inserted);
            return resolve({ data: null, error: null });
          }
          const matched = rows.filter((r) => filters.every((f) => f(r)));
          if (op === 'delete') tables[table] = rows.filter((r) => !matched.includes(r));
          resolve({ data: matched, error: null });
        },
      };
      return query;
    },
  } as unknown as SchemaClient;
  const kept: NewDashChange[] = [];
  const seen = new Set((opts.seen ?? []).flatMap((n) => [`${TABLE} ${n}`, `${NOTES} ${n}`, `${TASKS} ${n}`, `${ROLES} ${n}`]));
  const ctx: ProposeContext = {
    userId: ME,
    today: '2026-10-15',
    enabledModules: opts.enabled ?? ['jobs'],
    db: async () => client,
    searchSources: [],
    seen: (table, ref) => seen.has(`${table} ${ref}`),
    save: async (change) => {
      kept.push(change);
      return { ...change, id: 'c1', status: 'proposed' } as DashChange;
    },
  };
  return { ctx, kept, writes, tables };
}

describe('propose_delete', () => {
  it('keeps a proposal with a snapshot of each row and deletes nothing', async () => {
    const { ctx, kept, writes } = setup({ seen: [id(1), id(2)] });
    const result = await executeProposal('propose_delete', { table: TABLE, refs: [id(1), id(2)] }, ctx);
    expect(result.ok).toBe(true);
    expect(writes).toEqual([]);
    expect(kept).toHaveLength(1);
    const input = kept[0].input as { count: number; titles: string[]; href: string; rows: Row[] };
    expect(kept[0].kind).toBe('delete_rows');
    expect(input.count).toBe(2);
    expect(input.titles).toEqual(['Why us?', 'Why this role?']);
    expect(input.href).toBe(`/jobs/roles/${id(70)}`);
    expect(input.rows.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(input.rows[0].answer).toBe('First');
  });

  it('refuses a table outside the allowed list', async () => {
    const { ctx, kept } = setup({ seen: [id(10)] });
    const result = await executeProposal('propose_delete', { table: 'job_search.contacts', refs: [id(10)] }, ctx);
    expect(result.ok).toBe(false);
    expect(kept).toEqual([]);
  });

  it("refuses a ref no lookup returned, and a row that is not the person's", async () => {
    const unseen = setup({ seen: [id(1)] });
    expect(await executeProposal('propose_delete', { table: TABLE, refs: [id(1), id(2)] }, unseen.ctx)).toMatchObject({ ok: false });
    const theirs = setup({ seen: [id(3)] });
    const result = await executeProposal('propose_delete', { table: TABLE, refs: [id(3)] }, theirs.ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not one of theirs') });
    expect(unseen.kept).toEqual([]);
    expect(theirs.kept).toEqual([]);
  });

  it('refuses with no refs, too many refs, or the workspace off', async () => {
    const { ctx } = setup();
    expect(await executeProposal('propose_delete', { table: TABLE, refs: [] }, ctx)).toMatchObject({ ok: false });
    const many = Array.from({ length: 26 }, (_, n) => id(100 + n));
    expect(await executeProposal('propose_delete', { table: TABLE, refs: many }, ctx)).toMatchObject({ ok: false });
    const off = setup({ enabled: [], seen: [id(1)] });
    expect(await executeProposal('propose_delete', { table: TABLE, refs: [id(1)] }, off.ctx)).toMatchObject({ ok: false });
  });
});

describe('propose_delete on job notes (plan #2266.2)', () => {
  it('names each note by its opening words and links its role', async () => {
    const { ctx, kept, writes } = setup({ seen: [id(20), id(21)] });
    const result = await executeProposal('propose_delete', { table: NOTES, refs: [id(20), id(21)] }, ctx);
    expect(result.ok).toBe(true);
    expect(writes).toEqual([]);
    const input = kept[0].input as DeleteRowsInput;
    expect(input.table).toBe(NOTES);
    expect(input.titles[0]).toHaveLength(80);
    expect(input.titles[0].startsWith('Spoke to the hiring manager')).toBe(true);
    expect(input.titles[0].endsWith('…')).toBe(true);
    expect(input.titles[1]).toBe('Ask about the visa');
    expect(input.href).toBe(`/jobs/roles/${id(70)}`);
  });

  it("links a contact's note to the contact, and refuses a note that is not theirs", async () => {
    const mine = setup({ seen: [id(22)] });
    await executeProposal('propose_delete', { table: NOTES, refs: [id(22)] }, mine.ctx);
    expect((mine.kept[0].input as DeleteRowsInput).href).toBe(`/jobs/contacts/${id(80)}`);
    const theirs = setup({ seen: [id(23)] });
    expect(await executeProposal('propose_delete', { table: NOTES, refs: [id(23)] }, theirs.ctx)).toMatchObject({ ok: false });
    expect(theirs.kept).toEqual([]);
  });

  it('deletes the note only on confirm, and Undo puts it back as it was', async () => {
    const { ctx, kept, tables } = setup({ seen: [id(21)] });
    await executeProposal('propose_delete', { table: NOTES, refs: [id(21)] }, ctx);
    expect(tables.notes.map((n) => n.id)).toContain(id(21));
    const removed = await deleteRows(ctx, kept[0].input as DeleteRowsInput);
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.deleted.rows).toHaveLength(1);
    expect(removed.deleted.rows[0].values).toMatchObject({ id: id(21), body: 'Ask about\n  the visa' });
    expect(tables.notes.map((n) => n.id)).not.toContain(id(21));
    expect(await undoDeletedRows(ctx, removed.deleted as unknown as Record<string, unknown>)).toEqual({ ok: true });
    expect(tables.notes.find((n) => n.id === id(21))).toMatchObject({ body: 'Ask about\n  the visa', role_id: id(70) });
  });
});

describe('propose_delete on tasks (plan #2266.3)', () => {
  it('names each task by its title and links the task list', async () => {
    const { ctx, kept, writes } = setup({ seen: [id(30)], enabled: ['todo'] });
    const result = await executeProposal('propose_delete', { table: TASKS, refs: [id(30)] }, ctx);
    expect(result.ok).toBe(true);
    expect(writes).toEqual([]);
    const input = kept[0].input as DeleteRowsInput;
    expect(input.table).toBe(TASKS);
    expect(input.titles).toEqual(['Book the dentist']);
    expect(input.href).toBe('/todo/all?status=all');
  });

  it('declines a task with subtasks, naming it, and keeps nothing', async () => {
    const { ctx, kept } = setup({ seen: [id(30), id(31)], enabled: ['todo'] });
    const result = await executeProposal('propose_delete', { table: TASKS, refs: [id(30), id(31)] }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Plan the move') });
    expect(result).toMatchObject({ error: expect.stringContaining('a subtask') });
    expect(kept).toEqual([]);
  });

  it('declines a task with links, reporting subtasks and links together', async () => {
    const linked = setup({ seen: [id(35)], enabled: ['todo'] });
    const result = await executeProposal('propose_delete', { table: TASKS, refs: [id(35)] }, linked.ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Renew passport') });
    expect(result).toMatchObject({ error: expect.stringContaining('a link to another item') });
    expect(linked.kept).toEqual([]);
    const both = setup({ seen: [id(31), id(35)], enabled: ['todo'] });
    const mixed = await executeProposal('propose_delete', { table: TASKS, refs: [id(31), id(35)] }, both.ctx);
    expect(mixed).toMatchObject({ error: expect.stringContaining('a subtask and a link') });
  });

  it('refuses a task that is not theirs, and the workspace off', async () => {
    const theirs = setup({ seen: [id(33)], enabled: ['todo'] });
    expect(await executeProposal('propose_delete', { table: TASKS, refs: [id(33)] }, theirs.ctx)).toMatchObject({ ok: false });
    const off = setup({ seen: [id(30)], enabled: ['jobs'] });
    expect(await executeProposal('propose_delete', { table: TASKS, refs: [id(30)] }, off.ctx)).toMatchObject({ ok: false });
  });

  it('deletes only on confirm, checks for subtasks again then, and Undo restores it', async () => {
    const { ctx, kept, tables, writes } = setup({ seen: [id(30)], enabled: ['todo'] });
    await executeProposal('propose_delete', { table: TASKS, refs: [id(30)] }, ctx);
    const input = kept[0].input as DeleteRowsInput;
    tables.tasks.push({ id: id(34), user_id: ME, title: 'Call them', parent_id: id(30), status: 'open' });
    expect(await deleteRows(ctx, input)).toMatchObject({ ok: false, error: expect.stringContaining('Nothing was removed.') });
    expect(writes).toEqual([]);
    tables.tasks = tables.tasks.filter((t) => t.id !== id(34));
    const removed = await deleteRows(ctx, input);
    if (!removed.ok) throw new Error(removed.error);
    expect(tables.tasks.map((t) => t.id)).not.toContain(id(30));
    expect(await undoDeletedRows(ctx, removed.deleted as unknown as Record<string, unknown>)).toEqual({ ok: true });
    expect(tables.tasks.find((t) => t.id === id(30))).toMatchObject({ title: 'Book the dentist' });
  });
});

describe('propose_delete on roles (plan #2266.4)', () => {
  it('names each role with its company and links the role page', async () => {
    const { ctx, kept, writes } = setup({ seen: [id(10)] });
    const result = await executeProposal('propose_delete', { table: ROLES, refs: [id(10)] }, ctx);
    expect(result.ok).toBe(true);
    expect(writes).toEqual([]);
    const input = kept[0].input as DeleteRowsInput;
    expect(input.titles).toEqual(['Data Engineer at Acme']);
    expect(input.href).toBe(`/jobs/roles/${id(10)}`);
  });

  it('declines a role with applications and notes, naming what is attached', async () => {
    const { ctx, kept } = setup({ seen: [id(10), id(70)] });
    const result = await executeProposal('propose_delete', { table: ROLES, refs: [id(10), id(70)] }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Staff Engineer') });
    expect(result).toMatchObject({ error: expect.stringContaining('1 application, 2 notes and 1 task link') });
    expect(kept).toEqual([]);
  });

  it('declines a role with an attachment', async () => {
    const { ctx } = setup({ seen: [id(72)] });
    const result = await executeProposal('propose_delete', { table: ROLES, refs: [id(72)] }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('1 attachment') });
  });

  it('refuses a role that is not theirs', async () => {
    const { ctx } = setup({ seen: [id(71)] });
    expect(await executeProposal('propose_delete', { table: ROLES, refs: [id(71)] }, ctx)).toMatchObject({ ok: false });
  });

  it('deletes only on confirm, checks again then, and Undo restores it', async () => {
    const { ctx, kept, tables, writes } = setup({ seen: [id(11)] });
    await executeProposal('propose_delete', { table: ROLES, refs: [id(11)] }, ctx);
    const input = kept[0].input as DeleteRowsInput;
    tables.applications.push({ id: id(51), user_id: ME, role_id: id(11) });
    expect(await deleteRows(ctx, input)).toMatchObject({ ok: false, error: expect.stringContaining('1 application') });
    expect(writes).toEqual([]);
    tables.applications = tables.applications.filter((a) => a.id !== id(51));
    const removed = await deleteRows(ctx, input);
    if (!removed.ok) throw new Error(removed.error);
    expect(tables.roles.map((r) => r.id)).not.toContain(id(11));
    expect(await undoDeletedRows(ctx, removed.deleted as unknown as Record<string, unknown>)).toEqual({ ok: true });
    expect(tables.roles.find((r) => r.id === id(11))).toMatchObject({ title: 'Analyst' });
  });
});

describe("an entry's refuse check (decision #2266.1)", () => {
  it('declines the proposal with the reason, keeping nothing', async () => {
    const { ctx, kept } = setup({ seen: [id(1), id(4)] });
    const result = await executeProposal('propose_delete', { table: TABLE, refs: [id(1), id(4)] }, ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('A submitted answer is never removed.') });
    expect(kept).toEqual([]);
  });

  it('is checked again at confirm, deleting nothing when it names a reason', async () => {
    const { ctx, kept, tables, writes } = setup({ seen: [id(1)] });
    await executeProposal('propose_delete', { table: TABLE, refs: [id(1)] }, ctx);
    const input = kept[0].input as DeleteRowsInput;
    // The row and the card's snapshot agree, so only the refuse check stops it.
    tables.application_answers[0].status = 'submitted';
    const result = await deleteRows(ctx, { ...input, rows: [{ ...input.rows[0], status: 'submitted' }] });
    expect(result).toEqual({ ok: false, error: 'Nothing was removed. A submitted answer is never removed.' });
    expect(writes).toEqual([]);
  });
});
