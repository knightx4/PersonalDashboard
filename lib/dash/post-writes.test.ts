import { beforeEach, describe, expect, it } from 'vitest';
import type { AskContext } from '@/lib/ask/db';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { POST_CHANGE_KINDS } from '@/lib/ask/post-changes';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type MadeDashChange } from '@/lib/talk/changes';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { listPostPictures } from './post-pictures';
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

function suggest(input: unknown, ctx = context()): Promise<DashWriteResult> {
  return POST_WRITE_TOOLS.find((t) => t.name === 'suggest_post')!.apply(ctx, input);
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
    'public.profiles': [{ id: ME, display_name: 'Robin Quill' }],
    'job_search.companies': [{ id: 'c1', user_id: ME, name: 'Brightwater' }],
    'job_search.contacts': [{ id: 'p1', user_id: ME, full_name: 'Avery Stone' }],
    'public.social_posts': [
      row(POST),
      row(POSTED, { status: 'posted', posted_url: 'https://x.com/i/status/1', posted_at: '2026-10-14T09:00:00Z' }),
      row(THEIRS, { user_id: OTHER }),
      row(SENDING, { x_thread_ids: ['1850000000000000001'] }),
    ],
  };
});

describe('rewrite_post', () => {
  it('lists the post kinds Ask keeps', () => {
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

/**
 * Dash saving a new post draft when asked (plan #2384.3): a draft that passes
 * the posts run's checks goes in suggested with draft and body the same and
 * no run, a picture must be one the gallery listing returns, a failing draft
 * is refused with its reasons and nothing saved, and Undo deletes it while it
 * is still suggested and unedited.
 */
describe('suggest_post', () => {
  const ANGLE = 'Dash can save a post draft';
  const POSTS = ['You can now ask Dash for a post about something that shipped, and the draft lands on the Posts tab with a picture.'];
  const added = () => tables['public.social_posts'].filter((row) => row.angle === ANGLE);

  it('saves a checked draft as suggested, with draft and body the same and no run', async () => {
    const result = ok(await suggest({ angle: ANGLE, posts: POSTS }));

    expect(added()).toHaveLength(1);
    const row = added()[0];
    expect(row).toMatchObject({ user_id: ME, status: 'suggested', draft: POSTS, body: POSTS, image_paths: [], run_id: null });
    expect(result).toMatchObject({
      kind: 'suggest_post',
      subjectRef: `public.social_posts:${row.id}`,
      op: 'insert',
      before: null,
      summary: expect.stringContaining(`Dash saved the post draft "${ANGLE}"`),
      row: expect.objectContaining({ table: 'public.social_posts', ref: row.id, href: '/dev/posts' }),
    });
    expect(result.input).toMatchObject({ verb: 'Saved the post draft', paths: ['/dev/posts', '/home'] });
  });

  it('attaches a gallery picture the listing returns', async () => {
    const pictures = await listPostPictures();
    expect(pictures.length).toBeGreaterThan(0);
    const result = ok(await suggest({ angle: ANGLE, posts: POSTS, picture: pictures[0].path }));
    expect(added()[0].image_paths).toEqual([pictures[0].path]);
    expect(result.summary).toMatch(/with a picture/);
  });

  it('refuses a picture the listing did not return, and saves nothing', async () => {
    for (const picture of ['/posts/2026-01-01-not-there.png', 'https://example.com/a.png', '../secret.png']) {
      expect(refused(await suggest({ angle: ANGLE, posts: POSTS, picture }))).toMatch(/not a gallery picture/);
    }
    expect(added()).toEqual([]);
  });

  it('refuses a draft that fails the post checks, with the reasons, and saves nothing', async () => {
    const tooLong = refused(await suggest({ angle: ANGLE, posts: ['a'.repeat(281)] }));
    expect(tooLong).toMatch(/the post is 281 characters; the limit is 280/);
    expect(tooLong).toMatch(/Nothing was saved/);

    expect(refused(await suggest({ angle: ANGLE, posts: ['Shipped a thing, see example.com'] }))).toMatch(/has a link or a domain/);
    // The terms the posts run keeps out: the person's name, their companies and contacts.
    expect(refused(await suggest({ angle: ANGLE, posts: ['Robin built this.'] }))).toMatch(/names "Robin"/);
    expect(refused(await suggest({ angle: ANGLE, posts: ['Made for Brightwater.'] }))).toMatch(/names "Brightwater"/);
    expect(refused(await suggest({ angle: 'Avery Stone asked for it', posts: POSTS }))).toMatch(/angle names "Avery Stone"/);
    expect(refused(await suggest({ angle: ANGLE, posts: ['1', '2', '3', '4', '5', '6'] }))).toMatch(/at most 5 posts/);
    expect(refused(await suggest({ angle: '', posts: POSTS }))).toMatch(/angle is missing/);

    expect(added()).toEqual([]);
    expect(tables['core.dash_actions']).toEqual([]);
  });

  it('refuses when Dev is switched off', async () => {
    expect(refused(await suggest({ angle: ANGLE, posts: POSTS }, context(['todo'])))).toMatch(/Dev workspace/);
    expect(added()).toEqual([]);
  });

  it('is undone from Home, which removes the draft', async () => {
    const { undo } = await keep(ok(await suggest({ angle: ANGLE, posts: POSTS })));
    expect(added()).toHaveLength(1);

    expect(await undo()).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect(added()).toEqual([]);
  });

  it('is not undone once the person has edited or planned the draft', async () => {
    const edited = await keep(ok(await suggest({ angle: ANGLE, posts: POSTS })));
    added()[0].body = ['Their own wording.'];
    expect(await edited.undo()).toMatchObject({ ok: false });
    expect(added()).toHaveLength(1);

    tables['public.social_posts'] = tables['public.social_posts'].filter((row) => row.angle !== ANGLE);
    const planned = await keep(ok(await suggest({ angle: ANGLE, posts: POSTS })));
    added()[0].status = 'planned';
    expect(await planned.undo()).toMatchObject({ ok: false });
    expect(added()).toHaveLength(1);
  });
});
