import { after, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { runVaultSyncForUser } from '@/inngest/vault/sync';

// A run gives itself RUN_BUDGET_MS (four minutes) and then stops cleanly, so
// the handler has to outlive it or the hand-off is cut mid-write.
export const maxDuration = 300;

const REASONS: Record<string, { status: number; error: string }> = {
  no_connection: { status: 404, error: 'No vault is connected.' },
  needs_reauth: {
    status: 409,
    error: 'The connection needs a new access token before it can sync.',
  },
  already_running: { status: 409, error: 'A sync is already running.' },
};

/**
 * Sync this user's vault now, rather than waiting for the nightly pass.
 *
 * `after()` rather than awaiting the sync: the answer to "did it start" is
 * known immediately and the run itself takes minutes. A button that holds a
 * connection open for four minutes looks broken and dies with the tab, which
 * is exactly the failure the mailbox's own background scan was fixed for.
 *
 * The user id comes from the session and is passed down; nothing in the body
 * names a user, and there is no body at all.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await runVaultSyncForUser(user.id);

  if (!result.started) {
    const reason = REASONS[result.reason];
    return NextResponse.json(
      { started: false, reason: result.reason, error: reason.error },
      { status: reason.status },
    );
  }

  after(() => result.run);
  return NextResponse.json({ started: true });
}
