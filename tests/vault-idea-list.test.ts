/**
 * The Map's ranked list of ideas against Postgres (plan #2947.5).
 *
 * position_scores.combined is the generated column the list sorts on
 * (supabase/migrations-vault/0047): round(sqrt(usefulness x novelty)), at
 * least 1, null where the scores are. obsidian.idea_list reads a page of the
 * signed-in person's own ideas and designs of kind 'position', and
 * obsidian.idea_list_counts what it leaves out.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-vault';

let userA = '';
let userB = '';
let connectionA = '';

async function connection(userId: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userId}, 'me', 'vault', 'main', 'x')
    returning id`;
  return row.id;
}

async function idea(
  userId: string,
  name: string,
  opts: { kind?: string; stance?: string; note?: string } = {},
): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    insert into positions (user_id, name, statement, basis, kind, stance)
    values (${userId}, ${name}, ${`${name}, stated.`}, 'Stated in the note.',
            ${opts.kind ?? 'position'}, ${opts.stance ?? 'held'})
    returning id`;
  if (opts.note) {
    const [note] = await admin<{ id: string }[]>`
      insert into notes (user_id, connection_id, path, title, body, blob_sha, voice, voice_by, voice_reason)
      values (${userId}, ${connectionA}, ${`${opts.note}.md`}, ${opts.note}, 'body', ${`sha-${name}`}, 'private', 'rule', 'test')
      returning id`;
    await admin`
      insert into position_sources (user_id, position_id, note_id, quote, blob_sha)
      values (${userId}, ${row.id}, ${note.id}, ${`${name} quote`}, ${`sha-${name}`})`;
  }
  return row.id;
}

async function score(
  userId: string,
  positionId: string,
  type: string,
  usefulness: number | null,
  novelty: number | null,
) {
  await admin`
    insert into position_scores (user_id, position_id, idea_type, usefulness, novelty,
                                 model, rubric_version, input_hash)
    values (${userId}, ${positionId}, ${type}, ${usefulness}, ${novelty}, 'jev', 'test', 'hash')`;
}

async function combined(positionId: string): Promise<number | null> {
  const [row] = await admin<{ combined: number | null }[]>`
    select combined from position_scores where position_id = ${positionId}`;
  return row.combined;
}

beforeAll(async () => {
  userA = await createUser('idea-list-a@example.com');
  userB = await createUser('idea-list-b@example.com');
  connectionA = await connection(userA);
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('position_scores.combined (plan #2947.5)', () => {
  it('is round(sqrt(u x n)), at least 1, and null without scores', async () => {
    const top = await idea(userA, 'Top');
    const mid = await idea(userA, 'Mid');
    const zero = await idea(userA, 'Zero');
    const req = await idea(userA, 'Req');
    await score(userA, top, 'own_idea', 100, 100);
    await score(userA, mid, 'own_idea', 81, 36);
    await score(userA, zero, 'project_design', 0, 70);
    await score(userA, req, 'requirement', null, null);

    expect(await combined(top)).toBe(100);
    expect(await combined(mid)).toBe(54);
    expect(await combined(zero)).toBe(1);
    expect(await combined(req)).toBeNull();
  });
});

describe('idea_list and idea_list_counts (plan #2947.5)', () => {
  it('lists only your scored positions, sorted on the chosen score, and counts the rest', async () => {
    // From the test above: Top 100/100, Mid 81/36, Zero 0/70 listed; Req left out.
    const useful = await idea(userA, 'Useful', { note: 'Useful note' });
    await score(userA, useful, 'own_idea', 90, 10); // combined 30
    const others = await idea(userA, 'Others');
    await score(userA, others, 'others_idea', null, null);
    // A claim with a score row, and a dropped idea: neither is listed.
    const claim = await idea(userA, 'Claim', { kind: 'claim' });
    await score(userA, claim, 'own_idea', 99, 99);
    const dropped = await idea(userA, 'Dropped', { stance: 'encountered' });
    await score(userA, dropped, 'own_idea', 99, 99);
    // Waiting for a score: an eligible note and no row.
    await idea(userA, 'Waiting', { note: 'Waiting note' });
    // Someone else's idea.
    const theirs = await idea(userB, 'Theirs');
    await score(userB, theirs, 'own_idea', 100, 100);

    const names = async (sort: string) =>
      asUser(userA, async (tx) => {
        const rows = await tx<{ statement: string; total: string }[]>`
          select statement, total from idea_list(${sort}, 0, 50)`;
        return rows.map((r) => r.statement.replace(', stated.', ''));
      });

    expect(await names('combined')).toEqual(['Top', 'Mid', 'Useful', 'Zero']);
    expect(await names('usefulness')).toEqual(['Top', 'Useful', 'Mid', 'Zero']);
    expect(await names('novelty')).toEqual(['Top', 'Zero', 'Mid', 'Useful']);

    const page = await asUser(userA, (tx) => tx<{ statement: string; total: string; quote: string | null; note_path: string | null }[]>`
      select statement, total, quote, note_path from idea_list('combined', 2, 1)`);
    expect(page).toHaveLength(1);
    expect(page[0].statement).toBe('Useful, stated.');
    expect(Number(page[0].total)).toBe(4);
    expect(page[0].quote).toBe('Useful quote');
    expect(page[0].note_path).toBe('Useful note.md');

    const [counts] = await asUser(userA, (tx) => tx`select * from idea_list_counts()`);
    expect(counts).toEqual({ listed: 4, requirements: 1, others_ideas: 1, descriptions: 0, unscored: 1 });
  });
});
