'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import {
  addItemsToShare,
  newShareToken,
  regroupShare,
  removeItemsFromShare,
} from '@/lib/share/manage';
import { inventoryItemIdsForFilter, type ShareFilter } from '@/lib/share/select-items';
import { applyGroupDecision } from '@/lib/share/apply';

/**
 * The owner's actions on a share.
 *
 * Signatures are flat and take plain values rather than FormData wherever the
 * caller is not a form, because the other consumer of this file is me telling
 * Claude "put all the board games on the form" -- and a function taking
 * `{ shareId, filter }` is one it can call correctly without reading a page.
 * See "The AI-facing surface" in docs/SHARE-LINKS-SPEC.md.
 */

export interface ShareActionState {
  error?: string;
  message?: string;
}

const uuid = z.string().uuid();

// latency: pending
export async function createShare(
  _prev: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  const parsed = z
    .object({
      title: z.string().trim().min(1, 'Give it a title.').max(120),
      intro: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      title: String(formData.get('title') ?? ''),
      intro: String(formData.get('intro') ?? '') || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const { data: share, error } = await supabase
    .from('share_links')
    .insert({
      user_id: user.id,
      title: parsed.data.title,
      intro: parsed.data.intro ?? null,
      kind: 'disposition',
    })
    .select('id')
    .single();

  if (error || !share) return { error: error?.message ?? 'Could not create that.' };

  // A share with no way in is not a share. The first token is issued with it
  // rather than as a second click.
  const { error: tokenError } = await supabase.from('share_link_tokens').insert({
    share_link_id: share.id,
    token: newShareToken(),
    label: 'Anyone with the link',
  });
  if (tokenError) return { error: tokenError.message };

  await supabase.from('share_link_events').insert({
    share_link_id: share.id,
    kind: 'token_issued',
    payload: { reason: 'created' },
  });

  revalidatePath('/shopping/share');
  return { message: 'Share created.' };
}

/**
 * Stop a link working.
 *
 * Revoking rather than deleting, so the answers she already gave survive and
 * the event log still says which link they came through.
 */
// latency: pending
export async function revokeShareToken(tokenId: string): Promise<ShareActionState> {
  if (!uuid.safeParse(tokenId).success) return { error: 'That is not a link.' };

  const supabase = await createClient();
  await requireUser();

  const { data, error } = await supabase
    .from('share_link_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('revoked_at', null)
    .select('share_link_id')
    .maybeSingle();

  if (error) return { error: error.message };
  if (data) {
    await supabase.from('share_link_events').insert({
      share_link_id: data.share_link_id,
      token_id: tokenId,
      kind: 'token_revoked',
      payload: {},
    });
  }

  revalidatePath('/shopping/share');
  return { message: 'Link revoked.' };
}

/** A fresh link for the same share. The old one keeps working until revoked. */
// latency: pending
export async function issueShareToken(
  shareId: string,
  label?: string,
): Promise<ShareActionState> {
  if (!uuid.safeParse(shareId).success) return { error: 'That is not a share.' };

  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('share_link_tokens').insert({
    share_link_id: shareId,
    token: newShareToken(),
    label: label?.trim() || 'Anyone with the link',
  });
  if (error) return { error: error.message };

  await supabase.from('share_link_events').insert({
    share_link_id: shareId,
    kind: 'token_issued',
    payload: { label: label ?? null },
  });

  revalidatePath('/shopping/share');
  return { message: 'New link issued.' };
}

// latency: pending
export async function archiveShare(shareId: string): Promise<ShareActionState> {
  if (!uuid.safeParse(shareId).success) return { error: 'That is not a share.' };

  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('share_links')
    .update({ status: 'archived' })
    .eq('id', shareId);
  if (error) return { error: error.message };

  revalidatePath('/shopping/share');
  return { message: 'Archived. Every link to it stops working.' };
}

/** Put specific items on a share. The "I found another one" path. */
// latency: pending
export async function addToShare(input: {
  shareId: string;
  inventoryItemIds: string[];
}): Promise<ShareActionState> {
  const parsed = z
    .object({ shareId: uuid, inventoryItemIds: z.array(uuid).min(1).max(500) })
    .safeParse(input);
  if (!parsed.success) return { error: 'Nothing to add.' };

  const user = await requireUser();
  const supabase = await createClient();

  try {
    const { added } = await addItemsToShare(
      supabase,
      user.id,
      parsed.data.shareId,
      parsed.data.inventoryItemIds,
    );
    revalidatePath('/shopping/share');
    revalidatePath('/shopping/inventory');
    return {
      message:
        added === 0
          ? 'Already on the form.'
          : `Added ${added} ${added === 1 ? 'item' : 'items'}.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not add those.' };
  }
}

/**
 * Put everything matching a filter on a share. The "put all the board games
 * in" path, and the one an instruction turns into.
 */
// latency: pending
export async function addToShareByFilter(input: {
  shareId: string;
  filter: ShareFilter;
}): Promise<ShareActionState> {
  if (!uuid.safeParse(input.shareId).success) return { error: 'That is not a share.' };

  const user = await requireUser();
  const supabase = await createClient();

  try {
    const ids = await inventoryItemIdsForFilter(supabase, user.id, input.filter);
    if (ids.length === 0) return { message: 'Nothing matched.' };

    const { added } = await addItemsToShare(supabase, user.id, input.shareId, ids);
    revalidatePath('/shopping/share');
    revalidatePath('/shopping/inventory');
    return {
      message:
        added === 0
          ? `All ${ids.length} were already on the form.`
          : `Added ${added} of ${ids.length} matching items.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not add those.' };
  }
}

// latency: pending
export async function removeFromShare(input: {
  shareId: string;
  inventoryItemIds: string[];
}): Promise<ShareActionState> {
  const parsed = z
    .object({ shareId: uuid, inventoryItemIds: z.array(uuid).min(1) })
    .safeParse(input);
  if (!parsed.success) return { error: 'Nothing to remove.' };

  await requireUser();
  const supabase = await createClient();

  try {
    await removeItemsFromShare(supabase, parsed.data.shareId, parsed.data.inventoryItemIds);
    revalidatePath('/shopping/share');
    return { message: 'Removed.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not remove those.' };
  }
}

/** Recompute the cached grouping, moving answers that can be moved. */
// latency: pending
export async function regroup(shareId: string): Promise<ShareActionState> {
  if (!uuid.safeParse(shareId).success) return { error: 'That is not a share.' };

  const user = await requireUser();
  const supabase = await createClient();

  try {
    const result = await regroupShare(supabase, user.id, shareId);
    revalidatePath('/shopping/share');
    if (result.updated === 0 && result.dropped === 0) return { message: 'Grouping is current.' };
    return {
      message:
        `Regrouped ${result.updated} ${result.updated === 1 ? 'item' : 'items'}` +
        (result.moved > 0 ? `, carried ${result.moved} answers over` : '') +
        (result.dropped > 0
          ? `, dropped ${result.dropped} that could not be placed`
          : '') +
        '.',
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not regroup.' };
  }
}

/**
 * Accept one group's answer and change the inventory to match.
 *
 * The counts are re-read from the database rather than taken from the caller,
 * because the button that triggers this was rendered from a page that may be a
 * few minutes old -- and "sell 2" clicked against a group she has since
 * changed to "sell 1" would dispose of a box nobody asked about.
 */
// latency: pending
export async function applyDecision(input: {
  shareId: string;
  groupKey: string;
}): Promise<ShareActionState> {
  const parsed = z
    .object({ shareId: uuid, groupKey: z.string().min(1).max(200) })
    .safeParse(input);
  if (!parsed.success) return { error: 'That is not a group.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: response } = await supabase
    .from('share_link_responses')
    .select('sell_qty, giveaway_qty, share_links!inner ( user_id )')
    .eq('share_link_id', parsed.data.shareId)
    .eq('group_key', parsed.data.groupKey)
    .maybeSingle();

  if (!response) return { error: 'That has not been answered.' };

  try {
    const result = await applyGroupDecision(supabase, user.id, {
      shareLinkId: parsed.data.shareId,
      groupKey: parsed.data.groupKey,
      sellQty: response.sell_qty as number,
      giveawayQty: response.giveaway_qty as number,
    });

    revalidatePath('/shopping/share');
    revalidatePath(`/shopping/share/${parsed.data.shareId}`);
    revalidatePath('/shopping/inventory');

    const parts = [
      result.sold > 0 && `${result.sold} marked sold`,
      result.givenAway > 0 && `${result.givenAway} marked given away`,
    ].filter(Boolean);

    if (parts.length === 0) return { error: 'Nothing left to apply.' };
    return {
      message:
        parts.join(', ') +
        (result.shortfall > 0 ? ` — ${result.shortfall} were no longer owned.` : '.'),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not apply that.' };
  }
}
