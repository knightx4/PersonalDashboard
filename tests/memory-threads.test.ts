/**
 * What the person said in a thread is found by recall (plan #1466, migration
 * 0171).
 *
 * core.memory_sources gives every thread in core.conversations that is not
 * folded into a Dev row its own row, `core.conversations`, keyed by the
 * thread's subject_ref. Checked here end to end: a turn written under a goal
 * goes through the real sweep (lib/memory/sweep.ts, with a stand-in embedder)
 * and comes back from the real search recall uses (lib/memory/search.ts).
 * Also: Ask keeps only the person's questions, a Dev row's thread stays
 * folded into that row, and a role's turns copied from job_search.notes are
 * not embedded twice.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMemorySweep, memorySweepStore } from '@/lib/memory/sweep';
import { MEMORY_SOURCE_MODULES, memorySourcesFor, searchMemory } from '@/lib/memory/search';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-core';

const DIMENSIONS = 1024;

/** The same direction for every text, so the nearest passages are all of them. */
const VECTOR = new Array(DIMENSIONS).fill(0.01);

type Source = {
  user_id: string;
  source_table: string;
  source_ref: string;
  title: string | null;
  my_text: string | null;
  dash_text: string | null;
};

/**
 * The core functions the sweep and the search call, run over the test
 * database the way PostgREST would run them.
 */
const rpc = async (fn: string, args: Record<string, unknown>) => {
  try {
    switch (fn) {
      case 'prune_memory_chunks': {
        const [row] = await admin<{ n: number }[]>`
          select core.prune_memory_chunks(${args.p_user_id as string | null}::uuid) as n`;
        return { data: Number(row.n), error: null };
      }
      case 'stale_memory_sources':
        return {
          data: await admin`select * from core.stale_memory_sources(
                  ${args.p_limit as number}, ${args.p_user_id as string | null}::uuid)`,
          error: null,
        };
      case 'store_memory_chunks': {
        const [row] = await admin<{ n: number }[]>`
          select core.store_memory_chunks(${admin.json(args.p_rows as never)}::jsonb) as n`;
        return { data: Number(row.n), error: null };
      }
      case 'search_memory':
        return {
          data: await admin`select * from core.search_memory(
                  ${args.query_embedding as string}, ${args.p_user_id as string}::uuid,
                  ${args.p_sources as string[]}::text[], ${args.match_limit as number},
                  ${args.min_similarity as number}, null, null)`,
          error: null,
        };
      default:
        return { data: null, error: { message: `no rpc ${fn} in this test` } };
    }
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
  }
};

const client = { rpc } as unknown as Parameters<typeof memorySweepStore>[0];

async function sweep(userId: string) {
  return runMemorySweep({
    ...memorySweepStore(client, userId),
    embed: async ({ texts }) => ({ ok: true, vectors: texts.map(() => VECTOR), model: 'voyage-4-lite', tokens: 1 }),
  });
}

async function recall(userId: string, question: string) {
  const result = await searchMemory(client, {
    userId,
    question,
    sources: memorySourcesFor(['goals', 'jobs']),
    embed: async () => ({ ok: true, vector: VECTOR, model: 'voyage-4-lite' }),
  });
  if (!result.ok) throw new Error(result.detail);
  return result.passages;
}

const threads = (userId: string) =>
  admin<Source[]>`select * from core.memory_sources(${userId}::uuid) where source_table = 'core.conversations'`;

let person = '';
let goalId = '';
let roleId = '';
let askId = '';

beforeAll(async () => {
  await truncateAll();
  person = await createUser('threads@example.com');

  const [area] = await admin<{ id: string }[]>`
    insert into goals.areas (user_id, name) values (${person}, 'Home') returning id`;
  const [goal] = await admin<{ id: string }[]>`
    insert into goals.items (user_id, level, area_id, title) values (${person}, 'goal', ${area.id}, 'Buy a flat')
    returning id`;
  goalId = goal.id;

  const [company] = await admin<{ id: string }[]>`
    insert into job_search.companies (user_id, name, slug) values (${person}, 'Acme', 'acme') returning id`;
  const [role] = await admin<{ id: string }[]>`
    insert into job_search.roles (user_id, company_id, title) values (${person}, ${company.id}, 'Staff engineer')
    returning id`;
  roleId = role.id;

  // A role note from before the move, copied into the thread with its id
  // (0169). The copy is replayed by hand, past the trigger that now turns
  // role notes away.
  const [note] = await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    return tx<{ id: string }[]>`
      insert into job_search.notes (user_id, role_id, body, author)
      values (${person}, ${roleId}, 'Old note on the role.', 'me') returning id`;
  });
  await admin`select core.add_thread_turn(${person}, ${`job_search.roles:${roleId}`}, 'me', 'placeholder')`;
  await admin`
    update core.conversation_turns set id = ${note.id}, body = 'Old note on the role.'
     where user_id = ${person} and body = 'placeholder'`;
  await admin`select core.add_thread_turn(${person}, ${`job_search.roles:${roleId}`}, 'me',
                     'The commute to Acme is too long for five days a week.')`;

  const [ask] = await admin<{ id: string }[]>`
    with fresh as (select gen_random_uuid() as id)
    insert into core.conversations (id, user_id, subject_kind, subject_ref, title)
    select id, ${person}, 'ask', id::text, 'Saving for a deposit' from fresh returning subject_ref as id`;
  askId = ask.id;
  await admin`
    insert into core.conversation_turns (conversation_id, user_id, role, body)
    select id, ${person}, 'user', 'How much have I put aside for the deposit?'
      from core.conversations where subject_ref = ${askId}`;
  await admin`
    insert into core.conversation_turns (conversation_id, user_id, role, body)
    select id, ${person}, 'assistant', 'About four thousand, from your savings goal.'
      from core.conversations where subject_ref = ${askId}`;

  // A Dev row's thread is folded into the row (0170), not a thread source.
  const [idea] = await admin<{ id: string }[]>`
    insert into public.ideas (user_id, body) values (${person}, 'Group the ideas by workspace.') returning id`;
  await admin`select core.add_thread_turn(${person}, ${`public.ideas:${idea.id}`}, 'me', 'Newest first.')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('threads as a memory source', () => {
  it('returns a turn written under a goal from recall after the next sweep', async () => {
    const said = 'Two bedrooms, and it has to be near the park so the dog gets a walk.';
    await admin`select core.add_thread_turn(${person}, ${`goals.items:${goalId}`}, 'me', ${said})`;
    await admin`select core.add_thread_turn(${person}, ${`goals.items:${goalId}`}, 'claude', 'Noted: near the park.')`;

    const before = await recall(person, 'where did I say the flat should be?');
    expect(before.some((p) => p.body.includes('near the park so the dog'))).toBe(false);

    const result = await sweep(person);
    expect(result.stopped).toBeNull();

    const passages = await recall(person, 'where did I say the flat should be?');
    const mine = passages.find((p) => p.sourceTable === 'core.conversations' && p.body.includes(said));
    expect(mine).toMatchObject({ sourceRef: `goals.items:${goalId}`, author: 'me' });
    expect(mine!.body.startsWith('Thread on Buy a flat\n\n')).toBe(true);
    const dash = passages.find((p) => p.sourceRef === `goals.items:${goalId}` && p.author === 'dash');
    expect(dash?.body).toContain('Noted: near the park.');
  });

  it('keeps only the person\'s questions from Ask, under the conversation\'s own id', async () => {
    const [ask] = (await threads(person)).filter((row) => row.source_ref === askId);
    expect(ask.title).toMatch(/^Saving for a deposit, \d{1,2} \w+ \d{4}$/);
    expect(ask.my_text).toContain('How much have I put aside for the deposit?');
    expect(ask.dash_text).toBeNull();
  });

  it('names a role by its company and leaves out the turns copied from its notes', async () => {
    const [role] = (await threads(person)).filter((row) => row.source_ref === `job_search.roles:${roleId}`);
    expect(role.title).toBe('Thread on Staff engineer at Acme');
    expect(role.my_text).toContain('The commute to Acme is too long');
    expect(role.my_text).not.toContain('Old note on the role.');
  });

  it('leaves a Dev row\'s thread to that row', async () => {
    const refs = (await threads(person)).map((row) => row.source_ref);
    expect(refs.some((ref) => ref.startsWith('public.ideas:'))).toBe(false);
  });

  it('is searched whichever workspaces are on', () => {
    expect(MEMORY_SOURCE_MODULES['core.conversations']).toBeNull();
    expect(memorySourcesFor([])).toContain('core.conversations');
  });
});
