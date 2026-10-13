import 'server-only';

import type { SessionUser } from '@/lib/auth/session-user';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { countConnectedInboxes } from '@/lib/core/inbox/accounts';
import { saveAccountIdentity } from '@/lib/core/account/settings';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { ONBOARDED_COOKIE, ONBOARDED_COOKIE_OPTIONS } from '@/lib/onboarded-cookie';

/**
 * Onboarding uses profiles.onboarding_completed_at.
 *
 * Existing users who already connected an inbox or have orders are grandfathered
 * so the gate does not bounce people mid-use when this ships.
 */
export async function onboardingNeeded(
  supabase: SupabaseClient,
  core: CoreSupabaseClient,
  user: SessionUser,
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
  // Only the flag belongs to this workspace. Name and timezone are account
  // settings, written through saveAccountIdentity so both workspaces get them.
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) return { error: error.message };

  // Lets the proxy send the next launch straight to Home (plan #1920). Only a
  // server action or route handler may set a cookie; while a page renders this
  // throws, and /api/onboarding/launch sets it instead.
  try {
    (await cookies()).set(ONBOARDED_COOKIE, '1', ONBOARDED_COOKIE_OPTIONS);
  } catch {}

  return saveAccountIdentity(userId, {
    timezone: extras?.timezone,
    displayName: extras?.displayName,
  });
}
