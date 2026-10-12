import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import { isXOAuthConfigured, xClient, xOAuthEnv } from '@/lib/x/env';
import { runXRead, type XReadTrigger, type XRunResult } from '@/lib/x/read';

/**
 * The daily read of every connected X account (plan #1819), a stage of the
 * one daily cron, and the read the callback starts as soon as an account is
 * connected. Both go through the service client, so every query names the
 * user; the read itself is lib/x/read.ts.
 *
 * Without the X app's keys there is nothing to read with, so the stage says
 * so and returns rather than failing the cron.
 */
export async function runXReadFor(userId: string, trigger: XReadTrigger): Promise<XRunResult | { state: 'unconfigured' }> {
  if (!isXOAuthConfigured()) return { state: 'unconfigured' };
  const env = xOAuthEnv();
  return runXRead(createServiceSupabase(), userId, {
    trigger,
    client: xClient(env),
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
  });
}

export async function runXReadsForAll(): Promise<Record<string, unknown>> {
  if (!isXOAuthConfigured()) return { skipped: 'X keys not set' };
  const db = createServiceSupabase();
  const { data, error } = await db.from('x_accounts').select('user_id').eq('status', 'active');
  if (error) throw new Error(error.message);

  const summary: Record<string, unknown> = { accounts: data?.length ?? 0 };
  for (const row of (data ?? []) as { user_id: string }[]) {
    try {
      summary[row.user_id] = await runXReadFor(row.user_id, 'daily');
    } catch (err) {
      summary[row.user_id] = { error: err instanceof Error ? err.message : 'failed' };
    }
  }
  return summary;
}
