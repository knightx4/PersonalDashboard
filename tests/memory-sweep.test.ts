/**
 * What the memory sweep embeds and how it keeps it current (plan #1247).
 *
 * core.memory_sources decides which rows are live and what their text is;
 * stale_memory_sources finds the ones whose passages are missing, out of date
 * or cut short; store_memory_chunks writes them; prune_memory_chunks removes
 * the passages of rows that are gone. The sweep in lib/memory/sweep.ts only
 * calls these, so the rules the done-when rests on (an edited note's passages
 * replaced, a deleted note's gone) are checked here against the SQL.
 *
 * The route and its schedule are checked at the bottom, as the map sweep's
 * are in map-sweep-cron.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

vi.mock('@/lib/memory/sweep', () => ({
  sweepMemory: vi.fn(async () => ({ pruned: 0, rows: 0, passages: 0, calls: 0, tokens: 0, stopped: null })),
}));
vi.mock('@/inngest/core/supabase-admin', () => ({ createCoreServiceSupabase: vi.fn(() => ({})) }));

const VECTOR = `[${new Array(1024).fill(0.01).join(',')}]`;
const MODEL = 'voyage-4-lite';

let userA = '';
let userB = '';
let connectionA = '';

type Stale = {
  user_id: string;
  source_table: string;
  source_ref: string;
  title: string | null;
  my_text: string | null;
  dash_text: string | null;
  source_hash: string;
};

async function seedNote(userId: string, connectionId: string, path: string, body: string) {
  await admin`
    insert into obsidian.notes (user_id, connection_id, path, title, body, blob_sha, size_bytes)
    values (${userId}, ${connectionId}, ${path}, ${path.replace(/\.md$/, '')}, ${body},
            ${`sha-${path}`}, ${body.length})`;
}

const stale = (limit = 100, owner: string | null = null) =>
  admin<Stale[]>`select * from stale_memory_sources(${limit}, ${owner}::uuid)`;

/** Write passages for a stale row the way lib/memory/sweep.ts does. */
async function store(row: Stale, bodies: string[], options: { replace?: boolean; count?: number; from?: number } = {}) {
  const payload = [
    {
      user_id: row.user_id,
      source_table: row.source_table,
      source_ref: row.source_ref,
      source_hash: row.source_hash,
      chunk_count: options.count ?? bodies.length,
      model: MODEL,
      replace: options.replace ?? true,
      chunks: bodies.map((body, index) => ({
        chunk_index: (options.from ?? 0) + index,
        author: row.dash_text ? 'dash' : 'me',
        body,
        embedding: VECTOR,
      })),
    },
  ];
  const [result] = await admin<{ n: number }[]>`select store_memory_chunks(${admin.json(payload)}::jsonb) as n`;
  return Number(result.n);
}

const chunksOf = (table: string, ref: string) =>
  admin<{ chunk_index: number; body: string; source_hash: string }[]>`
    select chunk_index, body, source_hash from memory_chunks
     where source_table = ${table} and source_ref = ${ref} order by chunk_index`;

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('sweep-a@example.com');
  userB = await createUser('sweep-b@example.com');
  const [connection] = await admin<{ id: string }[]>`
    insert into obsidian.vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userA}, 'a', 'a-vault', 'main', 'encrypted') returning id`;
  connectionA = connection.id;
  const [connectionB] = await admin<{ id: string }[]>`
    insert into obsidian.vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userB}, 'b', 'b-vault', 'main', 'encrypted') returning id`;

  await seedNote(userA, connectionA, 'Ideas/Land tax.md', 'Land value tax is the fairest tax there is, in my view.');
  await seedNote(userA, connectionA, 'Ideas/Next job.md', 'I want a small team that ships every week.');
  await seedNote(userA, connectionA, 'Stub.md', '[[Land tax]] #idea');
  await seedNote(userA, connectionA, 'Templates/Daily.md', 'What went well today, and what would I change?');
  await seedNote(userA, connectionA, 'CLAUDE.md', 'Instructions for an assistant working in this vault.');
  await seedNote(userB, connectionB.id, 'Ideas/Land tax.md', 'B thinks otherwise about land.');

  await admin`insert into job_search.thoughts (user_id, body) values (${userA}, 'Somewhere I can lead.')`;
  await admin`insert into core.files (user_id, title, body, made_by)
              values (${userA}, 'Research on rents', 'Rents rose four per cent.', 'claude')`;
  const [area] = await admin<{ id: string }[]>`
    insert into goals.areas (user_id, name) values (${userA}, 'Home') returning id`;
  await admin`insert into goals.items (user_id, level, area_id, title, detail)
              values (${userA}, 'goal', ${area.id}, 'Buy a flat', 'Two bedrooms near the park.')`;
  await admin`insert into goals.items (user_id, level, area_id, title, detail, archived_at)
              values (${userA}, 'goal', ${area.id}, 'Old goal', 'Put away.', now())`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('memory_sources', () => {
  it('takes live notes and leaves out stubs, templates and instruction files', async () => {
    const refs = (await stale(100, userA))
      .filter((row) => row.source_table === 'obsidian.notes')
      .map((row) => row.source_ref)
      .sort();
    expect(refs).toEqual(['Ideas/Land tax.md', 'Ideas/Next job.md']);
  });

  it('labels Dash\'s text as Dash\'s and leaves archived rows out', async () => {
    const rows = await stale(100, userA);
    const file = rows.find((row) => row.source_table === 'core.files');
    expect(file?.my_text).toBeNull();
    expect(file?.dash_text).toContain('Rents rose');

    const goals = rows.filter((row) => row.source_table === 'goals.items').map((row) => row.title);
    expect(goals).toEqual(['Buy a flat']);
  });

  it('puts the vault after the small sources, so the backfill does those first', async () => {
    const tables = (await stale(100, userA)).map((row) => row.source_table);
    expect(tables.indexOf('obsidian.notes')).toBe(tables.length - 2);
  });

  it('shows a signed-in person only their own rows', async () => {
    const own = await asUser(userB, (tx) => tx<Stale[]>`select * from stale_memory_sources(100, null)`);
    expect(own.map((row) => row.user_id)).toEqual([userB]);
    const asked = await asUser(userB, (tx) => tx<Stale[]>`select * from stale_memory_sources(100, ${userA}::uuid)`);
    expect(asked).toEqual([]);
  });
});

describe('keeping passages current', () => {
  beforeEach(async () => {
    await admin`delete from memory_chunks`;
  });

  it('stops listing a row once its passages are written', async () => {
    for (const row of await stale(100, userA)) await store(row, [`${row.title}: one`, `${row.title}: two`]);
    expect(await stale(100, userA)).toEqual([]);
  });

  it('replaces an edited note\'s passages and drops the ones past its new length', async () => {
    const note = (await stale(100, userA)).find((row) => row.source_ref === 'Ideas/Land tax.md')!;
    await store(note, ['old one', 'old two', 'old three']);

    await admin`update obsidian.notes set body = 'Land value tax, revised: I now have doubts.'
                where user_id = ${userA} and path = 'Ideas/Land tax.md'`;
    const edited = (await stale(100, userA)).find((row) => row.source_ref === 'Ideas/Land tax.md')!;
    expect(edited.source_hash).not.toBe(note.source_hash);

    await store(edited, ['new one']);
    const after = await chunksOf('obsidian.notes', 'Ideas/Land tax.md');
    expect(after.filter((c) => c.source_hash === edited.source_hash).map((c) => c.body)).toEqual(['new one']);
    expect((await admin`select 1 from memory_chunks where source_ref = 'Ideas/Land tax.md' and user_id = ${userA}`).length).toBe(1);
    expect((await stale(100, userA)).some((row) => row.source_ref === 'Ideas/Land tax.md')).toBe(false);
  });

  it('removes a deleted note\'s passages on the next prune, and nobody else\'s', async () => {
    for (const row of await stale(100, null)) await store(row, ['a passage']);
    await admin`update obsidian.notes set deleted_at = now()
                where user_id = ${userA} and path = 'Ideas/Next job.md'`;

    const [pruned] = await admin<{ n: number }[]>`select prune_memory_chunks(null) as n`;
    expect(Number(pruned.n)).toBe(1);
    expect(await chunksOf('obsidian.notes', 'Ideas/Next job.md')).toEqual([]);
    expect((await admin`select 1 from memory_chunks where user_id = ${userB}`).length).toBe(1);

    await admin`update obsidian.notes set deleted_at = null
                where user_id = ${userA} and path = 'Ideas/Next job.md'`;
  });

  it('finds a long row whose write was cut short, and finishes it', async () => {
    const note = (await stale(100, userA)).find((row) => row.source_ref === 'Ideas/Next job.md')!;
    await store(note, ['first', 'second'], { count: 4 });
    expect((await stale(100, userA)).some((row) => row.source_ref === 'Ideas/Next job.md')).toBe(true);

    await store(note, ['third', 'fourth'], { count: 4, replace: false, from: 2 });
    expect((await chunksOf('obsidian.notes', 'Ideas/Next job.md')).map((c) => c.body)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
    ]);
    expect((await stale(100, userA)).some((row) => row.source_ref === 'Ideas/Next job.md')).toBe(false);
  });

  it('refuses a signed-in person writing passages for someone else', async () => {
    const note = (await stale(100, userA)).find((row) => row.source_ref === 'Ideas/Land tax.md')!;
    const payload = [{ ...note, chunk_count: 1, model: MODEL, replace: true,
      chunks: [{ chunk_index: 0, author: 'me', body: 'planted', embedding: VECTOR }] }];
    await expect(
      asUser(userB, (tx) => tx`select store_memory_chunks(${tx.json(payload)}::jsonb)`),
    ).rejects.toThrow(/row-level security/);
  });
});

const { GET, POST } = await import('@/app/api/cron/memory-sweep/route');
const { sweepMemory } = await import('@/lib/memory/sweep');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/memory-sweep', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the memory sweep route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(sweepMemory).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(tickRequest(null))).status).toBe(401);
    expect((await POST(tickRequest('not-the-secret'))).status).toBe(401);
    expect(sweepMemory).not.toHaveBeenCalled();
  });

  it('sweeps every account within a deadline for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    const options = vi.mocked(sweepMemory).mock.calls[0][1]!;
    expect(options.userId).toBeNull();
    // Under the five minutes between ticks, with room to finish a round.
    expect(options.deadline! - Date.now()).toBeLessThanOrEqual(240_000);
  });
});

const statements = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0136_memory_sweep.sql'),
  'utf8',
)
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the memory sweep schedule', () => {
  it('unschedules the job by name, then ticks every five minutes', () => {
    const unschedule = statements.indexOf("jobname = 'memory-sweep-tick'");
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(statements.indexOf('cron.schedule('));
    expect(statements).toContain("'*/5 * * * *'");
  });

  it('posts to the sweep route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/memory-sweep'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});
