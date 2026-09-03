'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/cn';

export type Notification = {
  id: string;
  /** One line, written as the thing that happened. */
  headline: string;
  detail?: string | null;
  href?: string | null;
  at?: string | null;
};

/**
 * Where the app tells you something happened.
 *
 * Deliberately empty for now: nothing in the app has earned a notification
 * yet, and inventing some to fill the panel would teach the user to ignore it
 * before the first real one arrives. The seam is the `notifications` prop —
 * a shell that has something to say passes it, the badge counts it, and the
 * panel lists it, with no further work here.
 */
export function NotificationsButton({
  notifications = [],
}: {
  notifications?: Notification[];
} = {}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const count = notifications.length;

  // Close on Escape, and on a click outside the panel. Same contract as the
  // feedback button beside it, so the two behave identically.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      clearTimeout(timer);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={count > 0 ? `${count} notification(s)` : 'Notifications'}
        className={cn(
          'press relative flex size-8 items-center justify-center rounded-full transition-colors',
          open ? 'bg-brand-tint text-brand' : 'text-ink-muted hover:bg-canvas hover:text-ink',
        )}
      >
        <Bell className="size-4" aria-hidden />
        {count > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent-orange px-1 text-[10px] font-semibold leading-4 text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
        <span className="sr-only">
          {count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          // Pinned to the viewport on a phone for the same reason the feedback
          // panel is: anchored to the button it hangs off the left edge.
          className="fixed inset-x-4 top-16 z-50 rounded-card border border-border bg-surface p-4 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-80"
        >
          <h2 className="text-sm font-semibold text-ink">Notifications</h2>
          {count === 0 ? (
            <p className="mt-2 text-[13px] text-ink-muted">
              Nothing yet. This is where the app will tell you something happened.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {notifications.map((notification) => (
                <li key={notification.id} className="py-2">
                  {notification.href ? (
                    <a
                      href={notification.href}
                      className="text-[13px] text-ink hover:text-brand"
                      onClick={() => setOpen(false)}
                    >
                      {notification.headline}
                    </a>
                  ) : (
                    <span className="text-[13px] text-ink">{notification.headline}</span>
                  )}
                  {notification.detail && (
                    <p className="text-[12px] text-ink-muted">{notification.detail}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
