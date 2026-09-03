'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { normalizeTimeZone } from '@/lib/core/timezone';
import { MODULES, type ModuleId } from '@/lib/modules';
import { isSupportedDisplayCurrency, normalizeCurrencyCode } from '@/lib/fx/money-fx';

export interface AccountState {
  error?: string;
  message?: string;
}

const schema = z.object({
  displayName: z.string().trim().max(120),
  timezone: z
    .string()
    .trim()
    .max(64)
    // Validated rather than trusted, for the reason lib/core/timezone.ts
    // records at length: this value is handed straight to Intl on every page
    // that shows a date, and "ET" took a page down with a 500 once already.
    .refine((value) => !value || normalizeTimeZone(value) !== null, {
      message:
        'That is not a timezone name. Use something like Europe/London or America/New_York.',
    }),
  displayCurrency: z
    .string()
    .trim()
    .transform((value) => normalizeCurrencyCode(value))
    .refine((value) => isSupportedDisplayCurrency(value), 'Unsupported currency'),
});

/**
 * The settings that are true about you in every workspace.
 *
 * One write, to `core.account_settings`. The two `profiles.timezone` columns
 * are mirrors kept by a trigger, so nothing here has to remember them and they
 * cannot end up disagreeing -- which is what they did for months, because only
 * the job side had a screen that edited one.
 */
export async function updateAccountSettings(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const parsed = schema.safeParse({
    displayName: formData.get('displayName') ?? '',
    timezone: formData.get('timezone') ?? '',
    displayCurrency: formData.get('displayCurrency') ?? 'USD',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createCoreClient();

  const { error } = await supabase
    .from('account_settings')
    .update({
      display_name: parsed.data.displayName || null,
      timezone: normalizeTimeZone(parsed.data.timezone) ?? 'UTC',
      display_currency: parsed.data.displayCurrency,
    })
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  // Every workspace formats dates in this zone, so every workspace is stale.
  revalidatePath('/', 'layout');
  return { message: 'Saved.' };
}

/**
 * Which workspaces are switched on.
 *
 * A display setting and nothing more: an off module disappears from the
 * switcher and stops contributing to the agenda. Nothing is deleted, no link
 * breaks, and turning it back on restores exactly what was there.
 */
export async function updateEnabledModules(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const chosen = MODULES.filter((module) => formData.get(`module:${module}`) === 'on');

  // The database refuses an empty array as well. Saying so here is friendlier
  // than a constraint violation, and the constraint is what makes it true.
  if (chosen.length === 0) {
    return { error: 'Leave at least one workspace on, or there is nothing to open.' };
  }

  const user = await requireUser();
  const supabase = await createCoreClient();

  const { error } = await supabase
    .from('account_settings')
    .update({ enabled_modules: chosen as unknown as ModuleId[] })
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  return { message: 'Saved.' };
}
