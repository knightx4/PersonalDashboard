import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { WaitingKind, WorkRun } from '@/lib/goals/goal-files-tab';

/**
 * Reads and writes for a goal's Work & files tab (plan #2778.7). What they
 * mean is worked out in lib/goals/goal-files-tab.ts; this only moves rows.
 * Every call runs on the person's own session, so row level security decides
 * whose rows are seen and nothing here passes a user id but the one a new
 * row is written with.
 */

export type StepLike = { id: string; title: string; status: string; collectionId?: string | null };

const OPEN = (status: string) => status !== 'done' && status !== 'dropped';

/**
 * The documents the goal's open steps wait for: kinds that belong to an open
 * step (migration 0093), and the kinds of the form on an open information
 * step (migration 0056). A kind on a closed step waits for nothing.
 */
export async function loadWaitingKinds(
  goals: GoalsSupabaseClient,
  steps: readonly StepLike[],
): Promise<WaitingKind[]> {
  const open = steps.filter((step) => OPEN(step.status));
  if (open.length === 0) return [];
  const byId = new Map(open.map((step) => [step.id, step]));
  const byCollection = new Map<string, StepLike>();
  for (const step of open) if (step.collectionId) byCollection.set(step.collectionId, step);

  const filters = [`item_id.in.(${[...byId.keys()].join(',')})`];
  if (byCollection.size > 0) filters.push(`collection_id.in.(${[...byCollection.keys()].join(',')})`);
  const { data, error } = await goals
    .from('document_kinds')
    .select('id, name, recognise, item_id, collection_id')
    .is('archived_at', null)
    .or(filters.join(','))
    .order('created_at');
  if (error) throw new Error(`Could not read what the goal is waiting for: ${error.message}`);
  type Row = { id: string; name: string; recognise: string; item_id: string | null; collection_id: string | null };
  return ((data ?? []) as Row[]).flatMap((row) => {
    const step = (row.item_id && byId.get(row.item_id)) || (row.collection_id && byCollection.get(row.collection_id));
    if (!step) return [];
    return [{ kindId: row.id, name: row.name, recognise: row.recognise, stepId: step.id, stepTitle: step.title }];
  });
}

type RunRow = {
  id: string;
  job: string;
  item_id: string | null;
  status: WorkRun['status'];
  created_at: string;
  ended_at: string | null;
  summary: string | null;
  error: string | null;
  last_seen_at: string | null;
  now_on: string | null;
  question: string | null;
  origin: WorkRun['origin'];
};

/** How many pieces of work the tab lists, newest first. */
export const WORK_SHOWN = 40;

/** Every run on the goal and its steps, newest first. */
export async function loadGoalWork(
  goals: GoalsSupabaseClient,
  itemIds: readonly string[],
): Promise<WorkRun[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await goals
    .from('runs')
    .select('id, job, item_id, status, created_at, ended_at, summary, error, last_seen_at, now_on, question, origin')
    .in('item_id', [...new Set(itemIds)])
    .order('created_at', { ascending: false })
    .limit(WORK_SHOWN);
  if (error) throw new Error(`Could not read Dash's work on the goal: ${error.message}`);
  return ((data ?? []) as RunRow[]).map((row) => ({
    id: row.id,
    job: row.job,
    itemId: row.item_id,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    summary: row.summary,
    error: row.error,
    lastSeenAt: row.last_seen_at,
    nowOn: row.now_on,
    question: row.question,
    origin: row.origin,
  }));
}

/**
 * Keep a file the person added: a row in core.files pointing at the upload
 * (migration 0290), linked from the step it belongs to, or the goal, with the
 * kind it fills. Returns the new file's id.
 */
export async function addGoalUpload(
  core: CoreSupabaseClient,
  goals: GoalsSupabaseClient,
  userId: string,
  input: {
    itemId: string;
    title: string;
    path: string;
    contentType: string;
    sizeBytes: number;
    kindId: string | null;
  },
): Promise<string> {
  const { data, error } = await core
    .from('files')
    .insert({
      user_id: userId,
      title: input.title,
      body: '',
      made_by: 'you',
      origin: `goals.items:${input.itemId}`,
      storage_path: input.path,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not keep the file: ${error?.message ?? 'no row'}`);
  const fileId = (data as { id: string }).id;
  const { error: linkError } = await goals.from('links').insert({
    user_id: userId,
    item_id: input.itemId,
    kind: 'file',
    target_id: fileId,
    document_kind_id: input.kindId,
  });
  if (linkError) throw new Error(`Could not put the file on the goal: ${linkError.message}`);
  return fileId;
}

/**
 * The goal's own steps at every depth, for placing a file you add. Every live
 * item is read and walked down from the goal: a person's goals run to
 * hundreds of rows, as loadGoalMap reads them. Null when it is not a live goal.
 */
export async function loadGoalSteps(
  goals: GoalsSupabaseClient,
  goalId: string,
): Promise<StepLike[] | null> {
  const { data, error } = await goals
    .from('items')
    .select('id, title, status, level, parent_id, collection_id')
    .is('archived_at', null);
  if (error) throw new Error(`Could not read the goal's steps: ${error.message}`);
  type Row = {
    id: string;
    title: string;
    status: string;
    level: string;
    parent_id: string | null;
    collection_id: string | null;
  };
  const rows = (data ?? []) as Row[];
  if (!rows.some((row) => row.id === goalId && row.level === 'goal')) return null;
  const children = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = children.get(row.parent_id) ?? [];
    list.push(row);
    children.set(row.parent_id, list);
  }
  const out: StepLike[] = [];
  const walk = (id: string, depth: number) => {
    if (depth > 12) return;
    for (const child of children.get(id) ?? []) {
      if (child.level === 'goal') continue;
      out.push({ id: child.id, title: child.title, status: child.status, collectionId: child.collection_id });
      walk(child.id, depth + 1);
    }
  };
  walk(goalId, 0);
  return out;
}

/** Pin a file to the top of its goal's files, or unpin it. */
export async function setFilePinned(core: CoreSupabaseClient, fileId: string, pinned: boolean): Promise<boolean> {
  const { data, error } = await core
    .from('files')
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq('id', fileId)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Rename a file. A new title is a new version, as any edit of one is. */
export async function renameFile(core: CoreSupabaseClient, fileId: string, title: string): Promise<boolean> {
  const { data, error } = await core
    .from('files')
    .update({ title, change_note: 'Renamed.' })
    .eq('id', fileId)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Take a file off a goal: archive its links from the goal and the given
 * steps. The file itself stays, under Files for every goal, and the links
 * can be restored from the history.
 */
export async function removeFileFromGoal(
  goals: GoalsSupabaseClient,
  fileId: string,
  itemIds: readonly string[],
): Promise<number> {
  if (itemIds.length === 0) return 0;
  const { data, error } = await goals
    .from('links')
    .update({ archived_at: new Date().toISOString() })
    .eq('kind', 'file')
    .eq('target_id', fileId)
    .in('item_id', [...new Set(itemIds)])
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
