'use client';

import { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Popover } from '@/components/ui/popover';
import { usePopover } from '@/lib/use-popover';

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
 * It renders nothing at all until it has something to say, which is a change
 * from the version that sat on three of the four navs as a permanently empty
 * panel. The old comment defended that on the grounds that inventing
 * notifications would teach people to ignore the bell -- true, but a bell that
 * has never once rung teaches the same lesson, and by the time the first real
 * notification arrives nobody is looking.
 *
 * The seam is unchanged: a shell with something to say passes `notifications`,
 * the badge counts them and the panel lists them. What belongs here is
 * anything the system did or noticed on its own -- a return window closing, an
 * interview tomorrow with no prep, a vault token that expired -- all of which
 * are currently shouted as full-width page banners instead. See the attention
 * ladder in docs/design-language.html.
 */
export function NotificationsButton({
  notifications = [],
}: {
  notifications?: Notification[];
} = {}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const count = notifications.length;

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  if (count === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${count} notification${count === 1 ? '' : 's'}`}
        className={cn(
          'press relative flex size-8 items-center justify-center rounded-full transition-colors',
          open
            ? 'bg-accent-tint text-accent'
            : 'text-shell-muted hover:bg-shell-hover hover:text-shell-ink',
        )}
      >
        <Bell className="size-4" aria-hidden />
        <span className="tabular absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-caution-fill px-1 text-micro font-bold leading-4 text-caution-fill-ink">
          {count > 9 ? '9+' : count}
        </span>
        <span className="sr-only">Notifications, {count} unread</span>
      </button>

      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          tabIndex={-1}
          padding="panel"
          className="sm:w-80"
        >
          <h2 className="text-ui font-semibold text-ink">Notifications</h2>
          <ul className="mt-2 divide-y divide-border">
            {notifications.map((notification) => (
              <li key={notification.id} className="py-2">
                {notification.href ? (
                  <a
                    href={notification.href}
                    className="text-ui text-ink hover:text-accent"
                    onClick={() => setOpen(false)}
                  >
                    {notification.headline}
                  </a>
                ) : (
                  <span className="text-ui text-ink">{notification.headline}</span>
                )}
                {notification.detail && (
                  <p className="text-small text-ink-muted">{notification.detail}</p>
                )}
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  );
}
