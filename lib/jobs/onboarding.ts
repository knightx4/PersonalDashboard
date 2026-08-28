import 'server-only';

import type { User } from '@supabase/supabase-js';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { countConnectedInboxes } from '@/lib/core/inbox/accounts';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * Onboarding uses profiles.onboarding_completed_at.
 *
 * Anyone who already has a company or a connected inbox is grandfathered, so
 * the gate never bounces someone mid-use.
 */
export async function onboardingNeeded(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  user: User,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.onboarding_completed_at) return false;

  const [accountCount, { count: companyCount }] = await Promise.all([
    countConnectedInboxes(core, user.id),
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ]);

  if (accountCount > 0 || (companyCount ?? 0) > 0) {
    await markOnboardingComplete(supabase, user.id);
    return false;
  }

  return true;
}

export async function markOnboardingComplete(
  supabase: AppSupabaseClient,
  userId: string,
  extras?: {
    timezone?: string;
    displayName?: string;
    targetTitles?: string[];
    searchStartedOn?: string;
  },
): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = {
    onboarding_completed_at: new Date().toISOString(),
  };
  if (extras?.timezone?.trim()) patch.timezone = extras.timezone.trim();
  if (extras?.displayName?.trim()) patch.display_name = extras.displayName.trim();
  if (extras?.targetTitles?.length) patch.target_titles = extras.targetTitles;
  if (extras?.searchStartedOn) patch.search_started_on = extras.searchStartedOn;

  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  return { error: error?.message ?? null };
}
