'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { encryptToken } from '@/lib/crypto/tokens';
import { createVaultClient } from '@/lib/vault/auth/server';
import { normaliseSubpath } from '@/lib/vault/paths';
import { parseRepoInput } from '@/lib/vault/repo-input';

/**
 * Connecting, disconnecting and kicking a vault.
 *
 * Every write goes through the session client, so RLS decides which row is
 * touched. The user id is taken from requireUser() and never from the form --
 * a hidden field naming a user is a hole, not a convenience.
 */

export type VaultActionState = { error?: string; message?: string };

function encryptionKey(): string {
  return z.object({ TOKEN_ENCRYPTION_KEY: z.string().min(1) }).parse(process.env)
    .TOKEN_ENCRYPTION_KEY;
}

const ConnectInput = z.object({
  repo: z.string().min(1, 'Enter the repository your vault lives in.'),
  branch: z.string().trim().default('main'),
  subpath: z.string().trim().default(''),
  token: z.string().trim().min(1, 'Paste a fine-grained access token.'),
});

export async function connectVault(
  _prev: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const user = await requireUser();

  const parsed = ConnectInput.safeParse({
    repo: formData.get('repo') ?? '',
    branch: formData.get('branch') ?? 'main',
    subpath: formData.get('subpath') ?? '',
    token: formData.get('token') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const repo = parseRepoInput(parsed.data.repo);
  if (!repo) {
    return { error: 'That does not look like a GitHub repository. Try owner/repo.' };
  }

  const supabase = await createVaultClient();

  const { error } = await supabase.from('vault_connections').upsert(
    {
      user_id: user.id,
      provider: 'github',
      repo_owner: repo.owner,
      repo_name: repo.repo,
      branch: parsed.data.branch || 'main',
      subpath: normaliseSubpath(parsed.data.subpath),
      access_token: encryptToken(parsed.data.token, encryptionKey()),
      status: 'active',
      last_error: null,
      // Reconnecting after an expired token must not restart the vault: the
      // cursor and the notes are still valid, only the credential was not.
    },
    { onConflict: 'user_id' },
  );

  if (error) return { error: `Saving the connection failed: ${error.message}` };

  revalidatePath('/vault');
  revalidatePath('/vault/settings');
  return { message: 'Vault connected. The first sync runs on the next scheduled pass.' };
}

/**
 * Disconnect, and take the mirror with it.
 *
 * The notes cascade out with the connection, deliberately. They are a copy:
 * the vault itself is untouched and reconnecting rebuilds them. Keeping a
 * mirror of someone's private notes around after they asked to disconnect
 * would be the wrong default by a wide margin.
 */
export async function disconnectVault(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const supabase = await createVaultClient();
  await supabase
    .from('vault_connections')
    .delete()
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);

  revalidatePath('/vault');
  revalidatePath('/vault/settings');
}

/**
 * Ask for a full re-read on the next run.
 *
 * Clearing the cursor is all it takes: the sync then walks the whole tree
 * again, and because change detection is by blob sha it re-fetches only what
 * actually differs. On an unchanged vault this costs one tree listing and no
 * note fetches at all.
 */
export async function rescanVault(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const supabase = await createVaultClient();
  await supabase
    .from('vault_connections')
    .update({
      sync_cursor: null,
      backfill_after_path: null,
      backfill_commit_sha: null,
      backfill_completed_at: null,
      last_error: null,
    })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);

  revalidatePath('/vault');
  revalidatePath('/vault/settings');
}
