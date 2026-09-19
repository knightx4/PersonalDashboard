import 'server-only';

import type { SessionUser } from '@/lib/auth/session-user';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { countConnectedInboxes } from '@/lib/core/inbox/accounts';
import { saveAccountIdentity } from '@/lib/core/account/settings';
import { APP_SCHEMA, type AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';

/**
 * Onboarding uses profiles.onboarding_completed_at.
 *
 * Anyone who already has a company or a connected inbox is grandfathered, so
 * the gate never bounces someone mid-use.
 */
export async function onboardingNeeded(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  user: SessionUser,
): Promise<boolean> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle();

  // Without this, an unreadable profile looks like an un-onboarded user, and
  // the gate sends them back to onboarding on every single request.
  assertSchemaExposed(error, APP_SCHEMA);

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
  // Name and timezone are not in this patch: they are account settings, and
  // this workspace is not their owner. Everything else here is the job search's
  // own and stays on its profile.
  const patch: Record<string, unknown> = {
    onboarding_completed_at: new Date().toISOString(),
  };
  if (extras?.targetTitles?.length) patch.target_titles = extras.targetTitles;
  if (extras?.searchStartedOn) patch.search_started_on = extras.searchStartedOn;

  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  assertSchemaExposed(error, APP_SCHEMA);
  if (error) return { error: error.message };

  return saveAccountIdentity(userId, {
    timezone: extras?.timezone,
    displayName: extras?.displayName,
  });
}
