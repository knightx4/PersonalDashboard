'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import {
  mergePayments,
  moveCharges,
  renamePayment,
  type CorrectionResult,
} from '@/lib/recurring/corrections';

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

// latency: pending
export async function moveRecurringCharges(
  _prev: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      id: z.string().uuid(),
      charges: z.array(z.string().uuid()).min(1).max(500),
      into: z.union([z.literal('new'), z.string().uuid()]),
      payee: z.string().optional(),
    })
    .safeParse({
      id: formData.get('id'),
      charges: formData.getAll('charge'),
      into: formData.get('into'),
      payee: formData.get('payee') ?? undefined,
    });
  if (!parsed.success) return { error: 'Pick the charges to move and where they go.' };

  const { id, charges, into, payee } = parsed.data;
  const supabase = await createClient();
  const result = await moveCharges(supabase, {
    userId: user.id,
    paymentId: id,
    chargeIds: charges,
    to: into === 'new' ? { payee: payee ?? '' } : { paymentId: into },
  });
  if (result.error) return { error: result.error };
  refresh();
  return {};
}
