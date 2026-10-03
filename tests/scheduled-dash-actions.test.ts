/**
 * What scheduled runs change is recorded as Dash's (plan #1570, feature
 * #1456): every cron route that writes the person's rows leaves one
 * core.dash_actions row with surface `scheduled` per write, which Home lists
 * with an Undo.
 *
 * One block per route, through the function the route reaches that makes the
 * write, over the in-memory tables of tests/stubs/fake-schema-db.ts:
 *
 *   /api/cron/jobs-sweep and the daily cron's jobs-sweep stage
 *   /api/cron/watches
 *   /api/cron/jd-backfill and the daily cron's jd-backfill stage
 *   /api/cron/daily: the claim sweep, the night digest's ideas and the
 *   morning goals run's held steps
 */
import { describe, expect, it, vi } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { undoDashAction } from '@/lib/core/dash-actions';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';

vi.mock('@/lib/jobs/jd/lookup', () => ({
  resolveBoard: vi.fn(async () => ({ ok: true, board: { vendor: 'greenhouse' } })),
  noteRoles: vi.fn(async () => undefined),
  applyBoardToRole: vi.fn(),
}));

const { closeColdLeads, generateReminders } = await import('@/inngest/jobs/cron/sweep');
const { watchPorts } = await import('@/inngest/core/watches');
const { backfillCompany } = await import('@/inngest/jobs/cron/jd-backfill');
const { applyBoardToRole } = await import('@/lib/jobs/jd/lookup');
const { releaseStaleClaims } = await import('@/inngest/dev/claims');
const { fileNightIdeas } = await import('@/lib/ideas/file');
const { holdActingSteps } = await import('@/lib/goals/hold-acts-store');

const USER = '11111111-1111-4111-8111-111111111111';
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

/**
 * A service client over the fake tables: `from` in its own schema, `schema`
 * for the others (where the record and the before read go), and the one rpc
 * a route here calls.
 */
function serviceClient(tables: FakeTables, schema: string): SchemaClient {
  const db = fakeSchemaDb(tables);
  const make = (name: string) =>
    ({
      from: (table: string) => db(name).from(table),
      schema: (other: string) => make(other),
      rpc: async (fn: string, args: Row) => {
        if (fn !== 'hold_acting_step') return { data: null, error: { message: `no rpc ${fn}` } };
        const row = (tables['goals.items'] ?? []).find((r) => r.id === args.step);
        if (!row || row.acts !== null) return { data: false, error: null };
        Object.assign(row, { status: 'proposed', acts: args.sentence });
        return { data: true, error: null };
      },
    }) as unknown as SchemaClient;
  return make(schema);
}

function records(tables: FakeTables): Row[] {
  return tables['core.dash_actions'] ?? [];
}

/** Every record is the scheduled surface, done, naming Dash. */
function expectScheduled(rows: Row[]) {
  for (const row of rows) {
    expect(row).toMatchObject({ user_id: USER, surface: 'scheduled', status: 'done' });
    expect(String(row.summary)).toMatch(/^Dash /);
  }
}

describe('the jobs sweep (/api/cron/jobs-sweep, and the daily stage)', () => {
  it('records the withdrawal it writes on a cold lead', async () => {
    const tables: FakeTables = {
      'job_search.applications': [
        {
          id: 'app-1',
          user_id: USER,
          status: 'lead',
          created_at: new Date(Date.now() - 90 * DAY).toISOString(),
          profiles: { ghost_threshold_days: 30 },
          roles: { title: 'Designer', companies: { name: 'Acme' } },
        },
      ],
      'job_search.application_events': [],
    };
    const closed = await closeColdLeads(serviceClient(tables, 'job_search') as never);

    expect(closed).toBe(1);
    const [event] = tables['job_search.application_events'];
    const rows = records(tables);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'close_cold_lead',
      op: 'insert',
      subject_ref: `job_search.application_events:${event.id}`,
      after_values: expect.objectContaining({ kind: 'withdrawal', application_id: 'app-1' }),
    });
    expect(rows[0].summary).toContain('for Designer at Acme');
  });

  it('records each reminder it adds, one record per reminder', async () => {
    const tables: FakeTables = {
      'job_search.interviews': [
        {
          id: 'iv-past',
          user_id: USER,
          application_id: 'app-1',
          scheduled_at: new Date(Date.now() - DAY / 2).toISOString(),
          debrief: null,
          went_well: null,
          prep_notes: 'done',
        },
        {
          id: 'iv-soon',
          user_id: USER,
          application_id: 'app-2',
          scheduled_at: new Date(Date.now() + DAY).toISOString(),
          prep_notes: null,
          applications: { roles: { title: 'Engineer', companies: { name: 'Globex' } } },
        },
      ],
      'job_search.reminders': [],
    };
    const created = await generateReminders(serviceClient(tables, 'job_search') as never);

    expect(created).toBe(2);
    const reminders = tables['job_search.reminders'];
    const rows = records(tables);
    expect(rows).toHaveLength(2);
    expectScheduled(rows);
    expect(rows.map((r) => r.subject_ref)).toEqual(reminders.map((r) => `job_search.reminders:${r.id}`));
    expect(rows.every((r) => r.kind === 'add_reminder' && r.op === 'insert')).toBe(true);
    expect(rows[1].summary).toContain('Globex');
  });
});

describe('the watch check (/api/cron/watches)', () => {
  const watch = {
    id: 'watch-1',
    user_id: USER,
    title: 'The blue kettle',
    url: 'https://example.test/kettle',
    reading: 'lowest_price',
    condition: {},
    report_times: [],
    ends_at: '2026-10-01T00:00:00Z',
    status: 'running',
    fired_value: null,
    fired_at: null,
    reported_at: null,
  };

  it('records ending a watch, and Home can undo it', async () => {
    const tables: FakeTables = { 'core.watches': [{ ...watch }] };
    await watchPorts(serviceClient(tables, 'core') as never, new Date()).end(watch, new Date());

    expect(tables['core.watches'][0].status).toBe('ended');
    const rows = records(tables);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'end_watch',
      op: 'update',
      subject_ref: 'core.watches:watch-1',
      before_values: expect.objectContaining({ status: 'running' }),
      after_values: expect.objectContaining({ status: 'ended' }),
    });

    const undone = await undoDashAction(fakeDashDeps(tables, USER), String(rows[0].id));
    expect(undone.ok).toBe(true);
    expect(tables['core.watches'][0].status).toBe('running');
  });

  it('records nothing when the watch had already stopped', async () => {
    const tables: FakeTables = { 'core.watches': [{ ...watch, status: 'ended' }] };
    await watchPorts(serviceClient(tables, 'core') as never, new Date()).end(watch, new Date());
    expect(records(tables)).toHaveLength(0);
  });
});

describe('the description backfill (/api/cron/jd-backfill, and the daily stage)', () => {
  it('records a filled description and a closed posting, and not a lookup note', async () => {
    const role = (id: string, title: string) => ({
      id,
      user_id: USER,
      company_id: 'co-1',
      title,
      ats_job_id: null,
      location: null,
      work_mode: null,
      seniority: null,
      comp_min_cents: null,
      comp_max_cents: null,
      jd_url: null,
      posting_status: 'unknown',
      jd_text: null,
    });
    const tables: FakeTables = {
      'job_search.roles': [role('role-1', 'Designer'), role('role-2', 'Writer'), role('role-3', 'Editor')],
    };
    const client = serviceClient(tables, 'job_search');
    const roles = tables['job_search.roles'];
    vi.mocked(applyBoardToRole).mockImplementation(async (_s, r) => {
      const row = roles.find((x) => x.id === r.id)!;
      if (r.id === 'role-1') {
        Object.assign(row, { jd_text: 'The job.', posting_status: 'open' });
        return { kind: 'filled', vendor: 'greenhouse', title: 'Designer', note: null };
      }
      if (r.id === 'role-2') {
        Object.assign(row, { posting_status: 'closed' });
        return { kind: 'closed', vendor: 'greenhouse' };
      }
      Object.assign(row, { jd_lookup_note: 'No posting matched.' });
      return { kind: 'no_match', vendor: 'greenhouse' };
    });
    const company = { id: 'co-1', name: 'Acme', ats_type: null, ats_board_token: null, ats_board_hint: null, careers_url: null, website: null };
    const summary = { companies: 0, filled: 0, ambiguous: 0, closed: 0, noBoard: 0 };

    await backfillCompany(
      client as never,
      client.schema('core') as never,
      roles.map((r) => ({ ...r, companies: company })) as never,
      summary,
      new Date(),
    );

    expect(summary).toMatchObject({ filled: 1, closed: 1 });
    const rows = records(tables);
    expect(rows).toHaveLength(2);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'fill_job_description',
      subject_ref: 'job_search.roles:role-1',
      op: 'update',
      before_values: expect.objectContaining({ jd_text: null }),
      after_values: expect.objectContaining({ jd_text: 'The job.' }),
    });
    expect(rows[1]).toMatchObject({ kind: 'close_posting', subject_ref: 'job_search.roles:role-2' });
  });
});

describe('the daily cron (/api/cron/daily)', () => {
  it('records each claim the sweep puts back', async () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const tables: FakeTables = {
      'public.plan_items': [
        {
          id: 'step-1',
          user_id: USER,
          number: 42,
          title: 'Show the count',
          status: 'in_progress',
          started_at: new Date(now.getTime() - 3 * DAY).toISOString(),
          comment: null,
        },
      ],
      'public.plan_runs': [],
    };
    const result = await releaseStaleClaims(serviceClient(tables, 'public') as never, now);

    expect(result.released).toBe(1);
    const rows = records(tables);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'release_claim',
      op: 'update',
      subject_ref: 'public.plan_items:step-1',
      before_values: expect.objectContaining({ status: 'in_progress' }),
      after_values: expect.objectContaining({ status: 'not_started' }),
    });
    expect(rows[0].summary).toContain('step #42, "Show the count",');
  });

  it('records each idea the night digest files', async () => {
    const tables: FakeTables = { 'public.ideas': [] };
    const written = await fileNightIdeas(serviceClient(tables, 'public') as never, USER, [
      { title: 'Show the weekly total on Home', detail: 'It is asked for every Monday.' },
      { title: 'Sort the reading list by length', detail: null },
    ]);

    expect(written).toBe(2);
    const ideas = tables['public.ideas'];
    const rows = records(tables);
    expect(rows).toHaveLength(2);
    expectScheduled(rows);
    expect(rows.map((r) => r.subject_ref)).toEqual(ideas.map((i) => `public.ideas:${i.id}`));
    expect(rows[0]).toMatchObject({ kind: 'file_idea', op: 'insert' });
    expect(rows[0].summary).toBe('Dash filed an idea overnight: "Show the weekly total on Home".');
  });

  it('records each step the morning goals run holds for approval', async () => {
    const tables: FakeTables = {
      'goals.items': [
        {
          id: 'step-landlord',
          user_id: USER,
          level: 'step',
          kind: 'claude',
          status: 'open',
          block_kind: null,
          title: 'Email the landlord',
          detail: null,
          acceptance: null,
          acts: null,
          archived_at: null,
        },
      ],
    };
    const result = await holdActingSteps({
      client: serviceClient(tables, 'goals') as never,
      userId: USER,
      mode: 'hold',
      enabled: true,
      ask: async () => 0.95,
      write: async () => 'Sends an email to the landlord.',
      scheduled: true,
    });

    expect(result).toMatchObject({ held: [expect.objectContaining({ id: 'step-landlord' })] });
    const rows = records(tables);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'hold_acting_step',
      op: 'update',
      subject_ref: 'goals.items:step-landlord',
      before_values: expect.objectContaining({ status: 'open', acts: null }),
      after_values: expect.objectContaining({ status: 'proposed' }),
    });
  });

  it('records nothing when a pressed path holds a step', async () => {
    const tables: FakeTables = {
      'goals.items': [
        { id: 's', user_id: USER, level: 'step', kind: 'claude', status: 'open', title: 'Book it', acts: null, archived_at: null },
      ],
    };
    await holdActingSteps({
      client: serviceClient(tables, 'goals') as never,
      userId: USER,
      mode: 'hold',
      enabled: true,
      ask: async () => 0.95,
      write: async () => 'Books a table.',
    });
    expect(tables['goals.items'][0].status).toBe('proposed');
    expect(records(tables)).toHaveLength(0);
  });
});
