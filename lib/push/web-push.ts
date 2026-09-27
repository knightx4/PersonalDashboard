import 'server-only';

import webpush from 'web-push';
import type { PushSubscriptionRow } from './send';

/**
 * The VAPID keys that sign every push (plan #1124), from the environment.
 *
 * VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set in the Vercel project; the
 * public half is also what the account page hands the browser when it
 * subscribes, so the two always come from the same place. The subject names
 * who is sending, which Apple's push service insists is a mailto: or https:
 * URL: VAPID_SUBJECT when set, otherwise the production domain Vercel
 * provides, otherwise the app URL.
 */
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export function vapidKeys(): VapidKeys | null {
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    (production ? `https://${production}` : process.env.NEXT_PUBLIC_APP_URL?.trim()) ||
    'https://localhost';
  return { publicKey, privateKey, subject };
}

/** A notification lives this long at the push service before it is dropped. */
const TTL_SECONDS = 6 * 3600;

/**
 * Sends one encrypted payload and resolves with the push service's status.
 * A non-2xx answer rejects with a WebPushError carrying `statusCode`, which
 * lib/push/send.ts reads to tell a dropped subscription from a bad morning.
 */
export async function sendWebPush(
  keys: VapidKeys,
  subscription: PushSubscriptionRow,
  payload: string,
): Promise<number> {
  const result = await webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    payload,
    {
      vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: TTL_SECONDS,
      urgency: 'normal',
    },
  );
  return result.statusCode;
}
