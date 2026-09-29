/**
 * The changes Dash proposes from Ask Dash, and what became of each
 * (plan #1187), against the database.
 *
 * Done when a person can read and write only their own rows. The table also
 * refuses the moves the feature does not have: confirming a declined change,
 * confirming one twice, or rewriting what was proposed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';
let conversationA = '';
let turnA = '';

const TASK = '6f1c1f5e-0000-4000-8000-00000000c001';

/** Dash proposes a todo in A's conversation, as A. */
async function propose(title = 'Call Acme'): Promise<string> {
  const [row] = await asUser(
    userA,
    (tx) => tx<{ id: string }[]>`
      insert into dash_changes (user_id, conversation_id, kind, input)
      values (${userA}, ${conversationA}, 'add_todo', ${tx.json({ title })})
      returning id`,
  );
  return row.id;
}

async function statusOf(id: string): Promise<string> {
  const [row] = await admin<{ status: string }[]>`select status from dash_changes where id = ${id}`;
  return row.status;
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('changes-a@example.com');
  userB = await createUser('changes-b@example.com');
  const [conversation] = await admin<{ id: string }[]>`
    insert into conversations (id, user_id, subject_kind, subject_ref, title)
    values ('6f1c1f5e-0000-4000-8000-0000000000c0', ${userA}, 'ask',
            '6f1c1f5e-0000-4000-8000-0000000000c0', 'Remind me to call Acme')
    returning id`;
  conversationA = conversation.id;
  const [turn] = await admin<{ id: string }[]>`
    insert into conversation_turns (conversation_id, user_id, role, body)
    values (${conversationA}, ${userA}, 'assistant', 'I can add that as a todo.')
    returning id`;
  turnA = turn.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a change Dash proposes', () => {
  it('is kept as proposed, then takes its turn and a confirm with the row it wrote', async () => {
    const id = await propose();
    expect(await statusOf(id)).toBe('proposed');

    await asUser(userA, async (tx) => {
      await tx`update dash_changes set turn_id = ${turnA} where id = ${id}`;
      await tx`
        update dash_changes
        set status = 'confirmed', confirmed_at = now(), written_table = 'todo.tasks', written_ref = ${TASK}
        where id = ${id} and status = 'proposed'`;
    });
    expect(await statusOf(id)).toBe('confirmed');

    await asUser(userA, (tx) => tx`update dash_changes set status = 'undone', undone_at = now() where id = ${id}`);
    expect(await statusOf(id)).toBe('undone');
  });

  it('cannot be confirmed once declined, or confirmed twice', async () => {
    const declined = await propose('Declined');
    await asUser(userA, (tx) => tx`update dash_changes set status = 'declined', declined_at = now() where id = ${declined}`);
    await expect(
      asUser(
        userA,
        (tx) => tx`
          update dash_changes
          set status = 'confirmed', declined_at = null, confirmed_at = now(),
              written_table = 'todo.tasks', written_ref = ${TASK}
          where id = ${declined}`,
      ),
    ).rejects.toThrow(/cannot become/);

    const confirmed = await propose('Twice');
    const confirm = () =>
      asUser(
        userA,
        (tx) => tx`
          update dash_changes
          set status = 'confirmed', confirmed_at = now(), written_table = 'todo.tasks', written_ref = ${TASK}
          where id = ${confirmed}`,
      );
    await confirm();
    // Pointing the same confirmed change at a second row is refused.
    await expect(
      asUser(userA, (tx) => tx`update dash_changes set written_ref = 'another' where id = ${confirmed}`),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      asUser(userA, (tx) => tx`update dash_changes set status = 'proposed', confirmed_at = null, written_table = null, written_ref = null where id = ${confirmed}`),
    ).rejects.toThrow(/cannot become/);
  });

  it('refuses a confirm with no written row, an unknown kind, and a rewrite of what was proposed', async () => {
    const id = await propose('Fixed');
    await expect(
      asUser(userA, (tx) => tx`update dash_changes set status = 'confirmed', confirmed_at = now() where id = ${id}`),
    ).rejects.toThrow();
    await expect(
      asUser(
        userA,
        (tx) => tx`
          insert into dash_changes (user_id, conversation_id, kind, input)
          values (${userA}, ${conversationA}, 'send_email', '{}'::jsonb)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`update dash_changes set input = ${tx.json({ title: 'Other' })} where id = ${id}`),
    ).rejects.toThrow(/cannot be rewritten/);
  });
});

describe('another account', () => {
  it('cannot read, change or delete the changes', async () => {
    expect(await asUser(userB, (tx) => tx`select id from dash_changes`)).toHaveLength(0);
    expect(
      await asUser(userB, (tx) => tx`update dash_changes set status = 'declined', declined_at = now() returning id`),
    ).toHaveLength(0);
    expect(await asUser(userB, (tx) => tx`delete from dash_changes returning id`)).toHaveLength(0);
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from dash_changes where user_id = ${userA}`;
    expect(count).toBeGreaterThan(0);
  });

  it('cannot hang a change from the conversation, under either account', async () => {
    await expect(
      asUser(
        userB,
        (tx) => tx`
          insert into dash_changes (user_id, conversation_id, kind, input)
          values (${userB}, ${conversationA}, 'add_todo', '{"title": "Mine"}'::jsonb)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(
        userB,
        (tx) => tx`
          insert into dash_changes (user_id, conversation_id, kind, input)
          values (${userA}, ${conversationA}, 'add_todo', '{"title": "Mine"}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });
});
