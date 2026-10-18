'use server';

import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';

/**
 * Storing and forgetting this browser's push subscription (plan #1124).
 *
 * The browser subscribes itself (app/account/notifications.tsx) and hands the
 * result here; the morning brief run reads core.push_subscriptions and sends
 * to each row. Both writes go through the person's own session, so RLS keeps
 * them to their own rows.
 */

const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export type NotificationResult = { ok: true } | { ok: false; error: string };

// latency: pending
export async function saveNotificationSubscription(
  subscription: unknown,
  userAgent: string | null,
): Promise<NotificationResult> {
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, error: 'This browser sent a subscription Dash cannot read.' };

  const user = await requireUser();
  const core = await createCoreClient();
  const { endpoint, keys } = parsed.data;

  // A browser that subscribes again gets the same endpoint back, so the old
  // row is replaced rather than kept beside the new one.
  const removed = await core
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint);
  if (removed.error) return { ok: false, error: removed.error.message };

  const { error } = await core.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: userAgent?.slice(0, 500) || null,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? 'This browser is already receiving notifications for another account.'
          : error.message,
    };
  }
  return { ok: true };
}

// latency: pending
export async function removeNotificationSubscription(endpoint: string): Promise<NotificationResult> {
  const user = await requireUser();
  const core = await createCoreClient();
  const { error } = await core
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type FinishNoticeResult = { ok: true; enabled: boolean } | { ok: false; error: string };

/**
 * Whether Dash tells this person when it has finished its work (plan #2389).
 * No row yet reads as on, the column's default; the row is made the first time
 * the switch is turned.
 */
// latency: pending
export async function readFinishNotice(): Promise<FinishNoticeResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dash_finish_notifications')
    .select('enabled')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { ok: false, error: 'Could not read this setting. Reload to try again.' };
  return { ok: true, enabled: data?.enabled ?? true };
}

// latency: pending
export async function saveFinishNotice(enabled: boolean): Promise<FinishNoticeResult> {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'That setting was not understood.' };
  const user = await requireUser();
  const supabase = await createClient();
  // updated_at is not set by a trigger, so it goes in with every write.
  const { error } = await supabase
    .from('dash_finish_notifications')
    .upsert(
      { user_id: user.id, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) return { ok: false, error: 'Could not save that. Try again.' };
  return { ok: true, enabled };
}
