import 'server-only';

import type { User } from '@supabase/supabase-js';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { countConnectedInboxes } from '@/lib/core/inbox/accounts';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Onboarding uses profiles.onboarding_completed_at.
 *
 * Existing users who already connected an inbox or have orders are grandfathered
 * so the gate does not bounce people mid-use when this ships.
 */
export async function onboardingNeeded(
  supabase: SupabaseClient,
  core: CoreSupabaseClient,
  user: User,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.onboarding_completed_at) return false;

  const [accountCount, { count: orderCount }] = await Promise.all([
    countConnectedInboxes(core, user.id),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ]);

  if (accountCount > 0 || (orderCount ?? 0) > 0) {
    await markOnboardingComplete(supabase, user.id);
    return false;
  }

  return true;
}

export async function markOnboardingComplete(
  supabase: SupabaseClient,
  userId: string,
  extras?: { timezone?: string; displayName?: string },
): Promise<{ error: string | null }> {
  const patch: Record<string, string> = {
    onboarding_completed_at: new Date().toISOString(),
  };
  if (extras?.timezone?.trim()) patch.timezone = extras.timezone.trim();
  if (extras?.displayName?.trim()) patch.display_name = extras.displayName.trim();

  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  return { error: error?.message ?? null };
}
