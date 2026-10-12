import type { AskDb } from '@/lib/ask/db';
import { isUuid } from '@/lib/ask/db';
import { namedItems } from '@/lib/ask/change-view';
import { readSubject } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import { stageMoveEvent } from '@/lib/jobs/move';
import { isTerminal, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { statusLabel } from '@/lib/jobs/status-label';
import type { DashChangeInput } from '@/lib/talk/changes';
import { BULK_MAX } from './bulk-items';
import type { DashWriteContext, DashWriteResult } from './registry';

/**
 * Dash moving many job roles at once (plan #1657, feature #1653): the
 * move_roles write, beside change_items (lib/dash/bulk-items.ts). The person
 * names a rule ("archive every role I applied to before August with no
 * reply") and Dash finds the rows with its lookups; each role's application
 * is moved the way the board moves a card, a status_override event built by
 * lib/jobs/move.ts plus the override column, so its history reads the same.
 *
 * The change is one core.dash_actions record. Its `undo.rows` keeps, for
 * every application it moved, the override before and after and the event
 * Dash wrote, so one Undo takes the whole move back. The board's moment for
 * a role moving forward plays on a drag only, so nothing plays here.
 *
 * Archive closes the application as withdrawn: the board's own "closed" is
 * one of rejected, withdrawn, ghosted or role closed, ghosted is worked out
 * from silence and cannot be set, and withdrawn is the one that says you
 * stopped pursuing it. One already closed is left as it is, ghosted
 * included: the funnel counts ghosted as no answer (lib/jobs/pipeline.ts),
 * and rewriting it as withdrawn would say you pulled out instead.
 *
 * Deleting is not a stage: a delete cannot be undone from a reply, so it
 * stays on the pipeline's own buttons.
 */

/** The stages Dash may move a role to, by the name Dash sends. */
export const ROLE_STAGES = [
  'lead',
  'drafting',
  'submitted',
  'in_process',
  'final_round',
  'offer',
  'rejected',
  'withdrawn',
  'role_closed',
  'archive',
] as const;
export type RoleStage = (typeof ROLE_STAGES)[number];

/** The status each stage writes. Submitted is the board's column, which sets acknowledged. */
const WRITES: Record<RoleStage, ApplicationStatus> = {
  lead: 'lead',
  drafting: 'drafting',
  submitted: 'acknowledged',
  in_process: 'in_process',
  final_round: 'final_round',
  offer: 'offer',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  role_closed: 'role_closed',
  archive: 'withdrawn',
};

/** One application the move changed: the override before and after, and the event Dash wrote. */
export type MovedRole = {
  id: string;
  role_id: string;
  event_id: string;
  before: { status_manual_override: ApplicationStatus | null };
  after: { status_manual_override: ApplicationStatus };
};

const APPLICATIONS = 'job_search.applications';
const ROLES = 'job_search.roles';
/** How many roles the card and the summary name before "and N more". */
const NAMED = 3;

type ApplicationRow = {
  id: string;
  role_id: string;
  attempt: number;
  status: ApplicationStatus;
  status_manual_override: ApplicationStatus | null;
};

const refuse = (error: string): DashWriteResult => ({ ok: false, error });
const noun = (count: number) => (count === 1 ? 'role' : 'roles');

function refList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return null;
  return [...new Set((value as string[]).map((v) => v.trim()).filter(Boolean))];
}

/** A stage as the pipeline names it: "In process", "Submitted", "Role closed". */
export function stageLabel(stage: Exclude<RoleStage, 'archive'>): string {
  return statusLabel(WRITES[stage]);
}

/** "archived 3 roles", "moved 3 roles to In process". */
function didWords(stage: RoleStage, count: number): string {
  const roles = `${count} ${noun(count)}`;
  return stage === 'archive' ? `archived ${roles}` : `moved ${roles} to ${stageLabel(stage)}`;
}

/** Whether this application is already where the stage would put it. */
function alreadyThere(stage: RoleStage, status: ApplicationStatus): boolean {
  if (stage === 'archive') return isTerminal(status);
  if (stage === 'submitted') return status === 'submitted' || status === 'acknowledged';
  return status === WRITES[stage];
}

async function readIn<T>(
  client: Awaited<ReturnType<AskDb>>,
  table: string,
  select: string,
  column: string,
  values: string[],
  userId: string,
): Promise<T[]> {
  if (values.length === 0) return [];
  const { data, error } = await client.from(table).select(select).eq('user_id', userId).in(column, values);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

/**
 * Move many roles to one stage, or archive them. Never throws for a request
 * it refuses: the refusal comes back as the sentence Dash says.
 */
export async function moveRoles(ctx: DashWriteContext, args: Record<string, unknown>): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('jobs')) {
    return refuse('The Jobs workspace is switched off, so nothing can be changed there.');
  }
  const stage = typeof args.stage === 'string' ? (args.stage.trim() as RoleStage) : null;
  if (!stage || !ROLE_STAGES.includes(stage)) {
    return refuse(
      `stage must be one of ${ROLE_STAGES.join(', ')}. Ghosted is worked out from silence and cannot be set, and deleting roles is done on the pipeline, not by Dash.`,
    );
  }
  const roleRefs = refList(args.role_refs);
  const applicationRefs = refList(args.application_refs);
  if (!roleRefs || !applicationRefs) return refuse('role_refs and application_refs are lists of refs.');
  if (roleRefs.length + applicationRefs.length === 0) {
    return refuse('Name the roles by role_refs or application_refs.');
  }
  if (roleRefs.length + applicationRefs.length > BULK_MAX) {
    return refuse(`At most ${BULK_MAX} roles can be moved at once. Ask them to narrow it down.`);
  }
  const unseen = [
    ...roleRefs.filter((ref) => !isUuid(ref) || !ctx.seen(ROLES, ref)).map((ref) => `${ROLES} ${ref}`),
    ...applicationRefs
      .filter((ref) => !isUuid(ref) || !ctx.seen(APPLICATIONS, ref))
      .map((ref) => `${APPLICATIONS} ${ref}`),
  ];
  if (unseen.length > 0) {
    return refuse(
      `No lookup in this conversation returned ${unseen.slice(0, 3).join(', ')}. Look them up first and use the refs they give.`,
    );
  }

  const jobs = await ctx.db('job_search');
  const select = 'id, role_id, attempt, status, status_manual_override';

  // A role is moved by its latest application, the one the board shows.
  const byRole = await readIn<ApplicationRow>(jobs, 'applications', select, 'role_id', roleRefs, ctx.userId);
  const latest = new Map<string, ApplicationRow>();
  for (const row of byRole) {
    const held = latest.get(row.role_id);
    if (!held || row.attempt > held.attempt) latest.set(row.role_id, row);
  }
  const missingRoles = roleRefs.filter((ref) => !latest.has(ref)).length;
  const named = await readIn<ApplicationRow>(jobs, 'applications', select, 'id', applicationRefs, ctx.userId);
  const missing = missingRoles + (applicationRefs.length - named.length);
  if (missing > 0) {
    return refuse(
      `${missing} of those ${missing === 1 ? 'is not a role' : 'are not roles'} of theirs with an application, so nothing was changed.`,
    );
  }

  // In the order named, without the same application twice.
  const applications: ApplicationRow[] = [];
  const taken = new Set<string>();
  for (const row of [...roleRefs.map((ref) => latest.get(ref)!), ...applicationRefs.map((ref) => named.find((a) => a.id === ref)!)]) {
    if (taken.has(row.id)) continue;
    taken.add(row.id);
    applications.push(row);
  }

  const status = WRITES[stage];
  const moving = applications.filter((row) => !alreadyThere(stage, row.status));
  if (moving.length === 0) {
    if (stage !== 'archive') {
      return refuse(`All ${applications.length} ${noun(applications.length)} are already there, so nothing was changed.`);
    }
    // Say which kinds of closed, so "ghosted" is not read as Dash doing nothing.
    const counts = new Map<string, number>();
    for (const row of applications) {
      const label = statusLabel(row.status).toLowerCase();
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const kinds = [...counts].map(([label, n]) => `${n} ${label}`).join(', ');
    return refuse(
      `All ${applications.length} ${noun(applications.length)} are already closed and off the board (${kinds}), so nothing was changed. Ghosted ones stay ghosted so the funnel counts them as no answer.`,
    );
  }

  // The board's move, for each: the event, then the override column.
  const at = new Date().toISOString();
  const { data: events, error: eventError } = await jobs
    .from('application_events')
    .insert(moving.map((row) => stageMoveEvent(ctx.userId, row.id, status, 'Dash', at)))
    .select('id, application_id');
  if (eventError) throw new Error(`application_events: ${eventError.message}`);
  const eventOf = new Map(((events ?? []) as { id: string; application_id: string }[]).map((e) => [e.application_id, e.id]));

  const { data: updated, error: writeError } = await jobs
    .from('applications')
    .update({ status_manual_override: status })
    .eq('user_id', ctx.userId)
    .in('id', moving.map((row) => row.id))
    .select('id');
  if (writeError) throw new Error(`applications: ${writeError.message}`);
  const written = new Set(((updated ?? []) as { id: string }[]).map((row) => row.id));

  const rows: MovedRole[] = moving
    .filter((row) => written.has(row.id) && eventOf.has(row.id))
    .map((row) => ({
      id: row.id,
      role_id: row.role_id,
      event_id: eventOf.get(row.id)!,
      before: { status_manual_override: row.status_manual_override },
      after: { status_manual_override: status },
    }));
  if (rows.length === 0) return refuse('Those roles could not be moved, so nothing was changed.');

  // Each named as the pipeline names it: the title, and the company when there is one.
  const roles = await readIn<{ id: string; title: string; company_id: string | null }>(
    jobs,
    'roles',
    'id, title, company_id',
    'id',
    rows.slice(0, NAMED).map((row) => row.role_id),
    ctx.userId,
  );
  const companies = await readIn<{ id: string; name: string }>(
    jobs,
    'companies',
    'id, name',
    'id',
    roles.map((r) => r.company_id).filter((id): id is string => id !== null),
    ctx.userId,
  );
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const companyById = new Map(companies.map((c) => [c.id, c.name]));
  const titles = rows.slice(0, NAMED).map((row) => {
    const role = roleById.get(row.role_id);
    const company = role?.company_id ? companyById.get(role.company_id) : undefined;
    return `${role?.title ?? 'A role'}${company ? ` at ${company}` : ''}`;
  });

  const left = applications.length - rows.length;
  const firstRef = toRef(APPLICATIONS, rows[0].id);
  const subjectAfter = await readSubject(ctx.db, firstRef);
  const subjectBefore = { ...(subjectAfter ?? {}), ...rows[0].before };
  const input: DashChangeInput['move_roles'] = { stage, status, count: rows.length, titles, left };

  return {
    ok: true,
    kind: 'move_roles',
    input: input as unknown as Record<string, unknown>,
    subjectRef: firstRef,
    op: 'update',
    before: subjectBefore,
    after: subjectAfter,
    undo: { rows } as unknown as Record<string, unknown>,
    summary:
      `Dash ${didWords(stage, rows.length)}: ${namedItems(titles, rows.length)}.` +
      (left > 0
        ? ` ${left} ${left === 1 ? 'was' : 'were'} left as ${left === 1 ? 'it was' : 'they were'}, already ${stage === 'archive' ? 'closed' : 'there'}.`
        : ''),
    row: { table: APPLICATIONS, ref: rows[0].id, title: `${rows.length} ${noun(rows.length)}`, href: '/jobs/pipeline' },
  };
}

/** Whether a record's `undo` is move_roles' shape. */
function roleUndo(value: Record<string, unknown> | null): MovedRole[] | null {
  const rows = value?.rows;
  if (!Array.isArray(rows)) return null;
  const ok = rows.every(
    (r) =>
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.event_id === 'string' &&
      r.before &&
      typeof r.before === 'object' &&
      r.after &&
      typeof r.after?.status_manual_override === 'string',
  );
  return ok ? (rows as MovedRole[]) : null;
}

/**
 * Put back every application a move_roles record moved, where it still holds
 * the stage Dash set: the override goes back to what it was and the event
 * Dash wrote is taken out of its history, so the status is worked out again
 * as it was before. One moved on since is left alone, so a later move by
 * hand is never lost. Refused only when none could be put back.
 */
export async function undoRoleMove(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number; roleIds: string[] } | { ok: false; error: string }> {
  const rows = roleUndo(recorded);
  if (!rows || rows.length === 0) {
    return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  }
  const jobs = await deps.db('job_search');

  // One write per pair of values, narrowed to the applications still as Dash left them.
  const batches = new Map<string, { before: ApplicationStatus | null; after: ApplicationStatus; rows: MovedRole[] }>();
  for (const row of rows) {
    const before = row.before.status_manual_override ?? null;
    const after = row.after.status_manual_override;
    const key = JSON.stringify([before, after]);
    const batch = batches.get(key) ?? { before, after, rows: [] };
    batch.rows.push(row);
    batches.set(key, batch);
  }
  const restored = new Set<string>();
  for (const batch of batches.values()) {
    const { data, error } = await jobs
      .from('applications')
      .update({ status_manual_override: batch.before })
      .eq('user_id', deps.userId)
      .eq('status_manual_override', batch.after)
      .in('id', batch.rows.map((row) => row.id))
      .select('id');
    if (error) throw new Error(`applications: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) restored.add(row.id);
  }
  if (restored.size === 0) {
    return {
      ok: false,
      error: 'Every one of those roles has moved since Dash moved it, so undoing would lose the later moves.',
    };
  }

  const back = rows.filter((row) => restored.has(row.id));
  const { error: eventError } = await jobs
    .from('application_events')
    .delete()
    .eq('user_id', deps.userId)
    .eq('kind', 'status_override')
    .in('id', back.map((row) => row.event_id));
  if (eventError) throw new Error(`application_events: ${eventError.message}`);

  return { ok: true, restored: back.length, roleIds: back.map((row) => row.role_id) };
}
