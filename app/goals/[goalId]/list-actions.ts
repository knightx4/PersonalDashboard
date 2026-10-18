'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { parseCollectionName } from '@/lib/goals/collections';
import { confirmRecord } from '@/lib/goals/collections-store';
import { DEFAULT_LIST_FIELDS, sayMissing } from '@/lib/goals/lists';
import { addListRow, addListRowFromLink, createGoalList, loadGoalList } from '@/lib/goals/lists-store';
import { nameFieldOf } from '@/lib/goals/goal-lists';
import { scrapeProductUrl } from '@/lib/saved/scrape-product';

/**
 * A goal's own lists from its page (plan #2330.3): start a list, add a row
 * by name or from a pasted link, and confirm a row a link filled in. Every
 * write goes through lib/goals/lists-store.ts, and the database checks the
 * values again. Linked lists are written with linkRowAction in
 * link-actions.ts, since their rows belong to other workspaces.
 */

export type ListActionState = {
  error?: string;
  /** What a pasted link did not give, said for the add box. */
  note?: string;
  done?: number;
};

const Id = z.string().uuid();

function saved(note?: string): ListActionState {
  revalidatePath('/goals', 'layout');
  return { done: Date.now(), ...(note ? { note } : {}) };
}

/** A web address typed into the add box, or null for a name. */
function linkIn(text: string): string | null {
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  try {
    return new URL(text).toString();
  } catch {
    return null;
  }
}

/** Start a list on the goal: `goalId` and `name`. It holds a name, a link and notes. */
// latency: pending
export async function addGoalListAction(_prev: ListActionState, form: FormData): Promise<ListActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  const name = parseCollectionName(form.get('name'));
  if (!name.ok) return { error: name.error === 'Name the collection.' ? 'Name the list.' : name.error };
  try {
    const made = await createGoalList(await createGoalsClient(), user.id, goalId.data, name.value, DEFAULT_LIST_FIELDS);
    if (!made.ok) return { error: made.error };
  } catch {
    return { error: 'The list could not be started. Try again.' };
  }
  return saved();
}

/**
 * Add a row to one of the goal's own lists: `listId` and `text`. A pasted
 * web address is read for its name, picture and price and goes in as a draft
 * to confirm; anything else is the row's name.
 */
// latency: pending
export async function addListRowAction(_prev: ListActionState, form: FormData): Promise<ListActionState> {
  const user = await requireUser();
  const listId = Id.safeParse(form.get('listId'));
  if (!listId.success) return { error: 'Could not tell which list that was.' };
  const text = typeof form.get('text') === 'string' ? (form.get('text') as string).trim() : '';
  if (text === '') return { error: 'Paste a link or type a name.' };

  try {
    const client = await createGoalsClient();
    const url = linkIn(text);
    if (url) {
      const added = await addListRowFromLink(client, user.id, listId.data, url, scrapeProductUrl);
      if (!added.ok) {
        return {
          error:
            added.error === 'That list is gone.'
              ? 'That list is gone. Reload to see what is there.'
              : 'That page could not be opened. Type its name instead, or try another link.',
        };
      }
      const { missing } = added.value;
      return saved(
        missing.length > 0
          ? `Added as a draft. The page did not give ${sayMissing(missing)}, so fill ${missing.length === 1 ? 'it' : 'them'} in before you confirm.`
          : undefined,
      );
    }
    const list = await loadGoalList(client, user.id, listId.data);
    if (!list) return { error: 'That list is gone. Reload to see what is there.' };
    const name = nameFieldOf(list.fields);
    if (!name) return { error: 'This list has no field for a name. Paste a link instead.' };
    const added = await addListRow(client, user.id, listId.data, { [name.key]: text });
    if (!added.ok) return { error: added.error };
  } catch {
    return { error: 'The row could not be added. Try again.' };
  }
  return saved();
}

/** Confirm a row a pasted link filled in, as it stands: `recordId`. */
// latency: pending
export async function confirmListRowAction(form: FormData): Promise<ListActionState> {
  await requireUser();
  const recordId = Id.safeParse(form.get('recordId'));
  if (!recordId.success) return { error: 'Could not tell which row that was.' };
  try {
    const confirmed = await confirmRecord(await createGoalsClient(), recordId.data);
    if (!confirmed) return { error: 'That row is no longer a draft. Reload to see it.' };
  } catch {
    return { error: 'That could not be confirmed. Try again.' };
  }
  return saved();
}
