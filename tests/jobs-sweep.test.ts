/**
 * The nightly sweep's rules, and the columns they name.
 *
 * Rule 2 -- "a completed interview with no debrief" -- stopped producing
 * anything the day 0011_merge_interview_debrief dropped `interviews.debrief`
 * and `interviews.went_well` in favour of `notes`. The query still asked for
 * both, PostgREST refused it for naming columns that were not there, and the
 * caller destructured only `data`, so the failure arrived as an empty list and
 * the sweep reported nothing to do. Nobody was nagged to write up an interview
 * for months and no log said why.
 *
 * Two kinds of assertion follow from that, and both are here:
 *
 *   1. The rules produce what they should from a given day's rows, and a query
 *      that fails is reported rather than counted as "nothing to do".
 *   2. Every column the sweep names actually exists in the schema. That is the
 *      half a unit test cannot see -- the rules were self-consistent the whole
 *      time; it was the database that had moved -- so it is checked against the
 *      real one, and skipped when there isn't one.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { fakeSupabase, type Row } from './helpers/fake-supabase';
import { admin, APP_SCHEMA, closeDb } from './helpers/db-jobs';
import { sweepWith, type SweepSummary } from '@/inngest/jobs/cron/sweep';
import type { createServiceSupabase } from '@/inngest/jobs/supabase-admin';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.now();
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

/**
 * One plausible night's data, chosen so that every query in the sweep runs --
 * a rule whose read is never reached cannot have its columns checked below.
 */
function fixture(): Record<string, Row[]> {
  return {
    applications: [
      {
        id: 'app-silent',
        user_id: 'user-1',
        status: 'submitted',
        submitted_at: at(-20 * DAY_MS),
        first_human_response_at: null,
        created_at: at(-20 * DAY_MS),
        roles: { title: 'Analyst', companies: { name: 'Acme' } },
      },
      {
        id: 'app-cold',
        user_id: 'user-1',
        status: 'lead',
        submitted_at: null,
        first_human_response_at: null,
        created_at: at(-200 * DAY_MS),
        profiles: { ghost_threshold_days: 30 },
      },
      {
        id: 'app-recent-lead',
        user_id: 'user-1',
        status: 'lead',
        submitted_at: null,
        first_human_response_at: null,
        created_at: at(-5 * DAY_MS),
        profiles: { ghost_threshold_days: 30 },
      },
    ],
    application_events: [
      { application_id: 'app-recent-lead', kind: 'note', occurred_at: at(-5 * DAY_MS) },
    ],
    interviews: [
      // Last night, not written up: the reminder this file exists for.
      {
        id: 'interview-fresh',
        user_id: 'user-1',
        application_id: 'app-silent',
        scheduled_at: at(-12 * HOUR_MS),
        kind: 'hiring_manager',
        notes: null,
        prep_notes: 'read the JD',
      },
      // Same evening, already written up.
      {
        id: 'interview-written',
        user_id: 'user-1',
        application_id: 'app-silent',
        scheduled_at: at(-13 * HOUR_MS),
        kind: 'technical',
        notes: 'went long, they liked the migration story',
        prep_notes: 'read the JD',
      },
      // Ten days ago and still blank: stale, not "write it up tonight".
      {
        id: 'interview-stale',
        user_id: 'user-1',
        application_id: 'app-silent',
        scheduled_at: at(-10 * DAY_MS),
        kind: 'recruiter_screen',
        notes: null,
        prep_notes: 'read the JD',
      },
      // Tomorrow, with nothing written down for it.
      {
        id: 'interview-soon',
        user_id: 'user-1',
        application_id: 'app-silent',
        scheduled_at: at(DAY_MS),
        kind: 'onsite',
        notes: null,
        prep_notes: null,
        applications: { roles: { title: 'Analyst', companies: { name: 'Acme' } } },
      },
    ],
  };
}

function ruleKeys(inserted: Array<{ table: string; row: Row }>): string[] {
  return inserted
    .filter((write) => write.table === 'reminders')
    .map((write) => write.row.rule_key as string)
    .sort();
}

/** Run the sweep against in-memory rows. */
async function sweep(options: Parameters<typeof fakeSupabase>[0] = {}) {
  const fake = fakeSupabase({ tables: fixture(), ...options });
  const summary: SweepSummary = await sweepWith(
    fake.client as ReturnType<typeof createServiceSupabase>,
  );
  return { summary, fake };
}

describe('the reminder rules', () => {
  it('asks for a debrief on the interview that has not been written up', async () => {
    const { fake } = await sweep();

    // Not interview-written (it has notes), and not interview-stale (ten days
    // ago is an old interview, not tonight's homework).
    expect(ruleKeys(fake.inserted)).toContain('debrief:interview-fresh');
    expect(ruleKeys(fake.inserted)).not.toContain('debrief:interview-written');
    expect(ruleKeys(fake.inserted)).not.toContain('debrief:interview-stale');
  });

  it('produces one reminder per rule on a day that has one of each', async () => {
    const { summary, fake } = await sweep();

    expect(ruleKeys(fake.inserted)).toEqual([
      'debrief:interview-fresh',
      'follow_up:app-silent',
      'prep:interview-soon',
    ]);
    expect(summary.reminders).toBe(3);
    expect(summary.problems).toEqual([]);
  });

  it('closes the lead nobody took up, and leaves the recent one alone', async () => {
    const { summary, fake } = await sweep();

    const withdrawals = fake.inserted.filter((write) => write.table === 'application_events');
    expect(withdrawals.map((write) => write.row.application_id)).toEqual(['app-cold']);
    expect(summary.closedLeads).toBe(1);
  });

  it('decides the debrief from `notes`, the column that replaced the old pair', async () => {
    // The schema check below is only as good as the queries that reached it,
    // so the rule that broke is pinned by name: it must ask the interviews
    // table about `notes`, and must not have gone on asking for the two
    // columns 0011_merge_interview_debrief dropped.
    const { fake } = await sweep();
    const asked = fake.touched.filter((touch) => touch.table === 'interviews');

    expect(asked).toContainEqual({ table: 'interviews', column: 'notes' });
    expect(asked.map((touch) => touch.column)).not.toContain('debrief');
    expect(asked.map((touch) => touch.column)).not.toContain('went_well');
  });

  it('says so when a query fails, rather than reporting nothing to do', async () => {
    // What a filter on a dropped column looks like from here.
    const { summary, fake } = await sweep({
      failRead: (table) =>
        table === 'interviews'
          ? { message: 'column interviews.went_well does not exist', code: '42703' }
          : null,
    });

    expect(ruleKeys(fake.inserted)).toEqual(['follow_up:app-silent']);
    // The other rules still ran -- one bad filter does not cost the sweep --
    // but the failure is named, and named twice because two rules read that
    // table.
    expect(summary.problems).toHaveLength(2);
    expect(summary.problems.join('\n')).toContain('interviews.went_well does not exist');
    expect(summary.problems.join('\n')).toContain('awaiting a debrief');
  });

  it('does not call a reminder that already exists a problem', async () => {
    // Running the sweep twice in a day trips the unique index on
    // (user_id, rule_key) for everything the first run wrote. That is the
    // idempotency working, not a fault to report.
    const { summary } = await sweep({
      failWrite: (table) =>
        table === 'reminders'
          ? { message: 'duplicate key value violates unique constraint', code: '23505' }
          : null,
    });

    expect(summary.reminders).toBe(0);
    expect(summary.problems).toEqual([]);
  });

  it('does report a write that failed for any other reason', async () => {
    const { summary } = await sweep({
      failWrite: (table) =>
        table === 'reminders' ? { message: 'permission denied', code: '42501' } : null,
    });

    expect(summary.reminders).toBe(0);
    expect(summary.problems).toHaveLength(3);
    expect(summary.problems.join('\n')).toContain('permission denied');
  });
});

/**
 * Detected with a top-level await rather than in a hook: `describe.runIf` is
 * evaluated during collection, before any hook has run, so a flag set in
 * beforeAll is always false and the whole suite skips silently.
 */
const databasePresent = await (async () => {
  try {
    await admin`select 1`;
    return true;
  } catch {
    return false;
  }
})();

afterAll(async () => {
  if (databasePresent) await closeDb();
});

describe.runIf(databasePresent)('the columns the sweep names', () => {
  it('all exist in the schema it queries', async () => {
    const { fake } = await sweep();

    const columns = await admin<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = ${APP_SCHEMA}`;
    const present = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));

    // If this fails, a migration has moved something the sweep still asks for,
    // and that rule is producing nothing in production right now. Fix the
    // query; do not delete the assertion.
    const missing = [
      ...new Set(fake.touched.map((touch) => `${touch.table}.${touch.column}`)),
    ].filter((column) => !present.has(column));

    expect(missing).toEqual([]);
  });

});
