/**
 * The Dev workspace in search by meaning (plan #1321, migration 0137).
 *
 * core.memory_sources takes the owner's ideas, notes, plan steps and raises,
 * each with the comments under it, and the spec sections the sweep copies
 * into core.memory_documents. Checked here: only the owner's rows, never a
 * dismissed one, Dash's writing apart from the person's, and a spec edit
 * showing up as a stale row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

/** The owner's address, from 0085. */
const OWNER_EMAIL = 'selveyknight4@gmail.com';

type Source = {
  user_id: string;
  source_table: string;
  source_ref: string;
  title: string | null;
  my_text: string | null;
  dash_text: string | null;
  source_hash: string;
};

let owner = '';
let other = '';
const ids: Record<string, string> = {};

const sources = (user: string | null = null) => admin<Source[]>`select * from memory_sources(${user}::uuid)`;
const dev = (rows: Source[]) => rows.filter((row) => row.source_table.startsWith('public.') || row.source_table === 'docs.specs');

async function sync(refs: string[], rows: { source_ref: string; title: string; body: string; text_hash: string }[]) {
  const [result] = await admin<{ n: number }[]>`
    select sync_memory_documents('docs.specs', ${refs}::text[], ${admin.json(rows)}::jsonb) as n`;
  return Number(result.n);
}

beforeAll(async () => {
  await truncateAll();
  owner = await createUser(OWNER_EMAIL);
  other = await createUser('dev-other@example.com');

  const [idea] = await admin<{ id: string }[]>`
    insert into ideas (user_id, body, source) values (${owner}, 'The ideas list should group by workspace.', 'me') returning id`;
  ids.idea = idea.id;
  const [dashIdea] = await admin<{ id: string }[]>`
    insert into ideas (user_id, body, source) values (${owner}, 'Suggest a weekly digest.', 'claude') returning id`;
  ids.dashIdea = dashIdea.id;
  const [dismissed] = await admin<{ id: string }[]>`
    insert into ideas (user_id, body, dismissed_at) values (${owner}, 'Put aside.', now()) returning id`;
  ids.dismissed = dismissed.id;
  await admin`insert into ideas (user_id, body) values (${other}, 'Not the owner''s idea.')`;
  await admin`insert into feedback_items (user_id, kind, body) values (${other}, 'bug', 'Another account''s bug.')`;

  await admin`insert into dev_comments (user_id, idea_id, author, body)
              values (${owner}, ${ids.idea}, 'me', 'Newest first would be better.'),
                     (${owner}, ${ids.idea}, 'claude', 'Grouping is in plan #12.'),
                     (${owner}, ${ids.dismissed}, 'me', 'Under a dismissed idea.')`;

  const [step] = await admin<{ id: string }[]>`
    insert into plan_items (user_id, title, detail, acceptance, comment)
    values (${owner}, 'Order the ideas', 'Sort by date.', 'The list is newest first.', 'Done 2026-09-01: sorted.')
    returning id`;
  ids.step = step.id;
  await admin`insert into plan_items (user_id, title, dismissed_at) values (${owner}, 'A dismissed question', now())`;

  const [raise] = await admin<{ id: string }[]>`
    insert into raised_items (user_id, module, title, detail, ask, source)
    values (${owner}, 'dev', 'Which order?', 'Two orders fit.', 'Newest or oldest?', 'plan #12') returning id`;
  ids.raise = raise.id;
  await admin`insert into raised_items (user_id, module, title, detail, source, status)
              values (${owner}, 'dev', 'Dismissed raise', 'x', 'plan #13', 'dismissed')`;

  await sync(['plan#opening'], [
    { source_ref: 'plan#opening', title: 'The plan: Opening', body: 'Steps are small.', text_hash: 'h1' },
  ]);
  const [section] = await admin<{ id: string }[]>`
    insert into spec_sections (user_id, slug, anchor, heading, position)
    values (${owner}, 'plan', 'opening', 'Opening', 0) returning id`;
  await admin`insert into dev_comments (user_id, spec_section_id, author, body)
              values (${owner}, ${section.id}, 'me', 'Small is relative.')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('Dev sources', () => {
  it("takes only the owner's live rows, and nothing dismissed", async () => {
    const rows = dev(await sources());
    expect(rows.every((row) => row.user_id === owner)).toBe(true);
    const refs = rows.map((row) => row.source_ref);
    expect(refs).toEqual(expect.arrayContaining([ids.idea, ids.dashIdea, ids.step, ids.raise, 'plan#opening']));
    expect(rows).toHaveLength(5);
    expect(rows.some((row) => /dismissed|Put aside/i.test(`${row.title} ${row.my_text}`))).toBe(false);
  });

  it("keeps the comments with their row, the person's apart from Dash's", async () => {
    const idea = (await sources()).find((row) => row.source_ref === ids.idea)!;
    expect(idea.title).toBe('Idea: The ideas list should group by workspace.');
    expect(idea.my_text).toContain('group by workspace');
    expect(idea.my_text).toMatch(/Comment, \d+ \w+ \d{4}: Newest first would be better\./);
    expect(idea.dash_text).toContain('Grouping is in plan #12.');
    expect(idea.dash_text).not.toContain('Newest first');
  });

  it("labels a session's idea, a step's history and a raise as Dash's", async () => {
    const rows = await sources();
    const dashIdea = rows.find((row) => row.source_ref === ids.dashIdea)!;
    expect(dashIdea.my_text).toBeNull();
    expect(dashIdea.dash_text).toContain('weekly digest');

    const step = rows.find((row) => row.source_ref === ids.step)!;
    expect(step.title).toMatch(/^#\d+ Order the ideas$/);
    expect(step.my_text).toContain('Done when: The list is newest first.');
    expect(step.dash_text).toContain('Done 2026-09-01');

    const raise = rows.find((row) => row.source_ref === ids.raise)!;
    expect(raise.my_text).toBeNull();
    expect(raise.dash_text).toContain('Ask: Newest or oldest?');
  });

  it('reads a spec section with the comments under it', async () => {
    const spec = (await sources()).find((row) => row.source_table === 'docs.specs')!;
    expect(spec.title).toBe('The plan: Opening');
    expect(spec.my_text).toContain('Steps are small.');
    expect(spec.my_text).toContain('Small is relative.');
  });

  it('gives another account none of it, even asking for the owner', async () => {
    const theirs = await asUser(other, (tx) => tx<Source[]>`select * from memory_sources(null)`);
    expect(dev(theirs)).toEqual([]);
  });

  it('keeps the copy of a spec in line with the files', async () => {
    const before = (await sources()).find((row) => row.source_ref === 'plan#opening')!;

    // Unchanged: nothing written.
    expect(await sync(['plan#opening'], [
      { source_ref: 'plan#opening', title: 'The plan: Opening', body: 'Steps are small.', text_hash: 'h1' },
    ])).toBe(0);

    // Edited: a new hash, so the row reads as changed.
    await sync(['plan#opening'], [
      { source_ref: 'plan#opening', title: 'The plan: Opening', body: 'Steps are one sitting.', text_hash: 'h2' },
    ]);
    const after = (await sources()).find((row) => row.source_ref === 'plan#opening')!;
    expect(after.my_text).toContain('one sitting');
    expect(after.source_hash).not.toBe(before.source_hash);

    // Gone from the files: removed.
    expect(await sync([], [])).toBe(1);
    expect((await sources()).some((row) => row.source_table === 'docs.specs')).toBe(false);
  });

  it('refuses the copy to a signed-in account', async () => {
    await expect(
      asUser(owner, (tx) => tx`select sync_memory_documents('docs.specs', '{}'::text[], '[]'::jsonb)`),
    ).rejects.toThrow(/permission denied/);
  });
});
