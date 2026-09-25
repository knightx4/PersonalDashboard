import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  LINK_COLUMNS,
  READ_CARD_STATUSES,
  toLink,
  type GoalLinks,
  type JobWeek,
  type Link,
  type LinkKind,
  type LinkRow,
  type LinkedAim,
  type LinkedJob,
} from '@/lib/goals/links';
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
): Promise<boolean> {
  const item = await client.from('items').select('id').eq('id', itemId).is('archived_at', null);
  if (item.error) throw new Error(item.error.message);
  if ((item.data ?? []).length === 0) return false;

  let existing = client.from('links').select('id, archived_at').eq('item_id', itemId).eq('kind', kind);
  existing = targetId === null ? existing.is('target_id', null) : existing.eq('target_id', targetId);
  const found = await existing.maybeSingle();
  if (found.error) throw new Error(found.error.message);

  const row = found.data as { id: string; archived_at: string | null } | null;
  if (row) {
    if (row.archived_at === null) return true;
    const { error } = await client.from('links').update({ archived_at: null }).eq('id', row.id);
    if (error?.code === '23514') return false;
    if (error) throw new Error(error.message);
    return true;
  }

  const { error } = await client
    .from('links')
    .insert({ user_id: userId, item_id: itemId, kind, target_id: targetId });
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

async function readAims(learn: LearnSupabaseClient, links: Link[]): Promise<LinkedAim[]> {
  const ids = links.flatMap((link) => (link.targetId ? [link.targetId] : []));
  if (ids.length === 0) return [];

  const [aims, cards] = await Promise.all([
    learn.from('aims').select('id, name, list_source, archived_at, subject_id').in('id', ids),
    learn
      .from('feed_cards')
      .select('aim_id, status')
      .in('aim_id', ids)
      .in('status', READ_CARD_STATUSES as unknown as string[]),
  ]);
  if (aims.error) throw new Error(`Could not read the Learn goals: ${aims.error.message}`);
  if (cards.error) throw new Error(`Could not read the Learn cards: ${cards.error.message}`);

  type AimRow = {
    id: string;
    name: string;
    list_source: string | null;
    archived_at: string | null;
    subject_id: string | null;
  };
  const byId = new Map(((aims.data ?? []) as AimRow[]).map((row) => [row.id, row]));

  // An open goal's cards are its track's lessons (plan #972), which carry the
  // track rather than the goal.
  const aimOfTrack = new Map<string, string>();
  for (const row of byId.values()) if (row.subject_id) aimOfTrack.set(row.subject_id, row.id);
  const lessons =
    aimOfTrack.size === 0
      ? { data: [], error: null }
      : await learn
          .from('feed_cards')
          .select('subject_id, status')
          .in('subject_id', [...aimOfTrack.keys()])
          .in('reason', ['lesson', 'unit_check'])
          .in('status', READ_CARD_STATUSES as unknown as string[]);
  if (lessons.error) throw new Error(`Could not read the Learn lessons: ${lessons.error.message}`);
  const trackCards = ((lessons.data ?? []) as { subject_id: string; status: string }[]).map((card) => ({
    aim_id: aimOfTrack.get(card.subject_id)!,
    status: card.status,
  }));
  const level3 = [...byId.values()].some((row) => row.list_source === 'level3')
    ? await loadLevel3Counts(learn)
    : null;

  const read = new Map<string, number>();
  const saved = new Map<string, number>();
  for (const card of [...((cards.data ?? []) as { aim_id: string; status: string }[]), ...trackCards]) {
    read.set(card.aim_id, (read.get(card.aim_id) ?? 0) + 1);
    if (card.status === 'saved') saved.set(card.aim_id, (saved.get(card.aim_id) ?? 0) + 1);
  }

  return links.flatMap((link) => {
    if (!link.targetId) return [];
    const row = byId.get(link.targetId);
    return {
      linkId: link.id,
      aimId: link.targetId,
      name: row?.name ?? null,
      archived: row?.archived_at != null,
      level3: row?.list_source === 'level3' ? level3 : null,
      cardsRead: read.get(link.targetId) ?? 0,
      cardsSaved: saved.get(link.targetId) ?? 0,
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
