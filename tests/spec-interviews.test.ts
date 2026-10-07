/**
 * Interviews for a workspace's spec (supabase/migrations/0181, plan #1638),
 * against the database.
 *
 * Done when an interview can be started, read back with its questions and
 * answers in order, and resumed, by its owner only. The questions and answers
 * are the thread under the row, written with core.add_thread_turn.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';
import { interviewExchanges, interviewRef } from '@/lib/specs/interviews';
import type { DevComment } from '@/lib/comments/load';

let userId = '';
let otherId = '';
let interviewId = '';

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('spec-interview@example.com');
  otherId = await createUser('spec-interview-other@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

async function thread(asId: string, id: string): Promise<DevComment[]> {
  const rows = await asUser(asId, (tx) => tx<{ id: string; author: string; body: string; created_at: Date }[]>`
    select id, author, body, created_at from core.thread_turns
    where ref = ${interviewRef(id)} order by created_at, id`);
  return rows.map((r) => ({
    id: r.id,
    author: r.author === 'claude' ? 'claude' : 'me',
    body: r.body,
    createdAt: r.created_at.toISOString(),
  }));
}

describe('a spec interview', () => {
  it('is started by its owner, with twelve questions unless set otherwise', async () => {
    const [row] = await asUser(userId, (tx) => tx<{ id: string; status: string; question_limit: number }[]>`
      insert into spec_interviews (user_id, module) values (${userId}, 'learn')
      returning id, status, question_limit`);
    interviewId = row.id;
    expect(row.status).toBe('open');
    expect(row.question_limit).toBe(12);
  });

  it('is read back with its questions and answers in order', async () => {
    const ref = interviewRef(interviewId);
    const turns: [string, string][] = [
      ['claude', 'What is Learn for?'],
      ['me', 'Reading papers and remembering them.'],
      ['claude', 'When do you open it?'],
      ['me', 'Most mornings.'],
    ];
    for (const [author, body] of turns) {
      await asUser(userId, (tx) => tx`select core.add_thread_turn(${userId}, ${ref}, ${author}, ${body})`);
    }
    const exchanges = interviewExchanges(await thread(userId, interviewId));
    expect(exchanges.map((e) => [e.question.body, e.answer?.body])).toEqual([
      ['What is Learn for?', 'Reading papers and remembering them.'],
      ['When do you open it?', 'Most mornings.'],
    ]);
  });

  it('is resumed rather than started twice while open', async () => {
    await expect(
      asUser(userId, (tx) => tx`insert into spec_interviews (user_id, module) values (${userId}, 'learn')`),
    ).rejects.toThrow(/spec_interviews_one_open_uq/);
    const open = await asUser(userId, (tx) => tx<{ id: string }[]>`
      select id from spec_interviews where module = 'learn' and status = 'open'`);
    expect(open.map((r) => r.id)).toEqual([interviewId]);
  });

  it('is not visible or writable to anybody else', async () => {
    expect(await asUser(otherId, (tx) => tx`select id from spec_interviews`)).toHaveLength(0);
    expect(await thread(otherId, interviewId)).toHaveLength(0);
    const changed = await asUser(otherId, (tx) => tx`
      update spec_interviews set status = 'abandoned', finished_at = now() where id = ${interviewId}
      returning id`);
    expect(changed).toHaveLength(0);
    await expect(
      asUser(otherId, (tx) => tx`insert into spec_interviews (user_id, module) values (${userId}, 'jobs')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('finishes with a time, and then another can start', async () => {
    await expect(
      admin`update spec_interviews set status = 'drafted' where id = ${interviewId}`,
    ).rejects.toThrow(/spec_interviews_finished_ck/);
    await asUser(userId, (tx) => tx`
      update spec_interviews set status = 'drafted', finished_at = now(), summary = 'Reads papers in the mornings.'
      where id = ${interviewId}`);
    const [fresh] = await asUser(userId, (tx) => tx<{ id: string }[]>`
      insert into spec_interviews (user_id, module, question_limit) values (${userId}, 'learn', 5) returning id`);
    expect(fresh.id).not.toBe(interviewId);
  });
});
