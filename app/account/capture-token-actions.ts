'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { captureTokenLabel, createCaptureToken, revokeCaptureToken } from '@/lib/capture/tokens';

/**
 * Make and revoke personal capture tokens (plan #1705). Both run on the
 * person's own session, so RLS and core.revoke_capture_token keep them to
 * their own tokens.
 */

export type MakeTokenState = {
  /** The token just made, shown once and never readable again. */
  made?: { label: string; token: string };
  error?: string;
};

// latency: pending
export async function makeCaptureTokenAction(
  _prev: MakeTokenState,
  formData: FormData,
): Promise<MakeTokenState> {
  const label = captureTokenLabel(String(formData.get('label') ?? ''));
  if (!label) return { error: 'Give the token a name, such as the phone or Shortcut it is for.' };

  const user = await requireUser();
  try {
    const { token } = await createCaptureToken(await createCoreClient(), user.id, label);
    revalidatePath('/account');
    return { made: { label, token } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not make the token.' };
  }
}

// latency: pending
export async function revokeCaptureTokenAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Which token to revoke was missing. Reload and try again.' };

  await requireUser();
  try {
    const revoked = await revokeCaptureToken(await createCoreClient(), id);
    if (!revoked) return { ok: false, error: 'That token was not found. Reload and try again.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not revoke the token.' };
  }
  revalidatePath('/account');
  return { ok: true };
}
