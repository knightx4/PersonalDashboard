'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordConnectorRevocation } from '@/lib/connector/calls';

/**
 * Remove a connected app (plan #1258). Two writes, in this order:
 *
 *  1. revokeGrant, so Supabase's OAuth server stops refreshing the app's
 *     tokens and forgets that it was allowed;
 *  2. a row in core.connector_revocations, so an access token the app already
 *     holds (good for up to an hour) is refused by /api/mcp from now on
 *     (lib/connector/access.ts).
 *
 * The revoke goes first: a revocation row with the grant still live would let
 * the app refresh into a token issued after it, which the route accepts.
 * An app with calls but no grant stays listed as history with nothing to
 * remove, so a failed second write cannot be retried from the page; it is
 * tried twice here instead.
 * Runs on the sign-in cookie, which carries no client_id, so neither write is
 * caught by the read-only rule for connector tokens (plan #1257).
 */
// latency: pending
export async function removeConnectedApp(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientId = String(formData.get('clientId') ?? '').trim();
  if (!clientId)
    return { ok: false, error: 'Which app to remove was missing. Reload and try again.' };

  const user = await requireUser();
  const supabase = await createClient();
  const revoked = await supabase.auth.oauth.revokeGrant({ clientId });
  if (revoked.error) {
    return { ok: false, error: `Could not remove the app: ${revoked.error.message}` };
  }

  // Tried twice: once the grant is gone the app leaves the list, so there is
  // no second press to retry this from.
  const core = await createCoreClient();
  const recorded = await recordConnectorRevocation(core, user.id, clientId)
    .catch(() => recordConnectorRevocation(core, user.id, clientId))
    .then(
      () => true,
      () => false,
    );
  if (!recorded) {
    revalidatePath('/account');
    return {
      ok: false,
      error:
        'The app is removed and can no longer renew its access, but the access it already holds could not be cut off, so it may keep reading for up to an hour.',
    };
  }

  revalidatePath('/account');
  return { ok: true };
}
