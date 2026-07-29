'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';

export interface ActionState {
  error?: string;
  message?: string;
}

function revalidateReviewSurfaces(): void {
  revalidatePath('/review');
  revalidatePath('/orders');
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  // Layout reads the nav badge count.
  revalidatePath('/', 'layout');
}

/**
 * Heuristic import looked right — keep the order and stop nagging.
 */
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

  const { error: deleteError } = await supabase
    .from('orders')
    .delete()
    .eq('id', orderId)
    .eq('user_id', user.id);

  if (deleteError) return { error: deleteError.message };

  revalidateReviewSurfaces();
  return { message: 'Order discarded.' };
}

/**
 * Email was not a useful order / update — leave the ledger row but stop
 * showing it in Review.
 */
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

  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('user_id', user.id);
  const accountIds = (accounts ?? []).map((row) => row.id as string);
  if (accountIds.length === 0) return { error: 'No inbox connected.' };

  const { data: message, error: loadError } = await supabase
    .from('ingested_messages')
    .select('id, parse_status')
    .eq('id', messageId)
    .in('email_account_id', accountIds)
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
