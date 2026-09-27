'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
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
