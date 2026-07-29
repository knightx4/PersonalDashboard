'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { markOnboardingComplete } from '@/lib/onboarding';

export interface OnboardingState {
  error?: string;
}

const completeSchema = z.object({
  timezone: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  displayName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = completeSchema.safeParse({
    timezone: String(formData.get('timezone') ?? ''),
    displayName: String(formData.get('display_name') ?? ''),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const { error } = await markOnboardingComplete(supabase, user.id, {
    timezone: parsed.data.timezone,
    displayName: parsed.data.displayName,
  });

  if (error) return { error };

  const nextRaw = String(formData.get('next') ?? '/dashboard');
  const next =
    nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard';

  revalidatePath('/', 'layout');
  redirect(next);
}

/** Finish onboarding then send the user into Gmail connect. */
export async function continueToGmailConnect(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = completeSchema.safeParse({
    timezone: String(formData.get('timezone') ?? ''),
    displayName: String(formData.get('display_name') ?? ''),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  // Do not mark complete yet — they should see the pre-consent screen first.
  // Persist timezone/name so the rest of the app has them even if they abandon.
  const patch: Record<string, string> = {};
  if (parsed.data.timezone) patch.timezone = parsed.data.timezone;
  if (parsed.data.displayName) patch.display_name = parsed.data.displayName;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (error) return { error: error.message };
  }

  redirect('/onboarding?step=gmail');
}
