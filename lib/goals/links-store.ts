import 'server-only';

import type { SchemaClient } from '@/lib/ask/db';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  LINK_COLUMNS,
  LISTED_KINDS,
  groupLists,
  isListedKind,
  linkedHref,
  listNameOf,
  toLink,
  type GoalLinks,
  type JobWeek,
  type Link,
  type LinkKind,
  type LinkRow,
  type LinkedAim,
  type LinkedJob,
  type LinkedList,
  type LinkedRow,
  type ListedKind,
  type LensProgressView,
  type SubjectPreparation,
} from '@/lib/goals/links';
import { listLenses, loadTopicNames } from '@/lib/learn/levels/lens-store';
import { lensProgress, readCells } from '@/lib/learn/levels/model';
import { loadTopicMap } from '@/lib/learn/levels/store';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { statusLabel } from '@/lib/jobs/status-label';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { loadActiveAims, loadLevel3Counts } from '@/lib/learn/aims-store';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Reads and writes of goals.links, and the live reads of what the links point
 * at (plan #931). Every client here is the person's own session, so Learn's
 * and the job search's row level security decide what is seen. Nothing in
 * this file writes to learn or job_search.
 */

/** The live links of one goal or step, oldest first. */
export async function loadLinks(client: GoalsSupabaseClient, itemId: string): Promise<Link[]> {
  const { data, error } = await client
    .from('links')
    .select(LINK_COLUMNS)
    .eq('item_id', itemId)
    .is('archived_at', null)
    .order('created_at');
  if (error) throw new Error(`Could not read the links: ${error.message}`);
  return ((data ?? []) as LinkRow[]).flatMap((row) => toLink(row) ?? []);
}

/**
 * Link a live goal or step to a target, or bring back the link it had. False
 * when the item is not live, or the target is not one of the person's own
 * (the database's check refuses it).
 */
export async function linkTarget(
  client: GoalsSupabaseClient,
  userId: string,
  itemId: string,
  kind: LinkKind,
  targetId: string | null,
  /**
   * The list it goes in (plan #2330.1): a name, null for the kind's own list,
   * or left out to keep the list a link already had. A live link given
   * another name moves to that list.
   */
  listName?: string | null,
): Promise<boolean> {
  const item = await client.from('items').select('id').eq('id', itemId).is('archived_at', null);
  if (item.error) throw new Error(item.error.message);
  if ((item.data ?? []).length === 0) return false;

  let existing = client.from('links').select('id, archived_at, list_name').eq('item_id', itemId).eq('kind', kind);
  existing = targetId === null ? existing.is('target_id', null) : existing.eq('target_id', targetId);
  const found = await existing.maybeSingle();
  if (found.error) throw new Error(found.error.message);

  const row = found.data as { id: string; archived_at: string | null; list_name: string | null } | null;
  if (row) {
    const rename = listName !== undefined && (row.list_name ?? null) !== listName;
    if (row.archived_at === null && !rename) return true;
    const change: Record<string, unknown> = {};
    if (row.archived_at !== null) change.archived_at = null;
    if (rename) change.list_name = listName;
    const { error } = await client.from('links').update(change).eq('id', row.id);
    if (error?.code === '23514') return false;
    if (error) throw new Error(error.message);
    return true;
  }

  const { error } = await client
    .from('links')
    .insert({ user_id: userId, item_id: itemId, kind, target_id: targetId, ...(listName ? { list_name: listName } : {}) });
  if (error?.code === '23514') return false;
  // A second press racing the first: the row is there, which is what was asked.
  if (error?.code === '23505') return true;
  if (error) throw new Error(error.message);
  return true;
}

/** Unlink by archiving the row. False when it was already gone. */
export async function unlinkTarget(client: GoalsSupabaseClient, linkId: string): Promise<boolean> {
  const { data, error } = await client
    .from('links')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', linkId)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** The Learn aims a goal could link, for the picker. */
export async function loadAimChoices(
  learn: LearnSupabaseClient,
): Promise<{ id: string; name: string }[]> {
  const aims = await loadActiveAims(learn);
  return aims.map((aim) => ({ id: aim.id, name: aim.name }));
}

type AimRow = {
  id: string;
  name: string;
  list_source: string | null;
  archived_at: string | null;
  subject_id: string | null;
  goal_id: string | null;
};

/** The subjects' preparation runs, by subject id; a subject with none is absent. */
async function readPreparations(
  learn: LearnSupabaseClient,
  subjectIds: string[],
): Promise<Map<string, SubjectPreparation>> {
  const out = new Map<string, SubjectPreparation>();
  if (subjectIds.length === 0) return out;
  const { data, error } = await learn
    .from('subject_preparations')
    .select('subject_id, status')
    .in('subject_id', subjectIds)
    .is('branch_key', null);
  if (error) throw new Error(`Could not read the preparations: ${error.message}`);
  for (const row of (data ?? []) as { subject_id: string; status: string }[]) {
    out.set(row.subject_id, row.status === 'done' ? 'done' : row.status === 'failed' ? 'failed' : 'working');
  }
  return out;
}

/** The subjects' lenses summed per kind of evidence, over the approved topics, by subject id. */
async function readLenses(
  learn: LearnSupabaseClient,
  subjectIds: string[],
): Promise<Map<string, LensProgressView>> {
  const out = new Map<string, LensProgressView>();
  if (subjectIds.length === 0) return out;
  const [lenses, map, names] = await Promise.all([listLenses(learn), loadTopicMap(learn), loadTopicNames(learn)]);
  const readings = readCells(map);
  for (const lens of lenses) {
    if (!lens.subjectId || !subjectIds.includes(lens.subjectId)) continue;
    const approved = lens.targets.filter((target) => names.get(target.topicId)?.approved);
    if (approved.length === 0) continue;
    const progress = lensProgress(map, readings, approved);
    out.set(lens.subjectId, {
      topics: approved.length,
      tested: progress.held.tested,
      inferred: progress.held.inferred,
      declared: progress.held.declared,
      total: progress.total,
    });
  }
  return out;
}

/**
 * The title of the first piece not yet passed in each subject's plan, in
 * unit and piece order, by subject id (the order today's piece reads). A
 * piece whose check was answered right counts as finished.
 */
async function readNextPieces(learn: LearnSupabaseClient, subjectIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (subjectIds.length === 0) return out;
  const [units, pieces] = await Promise.all([
    learn.from('curriculum_units').select('id, subject_id, ordinal').in('subject_id', subjectIds),
    learn
      .from('plan_pieces')
      .select('id, unit_id, subject_id, ordinal, title, passed_at')
      .in('subject_id', subjectIds)
      .is('passed_at', null),
  ]);
  if (units.error) throw new Error(`Could not read the units: ${units.error.message}`);
  if (pieces.error) throw new Error(`Could not read the pieces: ${pieces.error.message}`);
  type PieceRow = { id: string; unit_id: string; subject_id: string; ordinal: number; title: string };
  const open = (pieces.data ?? []) as PieceRow[];
  if (open.length === 0) return out;
  const checks = await learn
    .from('piece_checks')
    .select('piece_id')
    .eq('correct', true)
    .in('piece_id', open.map((piece) => piece.id));
  if (checks.error) throw new Error(`Could not read the checks: ${checks.error.message}`);
  const checked = new Set(((checks.data ?? []) as { piece_id: string }[]).map((row) => row.piece_id));
  const unitOrdinal = new Map(((units.data ?? []) as { id: string; ordinal: number }[]).map((u) => [u.id, u.ordinal]));
  const ordered = open
    .filter((piece) => !checked.has(piece.id))
    .sort((a, b) => (unitOrdinal.get(a.unit_id) ?? 0) - (unitOrdinal.get(b.unit_id) ?? 0) || a.ordinal - b.ordinal);
  for (const piece of ordered) if (!out.has(piece.subject_id)) out.set(piece.subject_id, piece.title);
  return out;
}

/**
 * A linked goal's Learn progress is what its subject's lens says (plan
 * #2302.4): the levels held by a test, by inference and by saying so, the
 * subject's preparation, and the next piece. Cards read no longer count.
 */
async function readAims(learn: LearnSupabaseClient, links: Link[]): Promise<LinkedAim[]> {
  const ids = links.flatMap((link) => (link.targetId ? [link.targetId] : []));
  if (ids.length === 0) return [];

  const aims = await learn
    .from('aims')
    .select('id, name, list_source, archived_at, subject_id, goal_id')
    .in('id', ids);
  if (aims.error) throw new Error(`Could not read the Learn goals: ${aims.error.message}`);
  const byId = new Map(((aims.data ?? []) as AimRow[]).map((row) => [row.id, row]));

  const subjectIds = [
    ...new Set([...byId.values()].flatMap((row) => (row.subject_id && row.list_source !== 'level3' ? [row.subject_id] : []))),
  ];
  const level3 = [...byId.values()].some((row) => row.list_source === 'level3')
    ? await loadLevel3Counts(learn)
    : null;
  const [preparations, lenses, pieces] = await Promise.all([
    readPreparations(learn, subjectIds),
    readLenses(learn, subjectIds),
    readNextPieces(learn, subjectIds),
  ]);

  return links.flatMap((link) => {
    if (!link.targetId) return [];
    const row = byId.get(link.targetId);
    const subjectId = row?.subject_id ?? null;
    return {
      linkId: link.id,
      aimId: link.targetId,
      name: row?.name ?? null,
      goalId: row?.goal_id ?? null,
      archived: row?.archived_at != null,
      level3: row?.list_source === 'level3' ? level3 : null,
      preparation: (subjectId && preparations.get(subjectId)) || 'none',
      lens: (subjectId && lenses.get(subjectId)) || null,
      nextPiece: (subjectId && pieces.get(subjectId)) || null,
    };
  });
}

/**
 * Applications sent and interviews held or booked in the week. A cancelled or
 * moved interview does not count; the rescheduled one is its own row.
 */
async function readJobWeek(
  jobs: AppSupabaseClient,
  week: { from: string; to: string },
): Promise<JobWeek> {
  const [applied, interviews] = await Promise.all([
    jobs
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .gte('submitted_at', week.from)
      .lt('submitted_at', week.to),
    jobs
      .from('interviews')
      .select('id', { count: 'exact', head: true })
      .in('status', ['scheduled', 'completed'])
      .gte('scheduled_at', week.from)
      .lt('scheduled_at', week.to),
  ]);
  if (applied.error) throw new Error(`Could not count applications: ${applied.error.message}`);
  if (interviews.error) throw new Error(`Could not count interviews: ${interviews.error.message}`);
  return { applied: applied.count ?? 0, interviews: interviews.count ?? 0 };
}

type RoleJoin = { id: string; title: string; companies: { name: string } | null };

async function readJobs(jobs: AppSupabaseClient, links: Link[]): Promise<LinkedJob[]> {
  const roleIds = links.flatMap((l) => (l.kind === 'role' && l.targetId ? [l.targetId] : []));
  const appIds = links.flatMap((l) => (l.kind === 'application' && l.targetId ? [l.targetId] : []));
  if (roleIds.length === 0 && appIds.length === 0) return [];

  const [roles, apps] = await Promise.all([
    roleIds.length > 0
      ? jobs.from('roles').select('id, title, companies ( name )').in('id', roleIds)
      : { data: [], error: null },
    appIds.length > 0
      ? jobs
          .from('applications')
          .select('id, status, submitted_at, roles ( id, title, companies ( name ) )')
          .in('id', appIds)
      : { data: [], error: null },
  ]);
  if (roles.error) throw new Error(`Could not read the roles: ${roles.error.message}`);
  if (apps.error) throw new Error(`Could not read the applications: ${apps.error.message}`);

  const roleById = new Map(((roles.data ?? []) as unknown as RoleJoin[]).map((r) => [r.id, r]));
  type AppJoin = { id: string; status: string; submitted_at: string | null; roles: RoleJoin | null };
  const appById = new Map(((apps.data ?? []) as unknown as AppJoin[]).map((a) => [a.id, a]));

  return links.flatMap((link): LinkedJob[] => {
    if (!link.targetId) return [];
    if (link.kind === 'role') {
      const role = roleById.get(link.targetId);
      return [
        {
          linkId: link.id,
          kind: 'role',
          roleId: role?.id ?? null,
          title: role?.title ?? null,
          company: role?.companies?.name ?? null,
          status: null,
        },
      ];
    }
    if (link.kind === 'application') {
      const app = appById.get(link.targetId);
      return [
        {
          linkId: link.id,
          kind: 'application',
          roleId: app?.roles?.id ?? null,
          title: app?.roles?.title ?? null,
          company: app?.roles?.companies?.name ?? null,
          status: app
            ? statusLabel(app.status as ApplicationStatus, app.submitted_at !== null)
            : null,
        },
      ];
    }
    return [];
  });
}

/** The workspaces a listed kind is read from, by schema. */
const LISTED_SCHEMA: Record<ListedKind, string> = {
  reading: 'learn',
  event: 'todo',
  saved_item: 'public',
  contact: 'job_search',
};

type Target = Record<string, unknown>;

/** The columns each listed kind is read with, and the table they come from. */
const LISTED_READ: Record<ListedKind, { table: string; columns: string }> = {
  reading: { table: 'readings', columns: 'id, title, status, started_at, finished_at' },
  event: { table: 'events', columns: 'id, title, location, starts_on, ends_on, starts_at, ends_at' },
  saved_item: {
    table: 'saved_items',
    columns: 'id, title, url, image_url, price_cents, currency, status, purchased_order_item_id',
  },
  contact: { table: 'contacts', columns: 'id, full_name, title, email, linkedin_url, companies ( name )' },
};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** One link and the row it points at (undefined once that row has gone) as the list shows it. */
export function toLinkedRow(link: Link & { kind: ListedKind; targetId: string }, target: Target | undefined): LinkedRow {
  const gone = target === undefined;
  const t = target ?? {};
  const base = { linkId: link.id, targetId: link.targetId, listName: listNameOf(link), gone };
  switch (link.kind) {
    case 'reading':
      return {
        ...base,
        kind: 'reading',
        href: gone ? null : linkedHref('reading', link.targetId),
        title: text(t.title),
        status: text(t.status),
        startedAt: text(t.started_at),
        finishedAt: text(t.finished_at),
      };
    case 'event': {
      const startsOn = text(t.starts_on);
      const startsAt = text(t.starts_at);
      return {
        ...base,
        kind: 'event',
        href: gone ? null : linkedHref('event', link.targetId, { startsOn, startsAt }),
        title: text(t.title),
        location: text(t.location),
        startsOn,
        endsOn: text(t.ends_on),
        startsAt,
        endsAt: text(t.ends_at),
      };
    }
    case 'saved_item':
      return {
        ...base,
        kind: 'saved_item',
        href: gone ? null : linkedHref('saved_item', link.targetId),
        title: text(t.title),
        url: text(t.url),
        imageUrl: text(t.image_url),
        priceCents: typeof t.price_cents === 'number' ? t.price_cents : null,
        currency: text(t.currency),
        status: text(t.status),
        bought: t.purchased_order_item_id != null,
      };
    case 'contact': {
      const company = t.companies as { name?: unknown } | null | undefined;
      return {
        ...base,
        kind: 'contact',
        href: gone ? null : linkedHref('contact', link.targetId),
        name: text(t.full_name),
        role: text(t.title),
        company: text(company?.name),
        email: text(t.email),
        linkedinUrl: text(t.linkedin_url),
      };
    }
  }
}

/**
 * A goal's or step's lists over rows other workspaces keep (plan #2330.1):
 * its live reading, event, saved product and contact links, each with its
 * row read live from that workspace, grouped into lists by list name.
 *
 * `db` is any client of the person's own session; each workspace is reached
 * through `.schema()`, so its row level security decides what is seen. Only
 * the kinds in `kinds` are read: leave out the kinds of a workspace that is
 * switched off, and their links are left out with them. A row removed from
 * its workspace since it was linked comes back as `gone`.
 */
export async function loadLinkedLists(
  db: SchemaClient,
  itemId: string,
  kinds: readonly ListedKind[] = LISTED_KINDS,
): Promise<LinkedList[]> {
  if (kinds.length === 0) return [];
  const { data, error } = await db
    .schema('goals')
    .from('links')
    .select(LINK_COLUMNS)
    .eq('item_id', itemId)
    .in('kind', [...kinds])
    .is('archived_at', null)
    .order('created_at');
  if (error) throw new Error(`Could not read the lists: ${error.message}`);
  const links = ((data ?? []) as LinkRow[]).flatMap((row) => {
    const link = toLink(row);
    return link && isListedKind(link.kind) && link.targetId
      ? [link as Link & { kind: ListedKind; targetId: string }]
      : [];
  });
  if (links.length === 0) return [];

  const byKind = new Map<ListedKind, Map<string, Target>>();
  await Promise.all(
    kinds.map(async (kind) => {
      const ids = [...new Set(links.filter((link) => link.kind === kind).map((link) => link.targetId))];
      if (ids.length === 0) return;
      const read = LISTED_READ[kind];
      const rows = await db.schema(LISTED_SCHEMA[kind]).from(read.table).select(read.columns).in('id', ids);
      if (rows.error) throw new Error(`Could not read the linked ${read.table}: ${rows.error.message}`);
      byKind.set(kind, new Map(((rows.data ?? []) as unknown as Target[]).map((row) => [row.id as string, row])));
    }),
  );

  return groupLists(links.map((link) => toLinkedRow(link, byKind.get(link.kind)?.get(link.targetId))));
}

/**
 * What a goal's links point at, read live from Learn and the job search.
 * A module that is switched off is not read: its links are left out.
 */
export async function loadGoalLinks(
  clients: { goals: GoalsSupabaseClient; learn: LearnSupabaseClient | null; jobs: AppSupabaseClient | null },
  itemId: string,
  week: { from: string; to: string },
): Promise<GoalLinks> {
  const links = await loadLinks(clients.goals, itemId);
  const search = links.find((link) => link.kind === 'job_search') ?? null;
  const { learn, jobs } = clients;

  const [aims, jobWeek, jobRows] = await Promise.all([
    learn ? readAims(learn, links.filter((link) => link.kind === 'aim')) : [],
    jobs && search ? readJobWeek(jobs, week) : null,
    jobs ? readJobs(jobs, links) : [],
  ]);

  return {
    aims,
    jobSearch: jobs && search ? { linkId: search.id, week: jobWeek } : null,
    jobs: jobRows,
  };
}
