import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { LinkedFile } from '@/lib/files/files';
import { loadListingsById } from '@/lib/files/store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * The files goals and steps link to (goals.links, kind 'file'; migrations-goals
 * /0044). The link is in goals and the file in core, and PostgREST cannot
 * join across schemas, so each side is read with its own client and the two
 * are put together here. A link whose file has been archived is left out.
 */

type FileLinkRow = { id: string; item_id: string; target_id: string };

/** For each of the given goals and steps, the files it links to, oldest link first. */
export async function loadFilesOf(
  goals: GoalsSupabaseClient,
  core: CoreSupabaseClient,
  itemIds: readonly string[],
): Promise<Record<string, LinkedFile[]>> {
  const out: Record<string, LinkedFile[]> = {};
  if (itemIds.length === 0) return out;
  const { data, error } = await goals
    .from('links')
    .select('id, item_id, target_id')
    .eq('kind', 'file')
    .in('item_id', [...new Set(itemIds)])
    .is('archived_at', null)
    .order('created_at');
  if (error) throw new Error(`Could not read the linked files: ${error.message}`);
  const rows = (data ?? []) as FileLinkRow[];
  const files = await loadListingsById(
    core,
    rows.map((row) => row.target_id),
  );
  for (const row of rows) {
    const file = files.get(row.target_id);
    if (!file) continue;
    (out[row.item_id] ??= []).push({
      linkId: row.id,
      fileId: file.id,
      title: file.title,
      summary: file.summary,
      updatedAt: file.updatedAt,
    });
  }
  return out;
}

/** A goal or step that links to a file, for "linked from" on the file's page. */
export type FileUse = {
  itemId: string;
  title: string;
  level: 'goal' | 'step';
  /** The goal it opens under: itself for a goal. */
  goalId: string;
};

type UseItem = { id: string; title: string; level: string; parent_id: string | null };
type UseRow = { item_id: string; items: UseItem | null };

/**
 * The live goals and steps that link to one file. A step opens on its goal's
 * page at its row, so each step's parents are read up to the goal: a few
 * short reads at most, since a tree is rarely more than three deep.
 */
export async function loadFileUses(goals: GoalsSupabaseClient, fileId: string): Promise<FileUse[]> {
  const { data, error } = await goals
    .from('links')
    .select('item_id, items!inner (id, title, level, parent_id)')
    .eq('kind', 'file')
    .eq('target_id', fileId)
    .is('archived_at', null)
    .is('items.archived_at', null)
    .order('created_at');
  if (error) throw new Error(`Could not read where the file is linked: ${error.message}`);
  const items = ((data ?? []) as unknown as UseRow[]).flatMap((row) =>
    row.items ? [row.items] : [],
  );

  // Each step's goal, found by walking parent_id up a level per read.
  const parentOf = new Map<string, UseItem>(items.map((item) => [item.id, item]));
  let missing = items
    .filter((item) => item.level === 'step' && item.parent_id)
    .map((item) => item.parent_id!);
  for (let depth = 0; depth < 8 && missing.length > 0; depth += 1) {
    const { data: parents, error: parentError } = await goals
      .from('items')
      .select('id, title, level, parent_id')
      .in('id', [...new Set(missing)]);
    if (parentError)
      throw new Error(`Could not read where the file is linked: ${parentError.message}`);
    for (const parent of (parents ?? []) as UseItem[]) parentOf.set(parent.id, parent);
    missing = ((parents ?? []) as UseItem[])
      .filter(
        (parent) => parent.level === 'step' && parent.parent_id && !parentOf.has(parent.parent_id),
      )
      .map((parent) => parent.parent_id!);
  }
  const goalOf = (item: UseItem): string | null => {
    let at: UseItem | undefined = item;
    for (let depth = 0; at && depth < 10; depth += 1) {
      if (at.level === 'goal') return at.id;
      at = at.parent_id ? parentOf.get(at.parent_id) : undefined;
    }
    return null;
  };

  return items.flatMap((item) => {
    const goalId = goalOf(item);
    if (!goalId) return [];
    return [
      {
        itemId: item.id,
        title: item.title,
        level: item.level === 'goal' ? 'goal' : 'step',
        goalId,
      },
    ];
  });
}

/**
 * Mark read the unread Dash results of the given steps (note be1ed0d3):
 * opening a file a result links to is reading it. Only a Claude step with a
 * result is touched, as with Mark read; how many were marked.
 */
/**
 * The files still to read (note 29321f82): those linked from a Dash step
 * whose result has not been opened, the same test markStepsRead clears when
 * the file is opened.
 */
export async function loadUnreadFileIds(goals: GoalsSupabaseClient): Promise<Set<string>> {
  const { data, error } = await goals
    .from('links')
    .select('target_id, items!inner (id)')
    .eq('kind', 'file')
    .is('archived_at', null)
    .is('items.archived_at', null)
    .eq('items.kind', 'claude')
    .is('items.reviewed_at', null);
  if (error) throw new Error(`Could not read which files are unread: ${error.message}`);
  return new Set(((data ?? []) as { target_id: string | null }[]).flatMap((row) => (row.target_id ? [row.target_id] : [])));
}

export async function markStepsRead(
  goals: GoalsSupabaseClient,
  stepIds: string[],
): Promise<number> {
  const ids = [...new Set(stepIds)];
  if (ids.length === 0) return 0;
  const { data, error } = await goals
    .from('items')
    .update({ reviewed_at: new Date().toISOString() })
    .in('id', ids)
    .eq('kind', 'claude')
    .is('reviewed_at', null)
    .or('result.not.is.null,result_url.not.is.null')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
