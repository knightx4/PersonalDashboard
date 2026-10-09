/**
 * The person's "Accept" on a design-check block, written where the close
 * guard reads it (`uiAcceptSql`, `npm run ui-guard -- <n> --accept`).
 *
 * #1702 was answered "Accept" and blocked again on the same question by the
 * next session, because the answer was words on the step and the guard reads
 * only `ui_checks`. Run against the test database, because the rule that
 * matters, writing nothing until the person has answered, lives in the SQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db';
import { uiAcceptSql } from '@/lib/plan/ui-check-guard';

let userId: string;
let step: number;

async function setComment(comment: string) {
  await admin`update plan_items set comment = ${comment} where number = ${step}`;
}

async function verdicts() {
  return admin<{ surface: string; round: number; verdict: string; notes: string | null }[]>`
    select surface, round, verdict, notes from ui_checks where step = ${step} order by surface, round`;
}

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('accept@example.com');
});

beforeEach(async () => {
  await admin`delete from ui_checks where user_id = ${userId}`;
  await admin`delete from plan_items where user_id = ${userId}`;
  const [row] = await admin<{ number: number }[]>`
    insert into plan_items (user_id, module, title, status)
    values (${userId}, 'dev', 'Give Dash a hat', 'blocked')
    returning number`;
  step = row.number;
  // One surface passed, one stopped on a fix, one never checked.
  await admin`
    insert into ui_checks (user_id, step, surface, round, verdict)
    values (${userId}, ${step}, 'dash-mark', 1, 'pass'),
           (${userId}, ${step}, 'shell-full', 1, 'fix')`;
});

afterAll(async () => {
  await closeDb();
});

describe('uiAcceptSql', () => {
  const surfaces = ['dash-mark', 'shell-full', 'home-page'];

  it('accepts every surface still waiting once the person has answered the block', async () => {
    await setComment('Blocked 2026-10-09: accept the pages?\n\nAnswered 2026-10-09: Accept');
    const written = await admin.unsafe(uiAcceptSql(step, surfaces));
    expect(written.map((r) => r.surface).sort()).toEqual(['home-page', 'shell-full']);

    const rows = await verdicts();
    expect(rows.find((r) => r.surface === 'shell-full')).toMatchObject({ round: 2, verdict: 'accepted' });
    expect(rows.find((r) => r.surface === 'home-page')).toMatchObject({ round: 1, verdict: 'accepted' });
    expect(rows.find((r) => r.surface === 'home-page')?.notes).toBe(
      'Accepted by you: Answered 2026-10-09: Accept',
    );
    // The passed surface is left as it was.
    expect(rows.filter((r) => r.surface === 'dash-mark')).toHaveLength(1);
  });

  it('writes nothing while the block has no answer', async () => {
    await setComment('Blocked 2026-10-09: accept the pages?');
    expect(await admin.unsafe(uiAcceptSql(step, surfaces))).toHaveLength(0);
  });

  it('writes nothing when the only answer is older than the block', async () => {
    await setComment(
      'Blocked 2026-10-08: which look?\n\nAnswered 2026-10-08: the cowboy hat\n\nBlocked 2026-10-09: accept the pages?',
    );
    expect(await admin.unsafe(uiAcceptSql(step, surfaces))).toHaveLength(0);
  });

  it('writes nothing a second time', async () => {
    await setComment('Blocked 2026-10-09: accept the pages?\n\nAnswered 2026-10-09: Accept');
    await admin.unsafe(uiAcceptSql(step, surfaces));
    expect(await admin.unsafe(uiAcceptSql(step, surfaces))).toHaveLength(0);
  });
});
