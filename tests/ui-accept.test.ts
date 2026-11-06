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
import { uiAcceptSql, uiGuardSql, uiSettleSql } from '@/lib/plan/ui-check-guard';

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
  await admin`delete from plan_dependencies where user_id = ${userId}`;
  await admin`delete from plan_item_mockups where user_id = ${userId}`;
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
    // Numbered on from the fix it stopped on.
    expect(rows.filter((r) => r.surface === 'shell-full').map((r) => [r.round, r.verdict])).toEqual([
      [1, 'fix'],
      [2, 'accepted'],
    ]);
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

/** A round that still cites the mockup on `surface` (plan #2966.4). */
async function heldRound(surface: string, round: number) {
  const fixes = [
    { shot: 'laptop-light', where: 'the list', problem: 'Not the mockup', breaks: 'reference', change: 'Match it' },
  ];
  await admin`
    insert into ui_checks (user_id, step, surface, round, verdict, fixes)
    values (${userId}, ${step}, ${surface}, ${round}, 'fix', ${admin.json(fixes)})`;
}

/** A decision with mockup pictures the step waits on, answered now. */
async function answeredDecision(answer: string, pictures = true) {
  const [stepRow] = await admin<{ id: string }[]>`select id from plan_items where number = ${step}`;
  const [d] = await admin<{ id: string }[]>`
    insert into plan_items (user_id, module, title, kind, status)
    values (${userId}, 'dev', 'Keep /dash as built, or change it to match the mockup?', 'decision', 'not_started')
    returning id`;
  await admin`insert into plan_dependencies (user_id, item_id, depends_on_id) values (${userId}, ${stepRow.id}, ${d.id})`;
  if (pictures) {
    await admin`
      insert into plan_item_mockups (user_id, item_id, option_letter, width, storage_path)
      values (${userId}, ${d.id}, 'A', 390, 'u/a-390.png')`;
  }
  await admin`update plan_items set status = 'done', resolution = ${answer} where id = ${d.id}`;
}

describe('a screen held for the person (plan #2966.4)', () => {
  const surfaces = ['dash-mark', 'shell-full'];

  it('is never settled, while a fix of another kind is', async () => {
    await heldRound('dash-mark', 2);
    await admin`update ui_checks set round = 3 where step = ${step} and surface = 'shell-full'`;
    const written = await admin.unsafe(uiSettleSql(step, surfaces, 'stopped at round 3'));
    expect(written.map((r) => r.surface)).toEqual(['shell-full']);
  });

  it('stays in the guard past a settle written some other way', async () => {
    await heldRound('dash-mark', 2);
    await admin`
      insert into ui_checks (user_id, step, surface, round, verdict, notes)
      values (${userId}, ${step}, 'dash-mark', 3, 'accepted', 'Settled by Dash: by hand')`;
    const rows = await admin.unsafe(uiGuardSql(step, surfaces));
    expect(rows.map((r) => r.surface).sort()).toEqual(['dash-mark', 'shell-full']);
  });

  it('is accepted on the answer to the question with its pictures, and then passes', async () => {
    await heldRound('dash-mark', 2);
    await setComment('Blocked 2026-11-05: Which of the options on the question?');
    expect(await admin.unsafe(uiAcceptSql(step, ['dash-mark']))).toHaveLength(0);
    await answeredDecision('A, keep it');
    const written = await admin.unsafe(uiAcceptSql(step, ['dash-mark']));
    expect(written.map((r) => [r.surface, r.round])).toEqual([['dash-mark', 3]]);
    const rows = await verdicts();
    expect(rows.find((r) => r.surface === 'dash-mark' && r.round === 3)?.notes).toMatch(
      /^Accepted by you: Answered on #\d+: A, keep it$/,
    );
    expect(await admin.unsafe(uiGuardSql(step, ['dash-mark']))).toHaveLength(0);
  });

  it('does not take an answered question without pictures', async () => {
    await heldRound('dash-mark', 2);
    await setComment('Blocked 2026-11-05: Which?');
    await answeredDecision('A', false);
    expect(await admin.unsafe(uiAcceptSql(step, ['dash-mark']))).toHaveLength(0);
  });
});
