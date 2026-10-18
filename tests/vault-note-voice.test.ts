/**
 * Whose words each note is, against Postgres (plan #2413.3).
 *
 * obsidian.tag_voice_by_rule (supabase/migrations-vault/0038) tags the notes a
 * folder or credential rule decides; obsidian.voice_due_notes hands the rest
 * to the model and never a credential note; core.memory_sources
 * (migrations-you/0011) leaves secret notes out of memory search; and
 * obsidian.position_voices says whether a position stands only on writing for
 * an audience.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-vault';

let userA = '';
let userB = '';
let connectionA = '';
let connectionB = '';
const ids: Record<string, string> = {};

const PROSE = 'A paragraph long enough to count as prose, about how cities price their parking.';

async function note(userId: string, connectionId: string, path: string, body = PROSE, frontmatter = {}) {
  const title = path.replace(/^.*\//, '').replace(/\.md$/, '');
  const [row] = await admin<{ id: string }[]>`
    insert into notes (user_id, connection_id, path, title, body, frontmatter, blob_sha, size_bytes, git_updated_at)
    values (${userId}, ${connectionId}, ${path}, ${title}, ${body}, ${admin.json(frontmatter)},
            ${`sha-${path}`}, ${body.length}, now())
    returning id`;
  ids[path] = row.id;
  return row.id;
}

async function voices(userId: string): Promise<Record<string, string | null>> {
  const rows = await admin<{ path: string; voice: string | null }[]>`
    select path, voice::text from notes where user_id = ${userId}`;
  return Object.fromEntries(rows.map((r) => [r.path, r.voice]));
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('voice-a@example.com');
  userB = await createUser('voice-b@example.com');
  [{ id: connectionA }] = await admin<{ id: string }[]>`
    insert into vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userA}, 'a', 'a-vault', 'main', 'encrypted') returning id`;
  [{ id: connectionB }] = await admin<{ id: string }[]>`
    insert into vault_connections (user_id, repo_owner, repo_name, branch, access_token)
    values (${userB}, 'b', 'b-vault', 'main', 'encrypted') returning id`;

  await note(userA, connectionA, 'Me/Passwords.md', 'Bank and email, see below.');
  await note(userA, connectionA, 'Pending/Side project.md', `${PROSE}\n\nKEY=sk-ant-api03-${'Ab1'.repeat(12)}`);
  await note(userA, connectionA, 'Pending/Login.md', `${PROSE}\npassword: hunter2`);
  await note(userA, connectionA, 'Bulk/Bulk - Wiki/OpenAI.md');
  await note(userA, connectionA, 'Bulk/Resources/Books/Antifragile.md');
  await note(userA, connectionA, 'Career/Job Applications/Stripe.md');
  await note(userA, connectionA, 'Pending/Plaid Cover Letter.md');
  await note(userA, connectionA, 'Pending/Edra.md', PROSE, { tags: ['career', 'application'] });
  await note(userA, connectionA, 'Yale/Course Summaries/MGT 401.md');
  await note(userA, connectionA, 'Bulk/Mini-Essays.md');
  await note(userA, connectionA, 'Me/Journal.md');
  await note(userA, connectionA, 'Me/Empty.md', 'ok');
  await note(userB, connectionB, 'Me/Passwords.md', 'theirs');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('note voice (plan #2413.3)', () => {
  it('tags by rule only the account it is given, and leaves the rest for the model', async () => {
    const [{ n }] = await admin<{ n: number }[]>`select tag_voice_by_rule(${userA}::uuid) as n`;
    expect(n).toBe(10);
    expect(await voices(userA)).toEqual({
      'Me/Passwords.md': 'secret',
      'Pending/Side project.md': 'secret',
      'Pending/Login.md': 'secret',
      'Bulk/Bulk - Wiki/OpenAI.md': 'clipped',
      'Bulk/Resources/Books/Antifragile.md': 'clipped',
      'Career/Job Applications/Stripe.md': 'audience',
      'Pending/Plaid Cover Letter.md': 'audience',
      'Pending/Edra.md': 'audience',
      'Yale/Course Summaries/MGT 401.md': 'reference',
      'Bulk/Mini-Essays.md': null,
      'Me/Journal.md': null,
      'Me/Empty.md': 'private',
    });
    expect((await voices(userB))['Me/Passwords.md']).toBeNull();

    const due = await admin<{ path: string }[]>`select path from voice_due_notes(${userA}::uuid, null, 50)`;
    expect(due.map((d) => d.path).sort()).toEqual(['Bulk/Mini-Essays.md', 'Me/Journal.md']);
  });

  it('does not move updated_at, and makes a note due again when it moves', async () => {
    const [before] = await admin<{ updated_at: Date; voice_due: boolean }[]>`
      select updated_at, voice_due from notes where id = ${ids['Bulk/Bulk - Wiki/OpenAI.md']}`;
    expect(before.voice_due).toBe(false);
    await admin`update notes set voice = 'private', voice_reason = 'x', voice_by = 'model'
                where id = ${ids['Bulk/Bulk - Wiki/OpenAI.md']}`;
    const [after] = await admin<{ updated_at: Date }[]>`
      select updated_at from notes where id = ${ids['Bulk/Bulk - Wiki/OpenAI.md']}`;
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());

    await admin`update notes set path = 'Me/OpenAI.md' where id = ${ids['Bulk/Bulk - Wiki/OpenAI.md']}`;
    const [moved] = await admin<{ voice_due: boolean }[]>`
      select voice_due from notes where id = ${ids['Bulk/Bulk - Wiki/OpenAI.md']}`;
    expect(moved.voice_due).toBe(true);
  });

  it('leaves secret notes out of memory search and the readable notes, tagged or not', async () => {
    const memory = await admin<{ source_ref: string }[]>`
      select source_ref from core.memory_sources(${userA}::uuid) where source_table = 'obsidian.notes'`;
    const refs = memory.map((m) => m.source_ref);
    expect(refs).toContain('Me/Journal.md');
    expect(refs).not.toContain('Pending/Side project.md');
    expect(refs).not.toContain('Pending/Login.md');

    // Not yet tagged: caught by the credential rule all the same.
    const theirs = await admin<{ source_ref: string }[]>`
      select source_ref from core.memory_sources(${userB}::uuid) where source_table = 'obsidian.notes'`;
    expect(theirs).toEqual([]);
    const readable = await admin<{ path: string }[]>`select path from readable_notes where user_id = ${userB}`;
    expect(readable).toEqual([]);
  });

  it('says when a position stands only on writing for an audience', async () => {
    const position = async (name: string) => {
      const [row] = await admin<{ id: string }[]>`
        insert into positions (user_id, name, statement, basis, kind, stance)
        values (${userA}, ${name}, ${`${name}.`}, 'Stated.', 'claim', 'held') returning id`;
      return row.id;
    };
    const source = (positionId: string, path: string) =>
      admin`insert into position_sources (user_id, position_id, note_id, quote, blob_sha)
            values (${userA}, ${positionId}, ${ids[path]}, 'A quote.', 'sha')`;
    const argued = await position('Argued');
    await source(argued, 'Career/Job Applications/Stripe.md');
    await source(argued, 'Pending/Plaid Cover Letter.md');
    const held = await position('Held');
    await source(held, 'Pending/Plaid Cover Letter.md');
    await source(held, 'Me/Journal.md');

    const rows = await admin<{ position_id: string; audience_notes: number; only_for_audience: boolean }[]>`
      select position_id, audience_notes, only_for_audience from position_voices where user_id = ${userA}`;
    const by = Object.fromEntries(rows.map((r) => [r.position_id, r]));
    expect(by[argued]).toMatchObject({ audience_notes: 2, only_for_audience: true });
    expect(by[held]).toMatchObject({ audience_notes: 1, only_for_audience: false });
  });
});
