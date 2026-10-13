/**
 * What selveyknight.com can read of the essays (plan #1863.11; learn
 * migration 0110, LEARN-ESSAYS-SPEC "Finishing and publishing").
 *
 * The site calls public.published_essays() and public.published_essay(slug)
 * with the anonymous key. Neither may return a draft, an unpublished essay,
 * another account's essay, or any column beyond the snapshot.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, sql } from './helpers/db-learn';

const OWNER = 'selveyknight4@gmail.com';
const OTHER = 'essay-publish-other@example.test';

let owner = '';
let other = '';

type Listed = { slug: string; title: string; stage: string; published_at: Date; updated_at: Date };
type One = Listed & { body: string };

async function asAnon<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('set local role anon');
    return fn(tx);
  }) as Promise<T>;
}

async function essay(
  userId: string,
  slug: string,
  snapshot: { body: string; stage: string; at: string } | null,
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into essays (user_id, path, slug, draft_body, published_body, published_title,
                        published_description, published_stage, published_at, first_published_at)
    values (${userId}, ${`Essays/${slug}.md`}, ${slug}, ${`# ${slug}\n\nThe private draft of ${slug}.`},
            ${snapshot?.body ?? null}, ${snapshot ? `Title of ${slug}` : null},
            ${snapshot ? 'What it argues.' : null}, ${snapshot?.stage ?? null},
            ${snapshot?.at ?? null}, ${snapshot?.at ?? null})
    returning id`;
  return row.id;
}

const list = () => asAnon((tx) => tx<Listed[]>`select * from public.published_essays()`);
const one = (slug: string) => asAnon((tx) => tx<One[]>`select * from public.published_essay(${slug})`);

describe('published essays for the website', () => {
  let published = '';

  beforeAll(async () => {
    await admin`delete from auth.users where email in (${OWNER}, ${OTHER})`;
    owner = await createUser(OWNER);
    other = await createUser(OTHER);
    published = await essay(owner, 'money-odd-good-out', {
      body: 'The published words.\n',
      stage: 'seedling',
      at: '2026-10-12T10:00:00Z',
    });
    await essay(owner, 'later-essay', { body: 'Later words.\n', stage: 'budding', at: '2026-10-13T10:00:00Z' });
    await essay(owner, 'never-published', null);
    // A snapshot whose stage is draft is never served, however it got there.
    await essay(owner, 'draft-stage', { body: 'Draft words.\n', stage: 'draft', at: '2026-10-12T11:00:00Z' });
    await essay(other, 'someone-elses', { body: 'Not the owner.\n', stage: 'seedling', at: '2026-10-12T12:00:00Z' });
  });

  afterAll(async () => {
    await admin`delete from auth.users where id in (${owner}, ${other})`;
    await closeDb();
  });

  it('lists only the owner’s published essays, newest first, without bodies', async () => {
    const rows = await list();
    expect(rows.map((row) => row.slug)).toEqual(['later-essay', 'money-odd-good-out']);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['confidence', 'description', 'published_at', 'slug', 'stage', 'tags', 'title', 'updated_at'].sort(),
    );
  });

  it('returns a published essay by slug with its snapshot, never the draft', async () => {
    const [row] = await one('money-odd-good-out');
    expect(row.body).toBe('The published words.\n');
    expect(row.title).toBe('Title of money-odd-good-out');
    expect(JSON.stringify(row)).not.toContain('private draft');
    expect(Object.keys(row)).not.toContain('user_id');
  });

  it('returns nothing for an unpublished essay, a draft or another account’s essay', async () => {
    expect(await one('never-published')).toEqual([]);
    expect(await one('draft-stage')).toEqual([]);
    expect(await one('someone-elses')).toEqual([]);
    expect(await one('no-such-essay')).toEqual([]);
  });

  it('stops returning an essay once it is unpublished', async () => {
    await admin`
      update essays set published_body = null, published_title = null, published_description = null,
                        published_stage = null, published_at = null
      where id = ${published}`;
    expect(await one('money-odd-good-out')).toEqual([]);
    expect((await list()).map((row) => row.slug)).toEqual(['later-essay']);
  });

  it('gives anon no read of the essays table itself', async () => {
    await expect(asAnon((tx) => tx`select id from learn.essays limit 1`)).rejects.toThrow();
  });
});
