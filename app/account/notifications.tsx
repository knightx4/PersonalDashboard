'use client';

import { useEffect, useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { removeNotificationSubscription, saveNotificationSubscription } from './notification-actions';

/**
 * The switch that sends the morning brief to this device (plan #1124).
 *
 * Per device, because a push subscription belongs to one browser: turning it
 * on registers the service worker (public/sw.js), asks for permission,
 * subscribes with the app's VAPID public key and stores the result; turning
 * it off unsubscribes and deletes the row. What the switch shows is read from
 * the browser itself, so it cannot claim a subscription the browser has lost.
 *
 * On an iPhone, web push only exists in the app added to the home screen, so
 * Safari in a tab is told that rather than shown a switch that cannot work.
 */

type Status = 'loading' | 'unsupported' | 'denied' | 'off' | 'on';

const SW_URL = '/sw.js';

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The VAPID key as the browser wants it: base64url decoded to bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  return registration ? registration.pushManager.getSubscription() : null;
}

export function NotificationsSection({ publicKey }: { publicKey: string | null }) {
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Status;
      if (!supported()) next = 'unsupported';
      else if (Notification.permission === 'denied') next = 'denied';
      else next = (await currentSubscription().catch(() => null)) ? 'on' : 'off';
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    if (!publicKey) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus(permission === 'denied' ? 'denied' : 'off');
      return;
    }
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }));
    const saved = await saveNotificationSubscription(subscription.toJSON(), navigator.userAgent);
    if (!saved.ok) {
      await subscription.unsubscribe().catch(() => undefined);
      throw new Error(saved.error);
    }
    setStatus('on');
  }

  async function turnOff() {
    const subscription = await currentSubscription();
    if (subscription) {
      const removed = await removeNotificationSubscription(subscription.endpoint);
      if (!removed.ok) throw new Error(removed.error);
      await subscription.unsubscribe();
    }
    setStatus('off');
  }

  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await (on ? turnOn() : turnOff());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    // The id is where Dash points when a watch would reach no phone (lib/watch/start.ts).
    <section id="notifications" className={cn(cardVariants({ padding: 'standard' }), 'scroll-mt-20')}>
      <h2 className="text-body font-semibold text-ink">Notifications</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        Each morning Dash writes a brief of your day. It can arrive on this device as a
        notification, and pressing it opens the brief.
      </p>

      <div className="mt-4 border-y border-border">
        {!publicKey ? (
          <p className="row-pad text-small text-ink-muted">
            Notifications are not set up on this server yet: the VAPID keys are missing from its
            environment.
          </p>
        ) : status === 'unsupported' ? (
          <p className="row-pad text-small text-ink-muted">
            This browser cannot receive notifications. On an iPhone, add Dash to the home screen
            from Safari&rsquo;s share menu, open it from there, and come back to this page.
          </p>
        ) : status === 'denied' ? (
          <p className="row-pad text-small text-ink-muted">
            Notifications are blocked for Dash on this device. Allow them in the device&rsquo;s
            settings, then come back to turn this on.
          </p>
        ) : (
          <label className="row-pad flex items-start gap-3">
            <input
              type="checkbox"
              role="switch"
              checked={status === 'on'}
              disabled={busy || status === 'loading'}
              onChange={(event) => void toggle(event.target.checked)}
              className="mt-1 size-4 accent-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-ui font-medium text-ink">
                {busy ? 'Saving…' : 'Send me the morning brief'}
              </span>
              <span className="block text-small leading-snug text-ink-muted">
                On this device only. Turn it on from each phone or computer you want it on.
              </span>
            </span>
          </label>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Banner tone="bad">{error}</Banner>
        </div>
      )}
    </section>
  );
}
