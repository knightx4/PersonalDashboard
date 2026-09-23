'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { connectedAccountIds } from '@/lib/core/inbox/accounts';
import { EXCLUDED_SENDER_ERROR, isExcludedSender } from '@/lib/inbox/merchant-exclusion-match';
import { chooseExclusionDomain } from '@/lib/review/exclude-sender';

export interface ActionState {
  error?: string;
  message?: string;
}

function revalidateReviewSurfaces(): void {
  revalidatePath('/shopping/review');
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/dashboard');
  // Layout reads the nav badge count.
  revalidatePath('/', 'layout');
}

/**
 * Heuristic import looked right — keep the order and stop nagging.
 */
// latency: pending
export async function confirmOrderReview(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    return { error: 'Invalid order.' };
  }

  const { data: order, error: loadError } = await supabase
    .from('orders')
    .select('id, needs_review')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (loadError) return { error: loadError.message };
  if (!order) return { error: 'Order not found.' };
  if (!order.needs_review) return { message: 'Already confirmed.' };

  const { error } = await supabase
    .from('orders')
    .update({ needs_review: false })
    .eq('id', orderId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidateReviewSurfaces();
  return { message: 'Order confirmed.' };
}

/**
 * Bad import — remove the order (cascades inventory) and skip the source email
 * so a re-scan does not recreate it as needs_review without a mute.
 */
// latency: pending
export async function discardOrderReview(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    return { error: 'Invalid order.' };
  }

  const { data: order, error: loadError } = await supabase
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (loadError) return { error: loadError.message };
  if (!order) return { error: 'Order not found.' };

  const { error: messageError } = await supabase
    .from('ingested_messages')
    .update({
      parse_status: 'skipped',
      resulting_order_id: null,
      error: 'Discarded from review queue',
    })
    .eq('resulting_order_id', orderId);

  if (messageError) return { error: messageError.message };

  // Soft-delete so it can be restored from Settings → Deleted orders.
  const { error: deleteError } = await supabase
    .from('orders')
    .update({ deleted_at: new Date().toISOString(), needs_review: false })
    .eq('id', orderId)
    .eq('user_id', user.id);

  if (deleteError) return { error: deleteError.message };

  revalidateReviewSurfaces();
  revalidatePath('/shopping/settings');
  redirect('/shopping/review');
}

/**
 * Email was not a useful order / update — leave the ledger row but stop
 * showing it in Review.
 */
// latency: pending
export async function dismissEmailReview(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const messageId = String(formData.get('messageId') ?? '');
  if (!z.string().uuid().safeParse(messageId).success) {
    return { error: 'Invalid message.' };
  }

  const core = await createCoreClient();
  const accountIds = await connectedAccountIds(core, user.id);
  if (accountIds.length === 0) return { error: 'No inbox connected.' };

  // Ownership comes from the view's user_id: the verdict row has no account id
  // of its own any more.
  const { data: message, error: loadError } = await supabase
    .from('inbox_messages')
    .select('id, parse_status')
    .eq('id', messageId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (loadError) return { error: loadError.message };
  if (!message) return { error: 'Message not found.' };

  const { error } = await supabase
    .from('ingested_messages')
    .update({
      parse_status: 'skipped',
      error: 'Dismissed from review queue',
    })
    .eq('id', messageId)
    .in('email_account_id', accountIds);

  if (error) return { error: error.message };

  revalidateReviewSurfaces();
  return { message: 'Email dismissed.' };
}

/**
 * Mute an email's sender domain: every waiting email from it leaves the queue,
 * and mail from it that syncs later is skipped, whatever its kind.
 *
 * The domain is the Reply-To one where there is one (see
 * chooseExclusionDomain), and a domain many shops share is refused with the
 * reason rather than written. The mute is listed under Muted merchants in
 * shopping settings, which is where it is undone; there is no undo here.
 */
// latency: pending
export async function excludeSenderReview(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const messageId = String(formData.get('messageId') ?? '');
  if (!z.string().uuid().safeParse(messageId).success) {
    return { error: 'Invalid message.' };
  }

  const { data: message, error: loadError } = await supabase
    .from('inbox_messages')
    .select('id, from_address, reply_to_address')
    .eq('id', messageId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (loadError) return { error: loadError.message };
  if (!message) return { error: 'Message not found.' };

  const choice = chooseExclusionDomain({
    fromAddress: (message.from_address as string | null) ?? null,
    replyToAddress: (message.reply_to_address as string | null) ?? null,
  });
  if (!choice.ok) return { error: choice.reason };
  const domain = choice.domain;

  const { data: existing, error: existingError } = await supabase
    .from('merchant_exclusions')
    .select('id')
    .eq('user_id', user.id)
    .eq('match_domain', domain)
    .maybeSingle();
  if (existingError) return { error: existingError.message };

  if (!existing) {
    const { error: insertError } = await supabase
      .from('merchant_exclusions')
      .insert({ user_id: user.id, merchant_id: null, match_domain: domain });
    // A second press racing the first lands on the unique index; that is fine.
    if (insertError && !/duplicate|unique/i.test(insertError.message)) {
      return { error: insertError.message };
    }
  }

  // The waiting emails, matched the same way the sync matches new mail, so
  // the queue empties of exactly what a later sync would skip.
  const { data: waiting, error: waitingError } = await supabase
    .from('inbox_messages')
    .select('id, from_address, reply_to_address')
    .eq('user_id', user.id)
    .eq('parse_status', 'needs_review');
  if (waitingError) return { error: waitingError.message };

  const mute = [{ merchant_id: null, match_domain: domain }];
  const ids = (waiting ?? [])
    .filter((row) =>
      isExcludedSender(mute, {
        merchantId: null,
        fromAddress: (row.from_address as string | null) ?? null,
        replyToAddress: (row.reply_to_address as string | null) ?? null,
      }),
    )
    .map((row) => row.id as string);

  // Row-level security scopes the verdict table to the owner's messages; the
  // ids above were read with the user's id already.
  if (ids.length > 0) {
    const { error: skipError } = await supabase
      .from('ingested_messages')
      .update({ parse_status: 'skipped', error: EXCLUDED_SENDER_ERROR })
      .in('id', ids)
      .eq('parse_status', 'needs_review');
    if (skipError) return { error: skipError.message };
  }

  revalidateReviewSurfaces();
  revalidatePath('/shopping/settings');
  return {
    message: `Excluded ${domain}. ${ids.length} waiting ${ids.length === 1 ? 'email' : 'emails'} removed.`,
  };
}

/**
 * The bulk half of the three actions above: one call for a whole selection,
 * and enough back to put it all the way back.
 *
 * `changed` is the rows the call actually moved, never the rows it was asked
 * about — the queue is read from two places at once often enough that some of
 * a selection is regularly already dealt with, and a toast saying four when it
 * moved two is a toast nobody believes twice. Undo then runs over exactly
 * `changed`.
 *
 * What the undo needs beyond the ids goes in `restore`: a message's parse
 * status and error before the write, which cannot be derived afterwards. It
 * travels to the client and back, so the restoring actions re-check ownership
 * and parse the payload rather than trusting the shape they are handed.
 */
export type BulkReviewResult = {
  changed: string[];
  error?: string | null;
};

/** A source message as it was before its order was discarded. */
const messageState = z.object({
  id: z.string().uuid(),
  parseStatus: z.enum(['parsed', 'needs_review', 'skipped', 'failed']),
  error: z.string().nullable(),
});

const discardedOrder = z.object({
  orderId: z.string().uuid(),
  messages: z.array(messageState).max(50),
});

export type DiscardedOrder = z.infer<typeof discardedOrder>;
export type DismissedEmail = z.infer<typeof messageState>;

/** One selection's worth of ids. The cap is a sane page of a queue. */
const idList = z.array(z.string().uuid()).min(1).max(200);

const INVALID_SELECTION = 'That selection is not something we can act on.';

/** Confirm every selected order that is still waiting. */
// latency: pending
export async function confirmOrdersReview(ids: string[]): Promise<BulkReviewResult> {
  const parsed = idList.safeParse(ids);
  if (!parsed.success) return { changed: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: orders, error: loadError } = await supabase
    .from('orders')
    .select('id')
    .in('id', parsed.data)
    .eq('user_id', user.id)
    .eq('needs_review', true)
    .is('deleted_at', null);

  if (loadError) return { changed: [], error: loadError.message };

  const changed = (orders ?? []).map((row) => row.id as string);
  if (changed.length === 0) return { changed: [], error: 'Those are already confirmed.' };

  const { error } = await supabase
    .from('orders')
    .update({ needs_review: false })
    .in('id', changed)
    .eq('user_id', user.id);

  if (error) return { changed: [], error: error.message };

  revalidateReviewSurfaces();
  return { changed };
}

/** The way back from a bulk confirm: put them in the queue again. */
// latency: pending
export async function unconfirmOrdersReview(ids: readonly string[]): Promise<BulkReviewResult> {
  const parsed = idList.safeParse([...ids]);
  if (!parsed.success) return { changed: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('orders')
    .update({ needs_review: true })
    .in('id', parsed.data)
    .eq('user_id', user.id)
    .is('deleted_at', null);

  if (error) return { changed: [], error: error.message };

  revalidateReviewSurfaces();
  return { changed: parsed.data };
}

/**
 * Discard every selected order: the same soft delete and the same muting of
 * the source email the one-row button does, with what the messages looked like
 * first handed back so the undo can put them exactly as they were.
 */
// latency: pending
export async function discardOrdersReview(
  ids: string[],
): Promise<BulkReviewResult & { restore: DiscardedOrder[] }> {
  const parsed = idList.safeParse(ids);
  if (!parsed.success) return { changed: [], restore: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: orders, error: loadError } = await supabase
    .from('orders')
    .select('id')
    .in('id', parsed.data)
    .eq('user_id', user.id)
    .is('deleted_at', null);

  if (loadError) return { changed: [], restore: [], error: loadError.message };

  const changed = (orders ?? []).map((row) => row.id as string);
  if (changed.length === 0) return { changed: [], restore: [], error: 'Those are gone already.' };

  const { data: sources, error: sourceError } = await supabase
    .from('inbox_messages')
    .select('id, parse_status, error, resulting_order_id')
    .in('resulting_order_id', changed)
    .eq('user_id', user.id);

  if (sourceError) return { changed: [], restore: [], error: sourceError.message };

  const restore: DiscardedOrder[] = changed.map((orderId) => ({
    orderId,
    messages: (sources ?? [])
      .filter((row) => row.resulting_order_id === orderId)
      .map((row) => ({
        id: row.id as string,
        parseStatus: (row.parse_status as DismissedEmail['parseStatus']) ?? 'parsed',
        error: (row.error as string | null) ?? null,
      })),
  }));

  const { error: messageError } = await supabase
    .from('ingested_messages')
    .update({
      parse_status: 'skipped',
      resulting_order_id: null,
      error: 'Discarded from review queue',
    })
    .in('resulting_order_id', changed);

  if (messageError) return { changed: [], restore: [], error: messageError.message };

  const { error: deleteError } = await supabase
    .from('orders')
    .update({ deleted_at: new Date().toISOString(), needs_review: false })
    .in('id', changed)
    .eq('user_id', user.id);

  if (deleteError) return { changed: [], restore: [], error: deleteError.message };

  revalidateReviewSurfaces();
  revalidatePath('/shopping/settings');
  return { changed, restore };
}

/** The way back from a bulk discard: the orders and their emails as they were. */
// latency: pending
export async function restoreDiscardedOrders(restore: DiscardedOrder[]): Promise<BulkReviewResult> {
  const parsed = z.array(discardedOrder).min(1).max(200).safeParse(restore);
  if (!parsed.success) return { changed: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const accountIds = await connectedAccountIds(core, user.id);

  const orderIds = parsed.data.map((entry) => entry.orderId);
  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: null, needs_review: true })
    .in('id', orderIds)
    .eq('user_id', user.id);

  if (error) return { changed: [], error: error.message };

  // One statement per message, because each one goes back to its own status
  // and its own error. A selection is tens of rows, not thousands.
  for (const entry of parsed.data) {
    for (const message of entry.messages) {
      const { error: messageError } = await supabase
        .from('ingested_messages')
        .update({
          parse_status: message.parseStatus,
          error: message.error,
          resulting_order_id: entry.orderId,
        })
        .eq('id', message.id)
        .in('email_account_id', accountIds);

      if (messageError) return { changed: [], error: messageError.message };
    }
  }

  revalidateReviewSurfaces();
  revalidatePath('/shopping/settings');
  return { changed: orderIds };
}

/** Dismiss every selected email that is still waiting. */
// latency: pending
export async function dismissEmailsReview(
  ids: string[],
): Promise<BulkReviewResult & { restore: DismissedEmail[] }> {
  const parsed = idList.safeParse(ids);
  if (!parsed.success) return { changed: [], restore: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const accountIds = await connectedAccountIds(core, user.id);
  if (accountIds.length === 0) return { changed: [], restore: [], error: 'No inbox connected.' };

  const { data: messages, error: loadError } = await supabase
    .from('inbox_messages')
    .select('id, parse_status, error')
    .in('id', parsed.data)
    .eq('user_id', user.id)
    .eq('parse_status', 'needs_review');

  if (loadError) return { changed: [], restore: [], error: loadError.message };

  const restore: DismissedEmail[] = (messages ?? []).map((row) => ({
    id: row.id as string,
    parseStatus: 'needs_review',
    error: (row.error as string | null) ?? null,
  }));
  if (restore.length === 0) {
    return { changed: [], restore: [], error: 'Those are dismissed already.' };
  }

  const { error } = await supabase
    .from('ingested_messages')
    .update({ parse_status: 'skipped', error: 'Dismissed from review queue' })
    .in(
      'id',
      restore.map((row) => row.id),
    )
    .in('email_account_id', accountIds);

  if (error) return { changed: [], restore: [], error: error.message };

  revalidateReviewSurfaces();
  return { changed: restore.map((row) => row.id), restore };
}

/** The way back from a bulk dismiss, including the reason each email carried. */
// latency: pending
export async function restoreDismissedEmails(restore: DismissedEmail[]): Promise<BulkReviewResult> {
  const parsed = z.array(messageState).min(1).max(200).safeParse(restore);
  if (!parsed.success) return { changed: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const core = await createCoreClient();
  const supabase = await createClient();
  const accountIds = await connectedAccountIds(core, user.id);
  if (accountIds.length === 0) return { changed: [], error: 'No inbox connected.' };

  for (const message of parsed.data) {
    const { error } = await supabase
      .from('ingested_messages')
      .update({ parse_status: message.parseStatus, error: message.error })
      .eq('id', message.id)
      .in('email_account_id', accountIds);

    if (error) return { changed: [], error: error.message };
  }

  revalidateReviewSurfaces();
  return { changed: parsed.data.map((row) => row.id) };
}
