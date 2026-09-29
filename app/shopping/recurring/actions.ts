'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { mergePayments, renamePayment, type CorrectionResult } from '@/lib/recurring/corrections';

/**
 * The Recurring page's row actions (feature #1193). Each returns
 * `{ error }` for the row to show, and refreshes the page and the agenda,
 * which lists bills and renewals by payee.
 */

export type RecurringActionState = CorrectionResult;

function refresh() {
  revalidatePath('/shopping/recurring');
  revalidatePath('/todo');
}

// latency: pending
export async function renameRecurringPayment(
  _prev: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ id: z.string().uuid(), payee: z.string() })
    .safeParse({ id: formData.get('id'), payee: formData.get('payee') });
  if (!parsed.success) return { error: 'That payment could not be found.' };

  const supabase = await createClient();
  const result = await renamePayment(supabase, {
    userId: user.id,
    paymentId: parsed.data.id,
    payee: parsed.data.payee,
  });
  if (!result.error) refresh();
  return result;
}

// latency: pending
export async function mergeRecurringPayment(
  _prev: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ id: z.string().uuid(), into: z.string().uuid() })
    .safeParse({ id: formData.get('id'), into: formData.get('into') });
  if (!parsed.success) return { error: 'Pick the payment to merge it into.' };

  const supabase = await createClient();
  const result = await mergePayments(supabase, {
    userId: user.id,
    paymentId: parsed.data.id,
    intoId: parsed.data.into,
  });
  if (!result.error) refresh();
  return result;
}
