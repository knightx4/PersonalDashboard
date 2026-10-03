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
 *   /api/cron/youtube-library: the skip verdicts on the watch list (plan #1572),
 *   and a skip put back from Home staying put back (plan #1574)
 *   the mail sync's bills (the inbox-incremental cron and the daily inbox
 *   stage) and the receipt re-read (/api/cron/recurring-reread and its daily
 *   stage), on the person's recurring payments (plan #1571)
 *   the mail sync's orders, with the inventory items they make (plan #1576)
 *   the mail sync's later mail on an order (shipments, returns, a
 *   cancellation), the appointments it files into Todo, and its reply tasks
 *   (plan #1577)
 */
import { describe, expect, it, vi } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { undoDashAction } from '@/lib/core/dash-actions';
import type { RecurringExtraction } from '@/lib/recurring/extraction';
import type { RecurringReading } from '@/lib/recurring/extract';
import { memoryClient } from '@/lib/recurring/memory-client';
import { orderImportedSummary, recordLifecycleChange, recordOrderImport, RETURNS_NO_UNDO } from '@/lib/orders/record';
import type { LifecycleExtraction } from '@/lib/email/extract/lifecycle';
import type { AppointmentExtraction } from '@/lib/todo/appointments/extraction';
import type { ReplyCandidate } from '@/lib/todo/replies/task';
import { MOVED_NO_UNDO, UPDATED_NO_UNDO } from '@/lib/recurring/record';
import { dashTodayEntry } from '@/lib/shell/dash-today';
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
const { judgeWatchLists } = await import('@/lib/learn/youtube/judging');
const { fileRecurringReading } = await import('@/lib/recurring/store');
const { rereadStoreReceipts } = await import('@/lib/recurring/reread');
const { applyLifecycleToOrder } = await import('@/lib/orders/apply-lifecycle');
const { fileAppointmentReading } = await import('@/lib/todo/appointments/store');
const { fileReplyTasks } = await import('@/lib/todo/replies/linker');

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
          roles: { title: 'Designer', companies: { name: 'Acme' } },
        },
      ],
      'job_search.profiles': [{ id: USER, ghost_threshold_days: 30 }],
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
          notes: null,
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
      surface: 'scheduled',
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

  it('records nothing when the caller names no surface', async () => {
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

describe('the YouTube library (/api/cron/youtube-library)', () => {
  const listRow = (id: string, videoId: string, title: string): Row => ({
    id,
    user_id: USER,
    video_id: videoId,
    left_playlist_at: null,
    verdict: null,
    judge_verdict: null,
    verdict_by: null,
    why: null,
    screened_at: null,
    judged_at: null,
    summary: null,
    key_points: null,
    added_at: '2026-10-01T00:00:00Z',
    item: { title, author: 'A channel', description: 'About it.', duration_seconds: 600, provider: null },
  });

  /** One screening call: the first video looked at, the second skipped. */
  const anthropic = {
    messages: {
      create: vi.fn(async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'report_screen',
            input: {
              videos: [
                { number: 1, decision: 'look', why: 'Serves your finance track.' },
                { number: 2, decision: 'skip', why: 'Touches none of your tracks.' },
              ],
            },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 500, output_tokens: 80 },
      })),
    },
  };

  it('records each skip verdict it writes, and Home can undo it', async () => {
    const tables: FakeTables = {
      'learn.watch_list': [
        listRow('wl-1', 'aaaaaaaaaaa', 'Cash flow in ten minutes'),
        listRow('wl-2', 'bbbbbbbbbbb', 'Minecraft speedrun'),
      ],
      'learn.video_transcripts': [],
    };

    const result = await judgeWatchLists(serviceClient(tables, 'learn') as never, {
      anthropicApiKey: 'k',
      deadline: Date.now() + 60_000,
      client: anthropic as never,
      profileFor: async () => ({ tracks: [], goals: [], ideas: [] }) as never,
      now: () => new Date('2026-10-03T06:00:00Z'),
    });

    expect(result).toMatchObject({ skipped: 1, passed: 1 });
    const rows = records(tables);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'skip_video',
      subject_ref: 'learn.watch_list:wl-2',
      op: 'update',
      summary: 'Dash marked "Minecraft speedrun" as a skip on your watch list.',
      before_values: expect.objectContaining({ verdict: null, screened_at: null }),
      after_values: expect.objectContaining({ verdict: 'skip', verdict_by: 'judge' }),
    });

    const undone = await undoDashAction(fakeDashDeps(tables, USER), String(rows[0].id));
    expect(undone.ok).toBe(true);
    expect(tables['learn.watch_list'][1]).toMatchObject({ verdict: null, judge_verdict: null, verdict_by: null, screened_at: null });
  });

  it('leaves a skip you put back from Home unskipped on later runs (plan #1574)', async () => {
    const tables: FakeTables = {
      'learn.watch_list': [
        listRow('wl-1', 'aaaaaaaaaaa', 'Cash flow in ten minutes'),
        listRow('wl-2', 'bbbbbbbbbbb', 'Minecraft speedrun'),
      ],
      'learn.video_transcripts': [],
    };
    const run = (create: () => Promise<unknown>) =>
      judgeWatchLists(serviceClient(tables, 'learn') as never, {
        anthropicApiKey: 'k',
        deadline: Date.now() + 60_000,
        client: { messages: { create } } as never,
        profileFor: async () => ({ tracks: [], goals: [], ideas: [] }) as never,
        now: () => new Date('2026-10-03T06:00:00Z'),
      });

    await run(anthropic.messages.create);
    const [skip] = records(tables);
    expect((await undoDashAction(fakeDashDeps(tables, USER), String(skip.id))).ok).toBe(true);

    // The next two runs would skip it again if they were asked.
    const again = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'report_screen',
          input: { videos: [{ number: 1, decision: 'skip', why: 'Touches none of your tracks.' }] },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 500, output_tokens: 80 },
    }));
    for (let i = 0; i < 2; i++) {
      const result = await run(again);
      expect(result.skipped).toBe(0);
    }

    expect(again).not.toHaveBeenCalled();
    expect(tables['learn.watch_list'][1]).toMatchObject({ verdict: null, verdict_by: null, left_playlist_at: null });
    expect(records(tables)).toHaveLength(1);
    expect(records(tables)[0]).toMatchObject({ status: 'undone' });
  });

  it('records nothing when you set the verdict while the run was working', async () => {
    const tables: FakeTables = {
      'learn.watch_list': [
        listRow('wl-1', 'aaaaaaaaaaa', 'Cash flow in ten minutes'),
        listRow('wl-2', 'bbbbbbbbbbb', 'Minecraft speedrun'),
      ],
      'learn.video_transcripts': [],
    };
    const moved = vi.fn(async () => {
      Object.assign(tables['learn.watch_list'][1], { verdict: 'watch', verdict_by: 'you' });
      return anthropic.messages.create();
    });

    await judgeWatchLists(serviceClient(tables, 'learn') as never, {
      anthropicApiKey: 'k',
      deadline: Date.now() + 60_000,
      client: { messages: { create: moved } } as never,
      profileFor: async () => ({ tracks: [], goals: [], ideas: [] }) as never,
    });

    expect(tables['learn.watch_list'][1]).toMatchObject({ verdict: 'watch', verdict_by: 'you' });
    expect(records(tables)).toHaveLength(0);
  });
});

describe('the mail sync and the receipt re-read, on recurring payments (plan #1571)', () => {
  const RECURRING = ['recurring_payments', 'recurring_charges', 'recurring_payee_aliases', 'recurring_messages'];

  /**
   * lib/recurring's code over its own in-memory client (which upserts), with
   * `schema` for the record: public is the same tables, core is the fake
   * schema db. The arrays are shared, so Home's undo over fakeDashDeps sees
   * the rows the run wrote.
   */
  function recurringWorld(now = '2026-10-03T08:00:00Z') {
    const t: Record<string, Row[]> = Object.fromEntries(RECURRING.map((name) => [name, []]));
    const fake: FakeTables = Object.fromEntries(RECURRING.map((name) => [`public.${name}`, t[name]]));
    const client = (at = now) => {
      const mem = memoryClient(t);
      const db = fakeSchemaDb(fake, at);
      return Object.assign(mem, {
        schema: (name: string) => (name === 'public' ? mem : db(name)),
      });
    };
    return { t, fake, client };
  }

  const reading = (over: Partial<RecurringExtraction> = {}): RecurringExtraction => ({
    payee: 'Netflix',
    kind: 'subscription',
    event: 'charge',
    amountCents: 1549,
    previousAmountCents: null,
    currency: 'USD',
    period: 'month',
    occurredOn: '2026-09-21',
    dueOn: null,
    ...over,
  });

  it('records a payment the sync adds from a bill, and Home can undo it', async () => {
    const { t, fake, client } = recurringWorld();
    const { paymentId } = await fileRecurringReading(client(), {
      userId: USER,
      messageId: 'm-1',
      senderDomain: 'netflix.com',
      reading: reading(),
      record: true,
    });

    expect(records(fake)).toHaveLength(1);
    expectScheduled(records(fake));
    expect(records(fake)[0]).toMatchObject({
      kind: 'file_recurring_payment',
      subject_ref: `public.recurring_payments:${paymentId}`,
      op: 'insert',
      undo: null,
    });
    expect(String(records(fake)[0].summary)).toContain('Dash added Netflix to your recurring payments');
    expect(String(records(fake)[0].summary)).toContain('$15.49 charge on 21 Sept');

    const undone = await undoDashAction(fakeDashDeps(fake, USER), String(records(fake)[0].id));
    expect(undone.ok).toBe(true);
    expect(t.recurring_payments).toHaveLength(0);
  });

  it('records a later bill on the same payment with the sentence saying why it has no Undo', async () => {
    const { fake, client } = recurringWorld();
    await fileRecurringReading(client(), {
      userId: USER,
      messageId: 'm-1',
      senderDomain: 'netflix.com',
      reading: reading(),
      record: true,
    });
    await fileRecurringReading(client('2026-10-03T09:00:00Z'), {
      userId: USER,
      messageId: 'm-2',
      senderDomain: 'netflix.com',
      reading: reading({ occurredOn: '2026-10-21' }),
      record: true,
    });

    const [added, updated] = records(fake);
    expect(updated).toMatchObject({ kind: 'update_recurring_payment', op: 'update', undo: { none: UPDATED_NO_UNDO } });
    expect(updated.before_values).toMatchObject({ payee: 'Netflix', last_charged_on: '2026-09-21' });
    expect(updated.after_values).toMatchObject({ last_charged_on: '2026-10-21' });
    expectScheduled(records(fake));

    // Home shows the sentence in place of the button, and the undo says the same.
    const entry = dashTodayEntry(
      { ...(updated as Parameters<typeof dashTodayEntry>[0]), conversation_id: null, turn_id: null, input: null, declined_at: null },
      '2026-10-03',
    );
    expect(entry?.noUndo).toBe(UPDATED_NO_UNDO);
    const refused = await undoDashAction(fakeDashDeps(fake, USER), String(updated.id));
    expect(refused).toMatchObject({ ok: false, error: UPDATED_NO_UNDO });

    // The add can no longer be taken back either, since the second bill hangs off it.
    const blocked = await undoDashAction(fakeDashDeps(fake, USER), String(added.id));
    expect(blocked.ok).toBe(false);
    expect(blocked.ok ? '' : blocked.error).toMatch(/in a way it cannot undo/);
  });

  it('records nothing when a filing changes nothing, or when the caller does not ask', async () => {
    const { fake, client } = recurringWorld();
    await fileRecurringReading(client(), {
      userId: USER,
      messageId: 'm-1',
      senderDomain: 'netflix.com',
      reading: reading(),
    });
    expect(records(fake)).toHaveLength(0);
    await fileRecurringReading(client(), {
      userId: USER,
      messageId: 'm-1',
      senderDomain: 'netflix.com',
      reading: reading(),
      record: true,
    });
    expect(records(fake)).toHaveLength(0);
  });

  it('records each charge the re-read moves off a store, saying why it has no Undo', async () => {
    const { t, fake, client } = recurringWorld();
    t.recurring_payments.push(
      { id: 'apple', user_id: USER, payee: 'Apple', payee_key: 'apple', kind: 'subscription', sender_domain: 'email.apple.com', status: 'active', currency: 'USD' },
      { id: 'yt', user_id: USER, payee: 'YouTube Premium', payee_key: 'youtubepremium', kind: 'subscription', sender_domain: 'email.apple.com', status: 'active', currency: 'USD' },
    );
    t.recurring_charges.push({
      id: 'a',
      user_id: USER,
      payment_id: 'apple',
      message_id: 'm-a',
      event: 'charge',
      amount_cents: 1899,
      previous_amount_cents: null,
      currency: 'USD',
      period: null,
      occurred_on: '2026-04-13',
      due_on: null,
      created_at: '2026-04-13T09:00:00Z',
    });
    t.recurring_messages.push({ id: 'm-a', user_id: USER, parse_status: 'parsed', error: null });

    const read = vi.fn(
      async (input: { receivedOn: string }): Promise<RecurringReading> => ({
        ok: true,
        source: 'llm',
        value: reading({ payee: 'YouTube Premium', amountCents: 100, occurredOn: input.receivedOn }),
      }),
    );
    const result = await rereadStoreReceipts(client() as never, {
      userId: USER,
      providerIds: async (ids) => new Map(ids.map((id) => [id, `g-${id}`])),
      fetchMessage: async () => ({
        subject: 'Your receipt from Apple.',
        text: 'YouTube Premium',
        fromAddress: 'Apple <no_reply@email.apple.com>',
      }),
      read,
    });

    expect(result.moved).toHaveLength(1);
    expect(records(fake)).toHaveLength(1);
    expectScheduled(records(fake));
    const [moved] = records(fake);
    expect(moved).toMatchObject({
      kind: 'reread_recurring_charge',
      subject_ref: 'public.recurring_payments:yt',
      op: 'update',
      undo: { none: MOVED_NO_UNDO },
    });
    expect(moved.summary).toBe(
      'Dash read a receipt again and moved its $18.99 charge of 13 Apr from Apple to YouTube Premium. Apple had nothing left on it, so Dash removed it.',
    );
    const refused = await undoDashAction(fakeDashDeps(fake, USER), String(moved.id));
    expect(refused).toMatchObject({ ok: false, error: MOVED_NO_UNDO });
  });
});

describe('the mail sync, on the orders it imports (plan #1576)', () => {
  /** An order as the sync leaves it: two lines, three inventory items, a book's details. */
  function orderWorld(): FakeTables {
    return {
      'public.orders': [{ id: 'order-1', user_id: USER, order_date: '2026-09-28', total_cents: 4200 }],
      'public.order_items': [
        { id: 'oi-1', order_id: 'order-1', name: 'Desk lamp', quantity: 1 },
        { id: 'oi-2', order_id: 'order-1', name: 'Dune', quantity: 2 },
      ],
      'public.inventory_items': [
        { id: 'inv-1', user_id: USER, order_item_id: 'oi-1', name: 'Desk lamp' },
        { id: 'inv-2', user_id: USER, order_item_id: 'oi-2', name: 'Dune' },
        { id: 'inv-3', user_id: USER, order_item_id: 'oi-2', name: 'Dune' },
      ],
      'public.book_details': [{ id: 'bd-1', inventory_item_id: 'inv-2' }],
    };
  }

  const imported = {
    orderId: 'order-1',
    merchant: 'Bookshop',
    orderDate: '2026-09-28',
    lines: [
      { name: 'Desk lamp', quantity: 1 },
      { name: 'Dune', quantity: 2 },
    ],
    units: 3,
  };

  it('records the order and its inventory items as one change, and Home can undo it', async () => {
    const fake = orderWorld();
    await recordOrderImport(serviceClient(fake, 'public'), USER, imported);

    const rows = records(fake);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({ kind: 'import_order', subject_ref: 'public.orders:order-1', op: 'insert', undo: null });
    expect(rows[0].summary).toBe(
      'Dash added your order from Bookshop of 28 Sept, and 3 things to your inventory: Desk lamp and 2 × Dune.',
    );

    const entry = dashTodayEntry(
      { ...(rows[0] as Parameters<typeof dashTodayEntry>[0]), conversation_id: null, turn_id: null, input: null, declined_at: null },
      '2026-10-03',
    );
    expect(entry).toMatchObject({ workspace: 'shopping', noUndo: null });

    // The book's details came with the order, so they do not stop the undo.
    const undone = await undoDashAction(fakeDashDeps(fake, USER), String(rows[0].id));
    expect(undone.ok).toBe(true);
    expect(fake['public.orders']).toHaveLength(0);
  });

  it('refuses the undo once the person has used or listed one of its things, or later mail added a shipment', async () => {
    for (const [table, row] of [
      ['public.item_uses', { id: 'use-1', inventory_item_id: 'inv-3' }],
      ['public.inventory_item_lists', { id: 'list-1', inventory_item_id: 'inv-1' }],
      ['todo.task_links', { id: 'link-1', inventory_item_id: 'inv-2' }],
      ['public.shipments', { id: 'ship-1', order_id: 'order-1' }],
    ] as const) {
      const fake = orderWorld();
      await recordOrderImport(serviceClient(fake, 'public'), USER, imported);
      fake[table] = [row];

      const refused = await undoDashAction(fakeDashDeps(fake, USER), String(records(fake)[0].id));
      expect(refused.ok, table).toBe(false);
      expect(fake['public.orders'], table).toHaveLength(1);
    }
  });

  it('names at most three lines, and says so when nothing went into the inventory', () => {
    const many = orderImportedSummary({
      merchant: null,
      orderDate: '2026-09-28',
      lines: ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name: `${name} ${'x'.repeat(80)}`, quantity: 1 })),
      units: 5,
    });
    expect(many).toMatch(/^Dash added your order of 28 Sept, and 5 things to your inventory: .* and 2 more\.$/);
    expect(many.length).toBeLessThanOrEqual(300);

    expect(orderImportedSummary({ merchant: 'Shop', orderDate: '2026-09-28', lines: [], units: 0 })).toBe(
      'Dash added your order from Shop of 28 Sept. Nothing in it went into your inventory.',
    );
  });
});

describe('the mail sync, on later mail about an order (plan #1577)', () => {
  function orderWorld(): FakeTables {
    return {
      'public.merchants': [{ id: 'm-1', name: 'Bookshop' }],
      'public.orders': [
        { id: 'order-1', user_id: USER, merchant_id: 'm-1', order_date: '2026-09-28', cancelled_at: null, status: 'ordered' },
      ],
      'public.order_items': [{ id: 'oi-1', order_id: 'order-1', name: 'Dune', quantity: 2 }],
      'public.inventory_items': [
        { id: 'inv-1', user_id: USER, order_item_id: 'oi-1', name: 'Dune', status: 'owned', cost_cents: 1200 },
        { id: 'inv-2', user_id: USER, order_item_id: 'oi-1', name: 'Dune', status: 'owned', cost_cents: 1200 },
      ],
    };
  }

  const ORDER: { id: string; merchantId: string; externalOrderNumber: string; cancelledAt: string | null } = {
    id: 'order-1',
    merchantId: 'm-1',
    externalOrderNumber: '42',
    cancelledAt: null,
  };

  function reading(overrides: Partial<LifecycleExtraction> = {}): LifecycleExtraction {
    return {
      externalOrderNumber: '42',
      trackingNumber: '1Z999',
      trackingUrl: null,
      carrier: 'UPS',
      shipmentStatus: 'in_transit',
      shippedAt: '2026-09-29T10:00:00Z',
      deliveredAt: null,
      expectedOn: '2026-10-01',
      refundAmountCents: null,
      itemNameHints: [],
      confidence: 0.9,
      ...overrides,
    };
  }

  /** What the sync does with one email: apply it, then record what it changed. */
  async function sync(
    fake: FakeTables,
    classification: 'shipping' | 'delivery' | 'return' | 'cancellation',
    extraction: LifecycleExtraction,
    order: typeof ORDER = ORDER,
  ) {
    const client = serviceClient(fake, 'public');
    const applied = await applyLifecycleToOrder(client as never, {
      userId: USER,
      order,
      classification,
      extraction,
      sourceMessageId: `msg-${classification}`,
      receivedAt: new Date('2026-09-30T09:00:00Z'),
    });
    expect(applied.ok).toBe(true);
    if (applied.ok && applied.change) await recordLifecycleChange(client, USER, order.id, applied.change);
  }

  it('records a shipment it adds, and Home can undo it, which frees the order import\'s own Undo', async () => {
    const fake = orderWorld();
    await recordOrderImport(serviceClient(fake, 'public'), USER, {
      orderId: 'order-1',
      merchant: 'Bookshop',
      orderDate: '2026-09-28',
      lines: [{ name: 'Dune', quantity: 2 }],
      units: 2,
    });
    await sync(fake, 'shipping', reading());

    const rows = records(fake);
    expect(rows).toHaveLength(2);
    expectScheduled(rows);
    const shipment = rows[1];
    expect(shipment).toMatchObject({ kind: 'add_shipment', op: 'insert', undo: null });
    expect(shipment.subject_ref).toBe(`public.shipments:${fake['public.shipments'][0].id}`);
    expect(shipment.summary).toBe('Dash added a shipment to your order from Bookshop of 28 Sept: on its way, due 1 Oct.');

    const deps = fakeDashDeps(fake, USER);
    expect((await undoDashAction(deps, String(rows[0].id))).ok).toBe(false);
    expect((await undoDashAction(deps, String(shipment.id))).ok).toBe(true);
    expect(fake['public.shipments']).toHaveLength(0);
    expect((await undoDashAction(deps, String(rows[0].id))).ok).toBe(true);
  });

  it('records a later email moving the shipment on, and nothing for one that changes nothing', async () => {
    const fake = orderWorld();
    await sync(fake, 'shipping', reading());
    await sync(fake, 'delivery', reading({ shipmentStatus: 'delivered', deliveredAt: '2026-10-01T15:00:00Z' }));
    await sync(fake, 'delivery', reading({ shipmentStatus: 'delivered', deliveredAt: '2026-10-01T15:00:00Z' }));

    const rows = records(fake);
    expect(rows.map((row) => row.kind)).toEqual(['add_shipment', 'update_shipment']);
    expect(rows[1]).toMatchObject({ op: 'update', summary: 'Dash marked your order from Bookshop of 28 Sept delivered.' });

    const deps = fakeDashDeps(fake, USER);
    // The add waits on the later change, which goes back first.
    expect((await undoDashAction(deps, String(rows[0].id))).ok).toBe(false);
    expect((await undoDashAction(deps, String(rows[1].id))).ok).toBe(true);
    expect(fake['public.shipments'][0]).toMatchObject({ status: 'in_transit', delivered_at: null });
  });

  it('records a cancellation, and Home can undo it; an order already cancelled records nothing', async () => {
    const fake = orderWorld();
    await sync(fake, 'cancellation', reading());
    await sync(fake, 'cancellation', reading(), { ...ORDER, cancelledAt: '2026-09-30T09:00:00Z' });

    const rows = records(fake);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'cancel_order',
      op: 'update',
      subject_ref: 'public.orders:order-1',
      summary: 'Dash marked your order from Bookshop of 28 Sept cancelled.',
    });
    expect((await undoDashAction(fakeDashDeps(fake, USER), String(rows[0].id))).ok).toBe(true);
    expect(fake['public.orders'][0].cancelled_at).toBeNull();
  });

  it('records one thing returned with an Undo, and several from one email with the sentence saying why there is none', async () => {
    const one = orderWorld();
    await sync(one, 'return', reading({ refundAmountCents: 1200 }));
    // Both units are owned and the email names neither, so it returns both.
    expect(one['public.returns']).toHaveLength(2);

    const single = orderWorld();
    single['public.inventory_items'] = [single['public.inventory_items'][0]];
    await sync(single, 'return', reading({ refundAmountCents: 1200 }));
    const [record] = records(single);
    expect(record).toMatchObject({ kind: 'mark_returned', op: 'insert', undo: null });
    expect(record.summary).toBe('Dash marked Dune from your order from Bookshop of 28 Sept returned and refunded.');
    expect((await undoDashAction(fakeDashDeps(single, USER), String(record.id))).ok).toBe(true);
    expect(single['public.returns']).toHaveLength(0);

    const [both] = records(one);
    expect(both).toMatchObject({ kind: 'mark_returned', undo: { none: RETURNS_NO_UNDO } });
    expect(both.summary).toBe('Dash marked 2 things from your order from Bookshop of 28 Sept returned and refunded.');
    const entry = dashTodayEntry(
      { ...(both as Parameters<typeof dashTodayEntry>[0]), conversation_id: null, turn_id: null, input: null, declined_at: null },
      '2026-10-03',
    );
    expect(entry).toMatchObject({ workspace: 'shopping', noUndo: RETURNS_NO_UNDO });
    const refused = await undoDashAction(fakeDashDeps(one, USER), String(both.id));
    expect(refused).toMatchObject({ ok: false, error: RETURNS_NO_UNDO });
    expect(one['public.returns']).toHaveLength(2);
  });
});

describe('the mail sync, on the appointments it files into Todo (plan #1577)', () => {
  function booking(overrides: Partial<AppointmentExtraction> = {}): AppointmentExtraction {
    return {
      event: 'booked',
      title: 'Dental cleaning',
      provider: 'Smile Dental',
      reference: 'ABC123',
      date: '2026-10-08',
      time: '09:30',
      endTime: null,
      location: null,
      previousDate: null,
      previousTime: null,
      ...overrides,
    };
  }

  async function file(fake: FakeTables, reading: AppointmentExtraction, receivedAt: string) {
    return fileAppointmentReading(serviceClient(fake, 'todo') as never, {
      userId: USER,
      messageId: `msg-${receivedAt}`,
      receivedAt,
      timezone: 'UTC',
      senderName: null,
      reading,
    });
  }

  it('records an appointment it adds, and Home can undo it', async () => {
    const fake: FakeTables = {};
    const filed = await file(fake, booking(), '2026-10-01T08:00:00Z');

    const rows = records(fake);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'add_appointment',
      op: 'insert',
      subject_ref: `todo.appointments:${filed.appointmentId}`,
      summary: 'Dash added your appointment with Smile Dental on Thu 8 Oct to Todo.',
    });
    const entry = dashTodayEntry(
      { ...(rows[0] as Parameters<typeof dashTodayEntry>[0]), conversation_id: null, turn_id: null, input: null, declined_at: null },
      '2026-10-03',
    );
    expect(entry).toMatchObject({ workspace: 'todo', noUndo: null });
    expect((await undoDashAction(fakeDashDeps(fake, USER), String(rows[0].id))).ok).toBe(true);
    expect(fake['todo.appointments']).toHaveLength(0);
  });

  it('records a later move and a cancellation, each with an Undo, and nothing for a repeat', async () => {
    const fake: FakeTables = {};
    await file(fake, booking(), '2026-10-01T08:00:00Z');
    await file(fake, booking({ event: 'reminder' }), '2026-10-02T08:00:00Z');
    await file(fake, booking({ event: 'rescheduled', date: '2026-10-09' }), '2026-10-03T08:00:00Z');
    await file(fake, booking({ event: 'cancelled', date: null, time: null }), '2026-10-04T08:00:00Z');

    const rows = records(fake);
    expect(rows.map((row) => row.summary)).toEqual([
      'Dash added your appointment with Smile Dental on Thu 8 Oct to Todo.',
      'Dash moved your appointment with Smile Dental to Fri 9 Oct.',
      'Dash marked your appointment with Smile Dental on Fri 9 Oct cancelled.',
    ]);
    expect(rows.slice(1).map((row) => row.op)).toEqual(['update', 'update']);

    const deps = fakeDashDeps(fake, USER);
    expect((await undoDashAction(deps, String(rows[2].id))).ok).toBe(true);
    expect(fake['todo.appointments'][0]).toMatchObject({ status: 'booked', starts_on: '2026-10-09' });
  });
});

describe('the mail sync, on the reply tasks it files (plan #1577)', () => {
  const waiting: ReplyCandidate = {
    message_id: 'msg-1',
    account_email: 'me@example.com',
    thread_id: 'thread-1',
    received_at: '2026-10-02T10:00:00Z',
    from_address: 'Jane Doe <jane@example.com>',
    reply_to_address: null,
    subject: 'Lunch next week?',
  };

  /** The two functions over the fake tables, one task per thread as the migration has it. */
  function replyClient(fake: FakeTables, candidates: ReplyCandidate[]) {
    const judged = new Set<string>();
    return {
      ...(serviceClient(fake, 'todo') as unknown as Record<string, unknown>),
      async rpc(name: string, args: Row) {
        if (name === 'reply_candidates') return { data: candidates.filter((c) => !judged.has(c.thread_id)), error: null };
        const found = candidates.find((c) => c.message_id === args.p_message_id)!;
        if (judged.has(found.thread_id)) return { data: null, error: null };
        judged.add(found.thread_id);
        if (args.p_title === null) return { data: null, error: null };
        const id = `task-${found.thread_id}`;
        (fake['todo.tasks'] ??= []).push({ id, user_id: USER, title: args.p_title, body: args.p_body, parent_id: null });
        return { data: id, error: null };
      },
    };
  }

  it('records each task it files, and Home can undo it; a skipped thread records nothing', async () => {
    const fake: FakeTables = {};
    const automated = { ...waiting, message_id: 'msg-2', thread_id: 'thread-2', from_address: 'no-reply@shop.com' };
    const client = replyClient(fake, [waiting, automated]);
    expect(await fileReplyTasks(client as never, { userId: USER })).toEqual({ filed: 1, skipped: 1 });

    const rows = records(fake);
    expect(rows).toHaveLength(1);
    expectScheduled(rows);
    expect(rows[0]).toMatchObject({
      kind: 'file_reply_task',
      op: 'insert',
      subject_ref: 'todo.tasks:task-thread-1',
      summary: 'Dash added "Reply to Jane Doe: Lunch next week?" to Todo, for an email waiting on your answer.',
    });
    expect((await undoDashAction(fakeDashDeps(fake, USER), String(rows[0].id))).ok).toBe(true);
    expect(fake['todo.tasks']).toHaveLength(0);

    // The thread stays judged, so the next pass files nothing again.
    expect(await fileReplyTasks(client as never, { userId: USER })).toEqual({ filed: 0, skipped: 0 });
  });
});
