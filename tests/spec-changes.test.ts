/**
 * Spec changes and the findings behind them (supabase/migrations/0155, plan
 * #1505), against the database.
 *
 * Done when both tables take their rows, a diff over 60 changed lines is
 * refused on insert, and nobody else can see them. Also checked: the count in
 * the database agrees with countChangedLines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';
import { countChangedLines } from '@/lib/specs/changes';

let userId = '';
let otherId = '';

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('spec-changes@example.com');
  otherId = await createUser('spec-changes-other@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

function diffOf(added: number, removed = 0): string {
  return [
    '--- a/docs/SPEC-LAYER-SPEC.md',
    '+++ b/docs/SPEC-LAYER-SPEC.md',
    `@@ -1,${removed + 1} +1,${added + 1} @@`,
    ' ## Rules',
    ...Array.from({ length: removed }, (_, i) => `-old line ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new line ${i}`),
  ].join('\n');
}

function insertChange(diff: string) {
  return asUser(userId, (tx) => tx<{ id: string; status: string; made_by: string }[]>`
    insert into spec_changes (user_id, spec, title, why, diff)
    values (${userId}, 'spec-layer', 'Every spec names its counts', 'Three notes ask for it.', ${diff})
    returning id, status, made_by`);
}

describe('a spec change', () => {
  it('is written as proposed by Dash, with its finding pointing at it', async () => {
    const [change] = await insertChange(diffOf(40, 20));
    expect(change.status).toBe('proposed');
    expect(change.made_by).toBe('claude');

    await asUser(userId, (tx) => tx`
      insert into spec_findings (user_id, spec, section, kind, finding, evidence, proposal, spec_change_id)
      values (${userId}, 'spec-layer', 'rules', 'missing_rule', 'Three notes ask for the same rule.',
              'feedback_items 1, 2, 3', 'change_spec', ${change.id})`);
    const findings = await asUser(userId, (tx) => tx`
      select kind from spec_findings where spec_change_id = ${change.id}`);
    expect(findings).toHaveLength(1);
  });

  it('is refused over 60 changed lines', async () => {
    await expect(insertChange(diffOf(31, 30))).rejects.toThrow(/spec_changes_diff_size_ck/);
  });

  it('is refused when it changes nothing', async () => {
    await expect(insertChange(diffOf(0))).rejects.toThrow(/spec_changes_diff_size_ck/);
  });

  it('counts a diff the same way in the database and in the code', async () => {
    const diffs = [diffOf(3, 2), `${diffOf(1)}\n${diffOf(2, 1)}`, '+no hunk', 'diff --git a b\n@@ x\n--- a rule\n+-- a rule'];
    for (const diff of diffs) {
      const [row] = await admin<{ n: number }[]>`select spec_diff_changed_lines(${diff}) as n`;
      expect(row.n).toBe(countChangedLines(diff));
    }
  });

  it('records when it was decided, and refuses a decision without one', async () => {
    const [change] = await insertChange(diffOf(1));
    await expect(
      asUser(userId, (tx) => tx`update spec_changes set status = 'approved' where id = ${change.id}`),
    ).rejects.toThrow(/spec_changes_decided_ck/);
    await asUser(userId, (tx) => tx`
      update spec_changes set status = 'declined', decided_at = now() where id = ${change.id}`);
  });

  it("keeps one audit's findings together by its audit_id (0162)", async () => {
    const [audit] = await admin<{ id: string }[]>`select gen_random_uuid() as id`;
    await asUser(userId, (tx) => tx`
      insert into spec_findings (user_id, audit_id, spec, kind, finding)
      values (${userId}, ${audit.id}, 'plan', 'holds', 'The tree matches.'),
             (${userId}, ${audit.id}, 'todo', 'drifted', 'A rule names the wrong guard.')`);
    const rows = await asUser(userId, (tx) => tx<{ spec: string }[]>`
      select spec from spec_findings where audit_id = ${audit.id} order by spec`);
    expect(rows.map((row) => row.spec)).toEqual(['plan', 'todo']);
  });

  it('is not visible to anybody else', async () => {
    const changes = await asUser(otherId, (tx) => tx`select id from spec_changes`);
    const findings = await asUser(otherId, (tx) => tx`select id from spec_findings`);
    expect(changes).toHaveLength(0);
    expect(findings).toHaveLength(0);
  });
});
