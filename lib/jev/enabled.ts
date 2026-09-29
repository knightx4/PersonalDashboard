import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Whether this account's text may be sent to Jev.
 *
 * Jev is hosted by TypeSafe, so every call sends the email or note it reads
 * off the app. Only the plan owner agreed to that (decision #1163), and other
 * accounts exist, so each step of feature #1161 asks this first and passes
 * the answer to decideWithJev as `enabled`. An account that has not opted in
 * keeps the Haiku path it had, and nothing reaches TypeSafe.
 *
 * Backed by `core.account_settings.jev_enabled` (migration 0120), false by
 * default. One indexed read by primary key; an inngest job reads it once per
 * user per run, not once per message.
 *
 * Never throws. Any failure to read it, including a deploy that lands before
 * the column exists, reads as false: the safe answer is the one that sends
 * nothing.
 */
export async function jevEnabledFor(
  core: Pick<CoreSupabaseClient, 'from'>,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await core
      .from('account_settings')
      .select('jev_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return false;
    return (data as { jev_enabled?: unknown }).jev_enabled === true;
  } catch {
    return false;
  }
}
