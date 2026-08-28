'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { decryptToken } from '@/lib/crypto/tokens';
import { gmailProvider } from '@/lib/jobs/email/providers/gmail';

export interface SettingsState {
  error?: string;
  message?: string;
}

const profileSchema = z.object({
  displayName: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(64).optional(),
  targetTitles: z.string().trim().optional(),
  searchStartedOn: z.string().optional(),
  ghostThresholdDays: z.coerce.number().int().min(7).max(180).optional(),
  writingStyleNotes: z.string().trim().max(4000).optional(),
  bannedConstructions: z.string().trim().optional(),
});

export async function updateProfile(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = profileSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    timezone: formData.get('timezone') ?? '',
    targetTitles: formData.get('targetTitles') ?? '',
    searchStartedOn: formData.get('searchStartedOn') ?? '',
    ghostThresholdDays: formData.get('ghostThresholdDays') || undefined,
    writingStyleNotes: formData.get('writingStyleNotes') ?? '',
    bannedConstructions: formData.get('bannedConstructions') ?? '',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) patch.display_name = parsed.data.displayName || null;
  if (parsed.data.timezone) patch.timezone = parsed.data.timezone;
  if (parsed.data.searchStartedOn) patch.search_started_on = parsed.data.searchStartedOn;
  if (parsed.data.ghostThresholdDays) patch.ghost_threshold_days = parsed.data.ghostThresholdDays;
  if (parsed.data.writingStyleNotes !== undefined) {
    patch.writing_style_notes = parsed.data.writingStyleNotes || null;
  }
  if (parsed.data.targetTitles !== undefined) {
    patch.target_titles = parsed.data.targetTitles
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (parsed.data.bannedConstructions !== undefined) {
    patch.banned_constructions = parsed.data.bannedConstructions
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) return { error: error.message };

  // Changing the ghost threshold changes what is ghosted, so re-derive now
  // rather than waiting for tonight's sweep.
  if (parsed.data.ghostThresholdDays) {
    await supabase.rpc('sweep_ghosted_applications', { p_user_id: user.id }).then(
      () => undefined,
      () => undefined,
    );
  }

  revalidatePath('/jobs/settings');
  revalidatePath('/jobs/pipeline');
  return { message: 'Saved.' };
}

/**
 * Disconnect an inbox, revoking the Google grant on the way out.
 *
 * Deleting our row without revoking leaves a live grant on the user's Google
 * account that they have no way to see from here. Revoke first, then delete.
 */
export async function disconnectInbox(accountId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: account } = await supabase
    .from('email_accounts')
    .select('id, oauth_refresh_token')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account) return { error: 'That inbox is not connected.' };

  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (account.oauth_refresh_token && key) {
    try {
      await gmailProvider.revokeToken(decryptToken(account.oauth_refresh_token as string, key));
    } catch {
      // A token Google has already invalidated fails here, which is fine —
      // the point is that we never keep one it still honours.
    }
  }

  const { error } = await supabase
    .from('email_accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/settings');
  return { error: null };
}
