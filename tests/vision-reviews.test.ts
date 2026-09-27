/**
 * The weekly vision review's findings (supabase/migrations/0108, plan #1105),
 * against the database.
 *
 * Done when a proposed edit can be written and read back with its evidence.
 * Also checked: a "still holds" is its own row with no edit, a workspace has
 * one pending edit at most, and accepting an edit replaces the vision in the
 * same call that marks it accepted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';
import { visionReviewRow, withEvidence } from '@/lib/specs/vision-review';

let userId = '';
let otherId = '';
const reviewId = '6b1f4a52-4c8e-4f2e-9a57-0f8f5c1f2a01';

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('vision-review@example.com');
  otherId = await createUser('vision-review-other@example.com');
  await admin`
    insert into module_visions (user_id, module, body)
    values (${userId}, 'dev', 'Help make the website.')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

async function insert(row: ReturnType<typeof visionReviewRow>) {
  const [written] = await admin<{ id: string }[]>`
    insert into vision_reviews ${admin(row)} returning id`;
  return written.id;
}

describe('a proposed vision edit', () => {
  it('is written with its evidence and read back with it', async () => {
    const likes = await admin<{ id: string; created_at: string }[]>`
      insert into feedback_items (user_id, kind, body, page_path, created_at)
      values
        (${userId}, 'like', 'The plan page opening on what is next', '/dev/plan', now() - interval '2 days'),
        (${userId}, 'feature', 'Show me which specs changed this week', '/dev/specs', now() - interval '1 day')
      returning id, created_at`;
    const evidenceIds = [likes[1].id, likes[0].id, '00000000-0000-0000-0000-000000000000'];

    await insert(
      visionReviewRow(userId, {
        module: 'dev',
        reviewId,
        sessionId: 'cse_test',
        outcome: 'edit',
        visionBody: 'Help make the website.',
        proposedBody: 'Show what is next and what changed, so a session starts from the plan.',
        note: 'Two notes this week ask the dev pages to say what is next.',
        evidenceIds,
      }),
    );

    const rows = await asUser(userId, (tx) => tx`
      select id, module, review_id, session_id, outcome, vision_body, proposed_body, note,
             evidence_ids, status, decided_at, created_at
      from vision_reviews where module = 'dev'`);
    const evidence = await asUser(userId, (tx) => tx`
      select id, kind, body, page_path as "pagePath", created_at::text as "createdAt"
      from feedback_items where id = any(${evidenceIds}::uuid[])`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [review] = withEvidence(rows as any, evidence as any);

    expect(review.status).toBe('pending');
    expect(review.visionBody).toBe('Help make the website.');
    expect(review.evidenceIds).toEqual(evidenceIds);
    // The deleted id drops out; the rest come back oldest first.
    expect(review.evidence.map((item) => item.body)).toEqual([
      'The plan page opening on what is next',
      'Show me which specs changed this week',
    ]);
  });

  it('is one per workspace while pending', async () => {
    await expect(
      insert(
        visionReviewRow(userId, {
          module: 'dev',
          reviewId,
          outcome: 'edit',
          visionBody: 'Help make the website.',
          proposedBody: 'Something else.',
          note: 'A second edit.',
          evidenceIds: [],
        }),
      ),
    ).rejects.toThrow(/vision_reviews_one_pending_uq/);
  });

  it('is not visible to anybody else', async () => {
    const rows = await asUser(otherId, (tx) => tx`select id from vision_reviews`);
    expect(rows).toHaveLength(0);
  });

  it('replaces the vision when accepted, in the same call', async () => {
    const [pending] = await admin<{ id: string }[]>`
      select id from vision_reviews where user_id = ${userId} and status = 'pending'`;
    await asUser(userId, (tx) => tx`select decide_vision_edit(${pending.id}, true)`);

    const [vision] = await admin<{ body: string }[]>`
      select body from module_visions where user_id = ${userId} and module = 'dev'`;
    const [edit] = await admin<{ status: string; decided_at: Date | null }[]>`
      select status, decided_at from vision_reviews where id = ${pending.id}`;
    expect(vision.body).toBe('Show what is next and what changed, so a session starts from the plan.');
    expect(edit.status).toBe('accepted');
    expect(edit.decided_at).not.toBeNull();

    await expect(
      asUser(userId, (tx) => tx`select decide_vision_edit(${pending.id}, false)`),
    ).rejects.toThrow(/No pending vision edit/);
  });
});

describe('a "still holds"', () => {
  it('is a dated note with no edit and no status', async () => {
    await asUser(userId, (tx) => tx`
      insert into vision_reviews ${tx(
        visionReviewRow(userId, {
          module: 'learn',
          reviewId,
          outcome: 'holds',
          visionBody: null,
          note: 'Still holds: every note this week was about the courses it names.',
        }),
      )}`);
    const [row] = await admin<{ status: string | null; proposed_body: string | null; created_at: Date }[]>`
      select status, proposed_body, created_at from vision_reviews
      where user_id = ${userId} and module = 'learn'`;
    expect(row.status).toBeNull();
    expect(row.proposed_body).toBeNull();
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('cannot carry an edit', async () => {
    await expect(admin`
      insert into vision_reviews (user_id, module, review_id, outcome, note, proposed_body)
      values (${userId}, 'learn', ${reviewId}, 'holds', 'Holds.', 'But also this.')`,
    ).rejects.toThrow(/vision_reviews_outcome_shape_ck/);
  });
});
