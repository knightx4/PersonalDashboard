/**
 * A like, the third kind of feedback (supabase/migrations/0106, plan #1101),
 * against the database.
 *
 * Done when a like can be stored and loaded: the person files one under their
 * own session, it reads back through the same shape the queue uses, and it
 * sorts after the bugs and feature requests beside it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';
import { FEEDBACK_COLUMNS, feedbackRowFrom, sortOutstanding } from '@/lib/feedback/load';

let userId = '';

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('feedback-like@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a like', () => {
  it('is stored under the person’s own session', async () => {
    const [row] = await asUser(userId, (tx) => tx<{ kind: string }[]>`
      insert into feedback_items (user_id, kind, body, page_path)
      values (${userId}, 'like', 'The plan page opening on what is next', '/dev/plan')
      returning kind`);
    expect(row.kind).toBe('like');
  });

  it('loads as a like and sorts after bugs and requests', async () => {
    await admin`
      insert into feedback_items (user_id, kind, body, created_at)
      values
        (${userId}, 'feature', 'A keyboard shortcut', now() + interval '1 minute'),
        (${userId}, 'bug', 'The total is wrong', now() + interval '2 minutes')`;

    const columns = FEEDBACK_COLUMNS.replace(/, thread:.*$/, '');
    const rows = await admin.unsafe(
      `select ${columns} from feedback_items where user_id = $1`,
      [userId],
    );
    const loaded = rows.map((row) => feedbackRowFrom({ ...row, thread: [] }));

    expect(sortOutstanding(loaded).map((row) => row.kind)).toEqual(['bug', 'feature', 'like']);
  });
});
