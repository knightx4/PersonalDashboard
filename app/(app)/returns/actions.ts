'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';

export type ActionState = {
  error?: string;
  message?: string;
};

/** Toggle whether an owned inventory unit is planned for return. */
export async function setReturnPlanned(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = z
    .object({
      id: z.string().uuid(),
      planned: z.enum(['true', 'false']),
    })
    .safeParse({
      id: formData.get('id'),
      planned: formData.get('planned'),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Missing item.' };
  }

  const planned = parsed.data.planned === 'true';

  const { data: item, error: itemError } = await supabase
    .from('inventory_items')
    .select('id, status')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (itemError || !item) return { error: 'That item could not be found.' };
  if (item.status !== 'owned') {
    return { error: 'Only owned items can be marked to return.' };
  }

  const { error } = await supabase
    .from('inventory_items')
    .update({ return_planned: planned })
    .eq('id', item.id)
    .eq('user_id', user.id)
    .eq('status', 'owned');

  if (error) return { error: error.message };

  revalidatePath('/returns');
  revalidatePath('/inventory');
  revalidatePath(`/inventory/${item.id}`);
  revalidatePath('/dashboard');
  return { message: planned ? 'Marked to return.' : 'Removed from to-return list.' };
}

/**
 * Upsert or clear a per-user merchant return window.
 *
 * - Empty input with "reset": deletes the override (back to seeded default).
 * - Empty input without reset: sets override to null (no window for this user).
 * - Number: sets that many days.
 */
export async function saveMerchantReturnPolicy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const merchantId = z.string().uuid().safeParse(formData.get('merchant_id'));
  if (!merchantId.success) return { error: 'Missing merchant.' };

  const intent = String(formData.get('intent') ?? 'save');
  const rawDays = String(formData.get('return_window_days') ?? '').trim();

  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id, name, default_return_window_days')
    .eq('id', merchantId.data)
    .maybeSingle();

  if (merchantError || !merchant) return { error: 'That merchant could not be found.' };

  if (intent === 'reset') {
    const { error } = await supabase
      .from('merchant_return_policies')
      .delete()
      .eq('user_id', user.id)
      .eq('merchant_id', merchant.id);
    if (error) return { error: error.message };
    revalidatePaths();
    return { message: `Restored ${merchant.name} to the default policy.` };
  }

  let days: number | null;
  if (rawDays === '') {
    days = null;
  } else {
    const parsedDays = z.coerce.number().int().min(1).max(730).safeParse(rawDays);
    if (!parsedDays.success) {
      return { error: 'Return window must be between 1 and 730 days, or blank for none.' };
    }
    days = parsedDays.data;
  }

  // If the value matches the seed, drop the override so the seed stays the source.
  if (days === (merchant.default_return_window_days as number | null)) {
    const { error } = await supabase
      .from('merchant_return_policies')
      .delete()
      .eq('user_id', user.id)
      .eq('merchant_id', merchant.id);
    if (error) return { error: error.message };
    revalidatePaths();
    return { message: `Using the default ${days ?? 'none'} day window for ${merchant.name}.` };
  }

  const { data: existing } = await supabase
    .from('merchant_return_policies')
    .select('id')
    .eq('user_id', user.id)
    .eq('merchant_id', merchant.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('merchant_return_policies')
      .update({ return_window_days: days })
      .eq('id', existing.id)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from('merchant_return_policies').insert({
      user_id: user.id,
      merchant_id: merchant.id,
      return_window_days: days,
    });
    if (error) return { error: error.message };
  }

  revalidatePaths();
  return {
    message:
      days == null
        ? `Cleared the return window for ${merchant.name}.`
        : `Set ${merchant.name} to ${days} days.`,
  };
}

function revalidatePaths() {
  revalidatePath('/settings');
  revalidatePath('/returns');
  revalidatePath('/inventory');
  revalidatePath('/orders');
  revalidatePath('/dashboard');
}
