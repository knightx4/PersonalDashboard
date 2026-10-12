import { beforeEach, describe, expect, it } from 'vitest';
import { changePaths, undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { changeHref, changeSentence, changeWhere } from '@/lib/ask/change-view';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type DashChange, type MadeDashChange } from '@/lib/talk/changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { BULK_MAX } from './bulk-items';
import type { DashWriteContext, DashWriteResult } from './registry';
import { WRITE_TOOLS } from './writes';

/**
 * Dash moving many job roles at once (plan #1657): a rule such as "archive
 * every role I applied to before August with no reply" moves exactly those
 * applications the way the board does, a status_override event and the
 * override column, and one Undo puts every one back. One in-memory database
 * stands in for the person's clients; it does not run the status trigger,
 * so `status` here is what the database had before the move.
 */

const ME = '00000000-0000-4000-8000-0000000000cc';
const SOMEONE = '00000000-0000-4000-8000-0000000000dd';
const ACME = '00000000-0000-4000-8000-00000000c001';
const R_ANALYST = '00000000-0000-4000-8000-00000000a001';
const R_PLANNER = '00000000-0000-4000-8000-00000000a002';
const R_CONTROLLER = '00000000-0000-4000-8000-00000000a003';
const R_GHOSTED = '00000000-0000-4000-8000-00000000a004';
const R_THEIRS = '00000000-0000-4000-8000-00000000a005';
const ANALYST_1 = '00000000-0000-4000-8000-00000000b001';
const ANALYST_2 = '00000000-0000-4000-8000-00000000b002';
const PLANNER = '00000000-0000-4000-8000-00000000b003';
const CONTROLLER = '00000000-0000-4000-8000-00000000b004';
const GHOSTED = '00000000-0000-4000-8000-00000000b005';
const THEIRS = '00000000-0000-4000-8000-00000000b006';

let tables: FakeTables;
let seen: Set<string>;

function application(id: string, roleId: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: ME,
    role_id: roleId,
    attempt: 1,
    status,
    status_manual_override: null,
    submitted_at: '2026-07-01T10:00:00Z',
    ...extra,
  };
}

function context(enabled: DashWriteContext['enabledModules'] = ['jobs']): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-08',
    timezone: 'UTC',
    enabledModules: enabled,
    db: async (schema) => client(schema),
    searchSources: [],
    seen: (table, ref) => seen.has(`${table}:${ref}`),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

function apply(input: unknown, ctx = context()): Promise<DashWriteResult> {
  const tool = WRITE_TOOLS.find((t) => t.name === 'move_roles');
  if (!tool) throw new Error('no move_roles tool');
  return tool.apply(ctx, input);
}

function ok(result: DashWriteResult): Extract<DashWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

function deps(): ChangeDeps {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-08',
    enabledModules: ['jobs'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => '2026-10-08T12:00:00Z',
  };
}

async function keep(result: Extract<DashWriteResult, { ok: true }>): Promise<DashChange> {
  const core = fakeSchemaDb(tables)('core') as unknown as CoreSupabaseClient;
  return insertMadeChange(core, ME, 'conv-1', { ...result, undo: result.undo ?? null } as unknown as MadeDashChange);
}

const app = (id: string) => tables['job_search.applications'].find((row) => row.id === id)!;
const events = () => tables['job_search.application_events'];

beforeEach(() => {
  seen = new Set();
  tables = {
    'core.dash_actions': [],
    'job_search.companies': [{ id: ACME, user_id: ME, name: 'Acme' }],
    'job_search.roles': [
      { id: R_ANALYST, user_id: ME, title: 'Analyst', company_id: ACME },
      { id: R_PLANNER, user_id: ME, title: 'Planner', company_id: ACME },
      { id: R_CONTROLLER, user_id: ME, title: 'Controller', company_id: null },
      { id: R_GHOSTED, user_id: ME, title: 'Buyer', company_id: ACME },
      { id: R_THEIRS, user_id: SOMEONE, title: 'Not mine', company_id: null },
    ],
    'job_search.applications': [
      application(ANALYST_1, R_ANALYST, 'rejected', { submitted_at: '2025-01-01T10:00:00Z' }),
      application(ANALYST_2, R_ANALYST, 'acknowledged', { attempt: 2 }),
      application(PLANNER, R_PLANNER, 'submitted', { status_manual_override: 'submitted' }),
      application(CONTROLLER, R_CONTROLLER, 'in_process'),
      application(GHOSTED, R_GHOSTED, 'ghosted'),
      application(THEIRS, R_THEIRS, 'acknowledged', { user_id: SOMEONE }),
    ],
    'job_search.application_events': [],
  };
});

describe('move_roles', () => {
  it('archives the roles named, writes the board\'s event for each, and one Undo puts them all back', async () => {
    for (const id of [ANALYST_2, PLANNER, GHOSTED]) seen.add(`job_search.applications:${id}`);
    const result = ok(await apply({ stage: 'archive', application_refs: [ANALYST_2, PLANNER, GHOSTED] }));

    expect([ANALYST_2, PLANNER].map((id) => app(id).status_manual_override)).toEqual(['withdrawn', 'withdrawn']);
    // Ghosted is already closed and stays ghosted, so the funnel still counts it as no answer.
    expect(app(GHOSTED).status_manual_override).toBeNull();
    expect(events()).toHaveLength(2);
    expect(events()[0]).toMatchObject({
      user_id: ME,
      application_id: ANALYST_2,
      kind: 'status_override',
      source: 'manual',
      summary: 'Moved to withdrawn by Dash',
      payload: { status: 'withdrawn' },
    });
    expect(result).toMatchObject({
      kind: 'move_roles',
      op: 'update',
      subjectRef: `job_search.applications:${ANALYST_2}`,
      input: { stage: 'archive', status: 'withdrawn', count: 2, titles: ['Analyst at Acme', 'Planner at Acme'], left: 1 },
      row: { table: 'job_search.applications', ref: ANALYST_2, href: '/jobs/pipeline' },
    });
    expect(result.summary).toBe(
      'Dash archived 2 roles: Analyst at Acme and Planner at Acme. 1 was left as it was, already closed.',
    );

    const kept = await keep(result);
    expect(tables['core.dash_actions']).toHaveLength(1);
    expect(changeSentence(kept, true)).toBe('Archived 2 roles: Analyst at Acme and Planner at Acme');
    expect(changeHref(kept)).toBe('/jobs/pipeline');
    expect(changeWhere(kept)).toBe('Open the pipeline');
    expect(changePaths(kept)).toEqual(
      expect.arrayContaining(['/jobs/pipeline', `/jobs/roles/${R_ANALYST}`, `/jobs/roles/${R_PLANNER}`]),
    );

    const undone = await undoChange(deps(), kept.id);
    expect(undone).toMatchObject({ ok: true, change: { status: 'undone' } });
    // Each override goes back to what it held, and Dash's events leave the history.
    expect(app(ANALYST_2).status_manual_override).toBeNull();
    expect(app(PLANNER).status_manual_override).toBe('submitted');
    expect(events()).toHaveLength(0);
  });

  it('moves a role by its latest application, to the stage named', async () => {
    for (const id of [R_ANALYST, R_CONTROLLER]) seen.add(`job_search.roles:${id}`);
    const result = ok(await apply({ stage: 'in_process', role_refs: [R_ANALYST, R_CONTROLLER] }));
    expect(app(ANALYST_2).status_manual_override).toBe('in_process');
    expect(app(ANALYST_1).status_manual_override).toBeNull();
    // The controller is in process already.
    expect(result.input).toMatchObject({ count: 1, left: 1 });
    expect(result.summary).toBe('Dash moved 1 role to In process: Analyst at Acme. 1 was left as it was, already there.');
    expect(changeSentence(await keep(result), true)).toBe('Moved 1 role to In process: Analyst at Acme');
  });

  it('moves to Submitted as the board\'s column does', async () => {
    seen.add(`job_search.applications:${CONTROLLER}`);
    ok(await apply({ stage: 'submitted', application_refs: [CONTROLLER] }));
    expect(app(CONTROLLER).status_manual_override).toBe('acknowledged');
  });

  it('leaves alone on Undo a role moved by hand since, and puts the rest back', async () => {
    for (const id of [ANALYST_2, PLANNER]) seen.add(`job_search.applications:${id}`);
    const kept = await keep(ok(await apply({ stage: 'rejected', application_refs: [ANALYST_2, PLANNER] })));
    app(PLANNER).status_manual_override = 'offer';

    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(app(ANALYST_2).status_manual_override).toBeNull();
    expect(app(PLANNER).status_manual_override).toBe('offer');
    // The planner's move by Dash stays in its history, under the later one.
    expect(events().map((e) => e.application_id)).toEqual([PLANNER]);
  });

  it('refuses an Undo when every role has moved on since', async () => {
    seen.add(`job_search.applications:${CONTROLLER}`);
    const kept = await keep(ok(await apply({ stage: 'offer', application_refs: [CONTROLLER] })));
    app(CONTROLLER).status_manual_override = 'rejected';
    const refused = await undoChange(deps(), kept.id);
    expect(!refused.ok && refused.error).toContain('moved since');
    expect(events()).toHaveLength(1);
  });

  it('says which kinds of closed when every role is already closed', async () => {
    seen.add(`job_search.applications:${GHOSTED}`);
    const result = await apply({ stage: 'archive', application_refs: [GHOSTED] });
    expect(!result.ok && result.error).toContain('already closed and off the board (1 ghosted)');
    expect(events()).toHaveLength(0);
  });

  it('refuses roles that are not the person\'s, and changes nothing', async () => {
    for (const id of [PLANNER, THEIRS]) seen.add(`job_search.applications:${id}`);
    const result = await apply({ stage: 'archive', application_refs: [PLANNER, THEIRS] });
    expect(!result.ok && result.error).toContain('not a role of theirs');
    expect(app(PLANNER).status_manual_override).toBe('submitted');
    expect(events()).toHaveLength(0);
  });

  it('refuses roles no lookup returned', async () => {
    const result = await apply({ stage: 'archive', role_refs: [R_PLANNER] });
    expect(!result.ok && result.error).toContain('No lookup in this conversation returned job_search.roles');
  });

  it('has no ghosted and no delete', async () => {
    seen.add(`job_search.applications:${PLANNER}`);
    for (const stage of ['ghosted', 'delete']) {
      const result = await apply({ stage, application_refs: [PLANNER] });
      expect(!result.ok && result.error).toContain('deleting roles is done on the pipeline');
    }
    expect(events()).toHaveLength(0);
  });

  it(`refuses more than ${BULK_MAX} roles at once`, async () => {
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    for (const id of many) seen.add(`job_search.applications:${id}`);
    const result = await apply({ stage: 'archive', application_refs: many });
    expect(!result.ok && result.error).toContain(`At most ${BULK_MAX} roles`);
  });

  it('refuses while Jobs is switched off', async () => {
    seen.add(`job_search.applications:${PLANNER}`);
    const result = await apply({ stage: 'archive', application_refs: [PLANNER] }, context(['shopping']));
    expect(!result.ok && result.error).toContain('Jobs workspace is switched off');
  });
});
