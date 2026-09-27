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

/** The page the brief is shown on. */
export const BRIEF_URL = '/home';

/**
 * Longer than any lock screen shows, short enough to stay well inside the
 * 4 KB a push service carries once encrypted. The brief is at most 1,000
 * characters (core.day_briefs), so this trims only in theory.
 */
const BODY_LIMIT = 1000;

export function briefPayload(body: string, day: string): PushPayload {
  const text = body.trim();
  return {
    title: 'Your day',
    body: text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT - 1)}…` : text,
    url: BRIEF_URL,
    tag: `day-brief-${day}`,
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
