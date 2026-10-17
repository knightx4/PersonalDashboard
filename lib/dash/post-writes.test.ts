import { beforeEach, describe, expect, it } from 'vitest';
import type { AskContext } from '@/lib/ask/db';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { POST_CHANGE_KINDS } from '@/lib/ask/post-changes';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type MadeDashChange } from '@/lib/talk/changes';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { POST_WRITE_TOOLS } from './post-writes';
import type { DashWriteContext, DashWriteResult } from './registry';

/**
 * Dash rewriting a post draft's text when asked (plan #2202.1): the new text
 * replaces body and leaves draft alone, a posted draft is refused, a rewrite
 * that breaks docs/X-POSTS.md's rules is refused with nothing written, and the
 * change is undone from its record while the text is still Dash's.
 */

const ME = '00000000-0000-4000-8000-0000000000ee';
const OTHER = '00000000-0000-4000-8000-0000000000ef';
const POST = '00000000-0000-4000-8000-000000000e01';
const POSTED = '00000000-0000-4000-8000-000000000e02';
const THEIRS = '00000000-0000-4000-8000-000000000e03';
const SENDING = '00000000-0000-4000-8000-000000000e04';

const FIRST = [
  'The plan page now shows which steps wait on a question and which wait on a key, so it is clear what to do first when I open it in the morning and there are a lot of rows.',
  'It took two tries to get the wording right.',
];

let tables: FakeTables;
let seen: Set<string>;

function context(enabled: AskContext['enabledModules'] = ['dev']): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-15',
    timezone: 'UTC',
    enabledModules: enabled,
    db: async (schema) => client(schema),
    searchSources: [],
    seen: (table, ref) => seen.has(`${table}:${ref}`),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

function rewrite(input: unknown, ctx = context()): Promise<DashWriteResult> {
  return POST_WRITE_TOOLS[0].apply(ctx, input);
}

function ok(result: DashWriteResult): Extract<DashWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

function refused(result: DashWriteResult): string {
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

/** Keeps the write as Ask does, then presses its Undo. */
async function keep(result: Extract<DashWriteResult, { ok: true }>) {
  const client = fakeSchemaDb(tables);
  const kept = await insertMadeChange(client('core') as unknown as CoreSupabaseClient, ME, 'conv-1', {
    ...result,
    undo: result.undo ?? null,
  } as unknown as MadeDashChange);
  const deps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-15',
    enabledModules: ['dev'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => '2026-10-15T12:00:00Z',
  };
  return { kept, undo: () => undoChange(deps, kept.id) };
}

const post = (id = POST) => tables['public.social_posts'].find((row) => row.id === id)!;

beforeEach(() => {
  seen = new Set([POST, POSTED, THEIRS, SENDING].map((id) => `public.social_posts:${id}`));
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    user_id: ME,
    platform: 'x',
    angle: 'What the plan page shows first',
    status: 'suggested',
    draft: FIRST,
    body: FIRST,
    x_sending_at: null,
    x_thread_ids: [],
    posted_url: null,
    posted_at: null,
    dropped_at: null,
    ...extra,
  });
  tables = {
    'core.dash_actions': [],
    'public.social_posts': [
      row(POST),
      row(POSTED, { status: 'posted', posted_url: 'https://x.com/i/status/1', posted_at: '2026-10-14T09:00:00Z' }),
      row(THEIRS, { user_id: OTHER }),
      row(SENDING, { x_thread_ids: ['1850000000000000001'] }),
    ],
  };
});

describe('rewrite_post', () => {
  it('is the one post kind Ask keeps', () => {
    expect(POST_WRITE_TOOLS.map((t) => t.name)).toEqual([...POST_CHANGE_KINDS]);
  });

  it('shortens a draft: body takes the new text and draft keeps what Dash first wrote', async () => {
    const shorter = ['The plan page now shows which steps wait on a question and which wait on a key.'];
    const result = ok(await rewrite({ post_ref: POST, posts: shorter }));

    expect(post().body).toEqual(shorter);
    expect(post().draft).toEqual(FIRST);
    expect(result).toMatchObject({
      kind: 'rewrite_post',
      subjectRef: `public.social_posts:${POST}`,
      op: 'update',
      before: expect.objectContaining({ body: FIRST }),
      after: expect.objectContaining({ body: shorter }),
      summary: expect.stringContaining('Dash rewrote the post draft "What the plan page shows first"'),
      row: expect.objectContaining({ table: 'public.social_posts', ref: POST, href: '/dev/posts' }),
    });
    expect(result.input).toMatchObject({ verb: 'Rewrote the post draft', paths: ['/dev/posts', '/home'] });
  });

  it('rewrites a planned draft the same way as a suggested one', async () => {
    post().status = 'planned';
    const result = ok(await rewrite({ post_ref: POST, posts: ['Shorter.'] }));
    expect(post().body).toEqual(['Shorter.']);
    expect(post().status).toBe('planned');
    expect(result).toMatchObject({ kind: 'rewrite_post', op: 'update' });
  });

  it('refuses a posted draft and changes nothing', async () => {
    const error = refused(await rewrite({ post_ref: POSTED, posts: ['Shorter.'] }));
    expect(error).toMatch(/posted/);
    expect(post(POSTED).body).toEqual(FIRST);
  });

  it('refuses a draft part-way on X', async () => {
    expect(refused(await rewrite({ post_ref: SENDING, posts: ['Shorter.'] }))).toMatch(/already on X/);
    expect(post(SENDING).body).toEqual(FIRST);
  });

  it('refuses text that breaks the length or privacy rules, saying why, and writes nothing', async () => {
    const tooLong = refused(await rewrite({ post_ref: POST, posts: ['a'.repeat(281)] }));
    expect(tooLong).toMatch(/the post is 281 characters; the limit is 280/);

    const leaky = refused(await rewrite({ post_ref: POST, posts: ['Built this for my job search, see example.com'] }));
    expect(leaky).toMatch(/has a link or a domain/);
    expect(leaky).toMatch(/job search/);

    expect(refused(await rewrite({ post_ref: POST, posts: ['1', '2', '3', '4', '5', '6'] }))).toMatch(/at most 5 posts/);
    expect(post().body).toEqual(FIRST);
    expect(tables['core.dash_actions']).toEqual([]);
  });

  it('refuses a draft no lookup returned, and one that is not theirs', async () => {
    seen.delete(`public.social_posts:${POST}`);
    expect(refused(await rewrite({ post_ref: POST, posts: ['Shorter.'] }))).toMatch(/Look it up first/);
    expect(refused(await rewrite({ post_ref: THEIRS, posts: ['Shorter.'] }))).toMatch(/no post draft of theirs/);
    expect(post(THEIRS).body).toEqual(FIRST);
  });

  it('refuses when Dev is switched off', async () => {
    expect(refused(await rewrite({ post_ref: POST, posts: ['Shorter.'] }, context(['todo'])))).toMatch(/Dev workspace/);
  });

  it('is undone from Home, which puts the text back', async () => {
    const { undo } = await keep(ok(await rewrite({ post_ref: POST, posts: ['Shorter.'] })));
    expect(post().body).toEqual(['Shorter.']);

    expect(await undo()).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect(post().body).toEqual(FIRST);
  });

  it('is not undone once the person has edited the text since', async () => {
    const { undo } = await keep(ok(await rewrite({ post_ref: POST, posts: ['Shorter.'] })));
    post().body = ['Their own wording.'];

    expect(await undo()).toMatchObject({ ok: false });
    expect(post().body).toEqual(['Their own wording.']);
  });
});
