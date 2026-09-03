'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { NotificationsButton } from '@/components/shell/notifications-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import type { ModuleId } from '@/lib/modules';

/**
 * Workspace switcher top left, section nav across the top, then this
 * workspace's own settings and the account avatar top right. Review carries a
 * count because an unattended review queue is how the dashboard quietly becomes
 * wrong.
 *
 * Two settings entries, deliberately: the gear is this module's settings, the
 * avatar is the account's. The dividing line is whether the setting would still
 * mean anything with the module switched off.
 */
const SECTIONS = [
  { href: '/shopping/dashboard', label: 'Dashboard' },
  { href: '/shopping/orders', label: 'Orders' },
  { href: '/shopping/inventory', label: 'Inventory' },
  { href: '/shopping/sell', label: 'Sell' },
  { href: '/shopping/returns', label: 'Returns' },
  { href: '/shopping/saved', label: 'Saved' },
  { href: '/shopping/share', label: 'Share' },
  { href: '/shopping/review', label: 'Review' },
] as const;

export function TopNav({
  displayName,
  email,
  enabledModules,
  reviewCount = 0,
}: {
  displayName: string | null;
  email: string;
  enabledModules?: readonly ModuleId[];
  reviewCount?: number;
}) {
  const pathname = usePathname();
  const initial = (displayName || email).charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <WorkspaceSwitcher current="shopping" enabled={enabledModules} />

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Sections">
          {SECTIONS.map((section) => {
            const active = pathname.startsWith(section.href);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
                  active
                    ? 'bg-brand-tint text-brand'
                    : 'text-ink-muted hover:bg-canvas hover:text-ink',
                )}
              >
                {section.label}
                {section.href === '/shopping/review' && reviewCount > 0 && (
                  <span className="tabular ml-1.5 rounded-full bg-accent-orange px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {reviewCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <NotificationsButton />
        <FeedbackButton />

        <Link
          href="/shopping/settings"
          aria-current={pathname.startsWith('/shopping/settings') ? 'page' : undefined}
          className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink"
          title="Shopping settings"
        >
          <Settings className="size-4" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Shopping settings</span>
        </Link>

        <Link
          href="/account"
          className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand"
          title={displayName ?? email}
        >
          {initial}
          <span className="sr-only">Account</span>
        </Link>
      </div>
    </header>
  );
}
