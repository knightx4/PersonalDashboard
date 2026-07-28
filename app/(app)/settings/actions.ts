'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { decryptToken } from '@/lib/crypto/tokens';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { gmailProvider } from '@/lib/email/providers/gmail';

/** Revoke Google's grant and remove the email_accounts row (cascades sync data). */
export async function disconnectInbox(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const supabase = await createClient();
  const { data: account, error: fetchError } = await supabase
    .from('email_accounts')
    .select('id, oauth_refresh_token')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (fetchError || !account) {
    return;
  }

  if (account.oauth_refresh_token) {
    try {
      const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
      const refresh = decryptToken(account.oauth_refresh_token, TOKEN_ENCRYPTION_KEY);
      await gmailProvider.revokeToken(refresh);
    } catch {
      // Still delete locally if Google revoke fails (token may already be dead).
    }
  }

  const { error: deleteError } = await supabase
    .from('email_accounts')
    .delete()
    .eq('id', account.id)
    .eq('user_id', user.id);

  if (deleteError) {
    return;
  }

  revalidatePath('/settings');
}
