/**
 * Sending the morning brief to the person's phone (plan #1124).
 *
 * One notification per subscribed browser, carrying the brief and the page
 * pressing it opens. A push service that answers 404 or 410 has dropped the
 * subscription (the app was removed, or notifications were turned off in the
 * phone's settings), so its row is deleted and the next brief does not try it
 * again. Any other failure leaves the row alone: a push service being down
 * for a morning is not a reason to forget the phone.
 *
 * Kept free of web-push and Supabase so it can be tested with fakes; the
 * adapters are in lib/push/web-push.ts and inngest/core/day-brief.ts.
 */

import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import { BRIEF_ANCHOR } from '@/lib/day-brief/shown';

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** What the service worker (public/sw.js) reads out of a push. */
export type PushPayload = {
  title: string;
  body: string;
  /** The page to open when the notification is pressed. */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string;
};

export type PushPorts = {
  subscriptions(userId: string): Promise<PushSubscriptionRow[]>;
  /** Resolves with the push service's status code, or rejects. */
  send(subscription: PushSubscriptionRow, payload: string): Promise<number>;
  forget(ids: string[]): Promise<void>;
  sent(ids: string[], at: Date): Promise<void>;
};

export type PushResult = { sent: number; forgotten: number; failed: number };

/** Where the brief is shown: the picks under the date on the home page (plan #1241). */
export const BRIEF_URL = `/home#${BRIEF_ANCHOR}`;

/**
 * The brief as a notification: the title and body stored with the day
 * (plan #1240; lib/day-brief/notification.ts), which the run keeps within
 * what a lock screen shows. Clipped here as well, so a row written some other
 * way cannot send more. A row without a title is one written before #1240.
 */
export function briefPayload(brief: { day: string; title: string | null; body: string }): PushPayload {
  return {
    title: clip(brief.title ?? 'Your day', TITLE_MAX),
    body: clip(brief.body, BODY_MAX),
    url: BRIEF_URL,
    tag: `day-brief-${brief.day}`,
  };
}

/** The status codes that mean the subscription is gone for good. */
export function isGone(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** The status a web-push error carries, if it carries one. */
export function statusOf(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

export async function sendToPerson(
  ports: PushPorts,
  userId: string,
  payload: PushPayload,
  now: Date,
): Promise<PushResult> {
  const subscriptions = await ports.subscriptions(userId);
  if (subscriptions.length === 0) return { sent: 0, forgotten: 0, failed: 0 };

  const text = JSON.stringify(payload);
  const sent: string[] = [];
  const gone: string[] = [];
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        const status = await ports.send(subscription, text);
        if (isGone(status)) gone.push(subscription.id);
        else sent.push(subscription.id);
      } catch (err) {
        if (isGone(statusOf(err))) gone.push(subscription.id);
        else failed += 1;
      }
    }),
  );

  if (gone.length > 0) await ports.forget(gone);
  if (sent.length > 0) await ports.sent(sent, now);
  return { sent: sent.length, forgotten: gone.length, failed };
}
