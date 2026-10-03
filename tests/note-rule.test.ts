/**
 * A request filed on three pages becomes one proposed rule (plan #1526,
 * docs/SPEC-LAYER-SPEC.md part 5), against the database.
 *
 * Done when three similar notes on different pages in a fixture produce one
 * missing_rule finding and one drafted change, and a single note is still
 * fixed on its page. The statement is the one scripts/note-rule.ts prints for
 * the notes routine to run through the connector.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db';
import { checkRuleRequest, noteRuleSql, type RuleNote } from '@/lib/specs/note-rules';

let userId = '';

const DIFF = [
  '--- a/docs/CORE-AND-DASH-SPEC.md',
  '+++ b/docs/CORE-AND-DASH-SPEC.md',
  '@@ -1,1 +1,2 @@',
  ' ## Rules',
  '+**R9.** Every delete asks first, in one dialog. Checked by: audit.',
].join('\n');

type Result = { change_id: string | null; finding_id: string; notes_linked: number };

async function file(page: string, body: string, status = 'open'): Promise<void> {
  await admin`
    insert into feedback_items (user_id, kind, body, page_path, status)
    values (${userId}, 'feature', ${body}, ${page}, ${status}::feedback_status)`;
}

async function notes(): Promise<RuleNote[]> {
  const rows = await admin`
    select id, kind::text, status::text, page_path, created_at, spec_change_id
    from feedback_items where user_id = ${userId} order by created_at`;
  return rows.map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    status: row.status as string,
    page_path: row.page_path as string | null,
    created_at: (row.created_at as Date).toISOString(),
    spec_change_id: row.spec_change_id as string | null,
  }));
}

async function propose(group: RuleNote[]): Promise<Result> {
  const sql = noteRuleSql({
    userId,
    spec: 'core-and-dash',
    section: 'Rules',
    finding: 'Three pages were asked to confirm before deleting.',
    sessionId: 'cse_test',
    notes: group,
    change: { title: 'Every delete asks first', why: 'Three notes on three pages asked for it.', diff: DIFF },
  });
  const [row] = (await admin.unsafe(sql)) as unknown as Result[];
  return row;
}

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('note-rule@example.com');
});

beforeEach(async () => {
  await admin`delete from spec_findings where user_id = ${userId}`;
  await admin`delete from feedback_items where user_id = ${userId}`;
  await admin`delete from spec_changes where user_id = ${userId}`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('notes asking for the same thing', () => {
  it('on three pages make one missing_rule finding and one change, with the notes linked', async () => {
    await file('/todo', 'Ask before deleting a task');
    await file('/jobs/roles', 'Confirm before I delete a role');
    await file('/vault?tab=notes', 'Deleting a note should ask first');

    const check = checkRuleRequest(await notes(), new Date());
    expect(check.ok).toBe(true);
    const result = await propose(check.notes);
    expect(result.change_id).not.toBeNull();
    expect(result.notes_linked).toBe(3);

    const changes = await admin`select id, status, made_by from spec_changes where user_id = ${userId}`;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ status: 'proposed', made_by: 'claude' });

    const findings = await admin`
      select kind, audit_id, spec, proposal, spec_change_id, evidence from spec_findings
      where user_id = ${userId}`;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'missing_rule',
      audit_id: null,
      spec: 'core-and-dash',
      proposal: 'change_spec',
      spec_change_id: result.change_id,
    });
    expect(findings[0].evidence).toContain('/jobs/roles');

    const linked = await admin`
      select status::text, spec_change_id, resolution_note from feedback_items where user_id = ${userId}`;
    for (const row of linked) {
      expect(row.status).toBe('planned');
      expect(row.spec_change_id).toBe(result.change_id);
      expect(row.resolution_note).toContain('Every delete asks first');
    }
  });

  it('on one page are not a rule, and the note stays in the queue for its page', async () => {
    await file('/todo', 'Ask before deleting a task');

    const check = checkRuleRequest(await notes(), new Date());
    expect(check.ok).toBe(false);

    const [row] = await admin`select status::text, spec_change_id from feedback_items where user_id = ${userId}`;
    expect(row).toMatchObject({ status: 'open', spec_change_id: null });
    const [{ count }] = await admin`select count(*)::int as count from spec_changes where user_id = ${userId}`;
    expect(count).toBe(0);
  });

  it('while five changes wait, file the finding with no change and leave the notes as they were', async () => {
    for (let i = 0; i < 5; i++) {
      await admin`
        insert into spec_changes (user_id, spec, title, why, diff)
        values (${userId}, 'core-and-dash', ${`Waiting ${i}`}, 'A reason.', ${DIFF})`;
    }
    await file('/todo', 'Ask before deleting a task');
    await file('/jobs', 'Confirm before I delete a role');
    await file('/vault', 'Deleting a note should ask first', 'done');

    const result = await propose(checkRuleRequest(await notes(), new Date()).notes);
    expect(result.change_id).toBeNull();
    expect(result.notes_linked).toBe(0);

    const [{ count }] = await admin`
      select count(*)::int as count from spec_changes where user_id = ${userId} and status = 'proposed'`;
    expect(count).toBe(5);
    const [finding] = await admin`select kind, spec_change_id from spec_findings where user_id = ${userId}`;
    expect(finding).toMatchObject({ kind: 'missing_rule', spec_change_id: null });
    const statuses = await admin`
      select status::text from feedback_items where user_id = ${userId} order by created_at`;
    expect(statuses.map((s) => s.status)).toEqual(['open', 'open', 'done']);
  });
});
