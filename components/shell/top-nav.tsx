'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * Product name top left, section nav across the top, account avatar top right.
 * Review carries a count because an unattended review queue is how the
 * dashboard quietly becomes wrong.
 */
const SECTIONS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/orders', label: 'Orders' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/sell', label: 'Sell' },
  { href: '/returns', label: 'Returns' },
  { href: '/saved', label: 'Saved' },
  { href: '/review', label: 'Review' },
] as const;

export function TopNav({
  displayName,
  email,
  reviewCount = 0,
}: {
  displayName: string | null;
  email: string;
  reviewCount?: number;
}) {
  const pathname = usePathname();
  const initial = (displayName || email).charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span
            className="size-6 rounded-md bg-brand"
            style={{
              backgroundImage:
                'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent-pink) 100%)',
            }}
            aria-hidden
          />
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
            Shopping Manager
          </span>
        </Link>

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
                {section.href === '/review' && reviewCount > 0 && (
                  <span className="tabular ml-1.5 rounded-full bg-accent-orange px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {reviewCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/settings"
          className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand"
          title={displayName ?? email}
        >
          {initial}
          <span className="sr-only">Account and settings</span>
        </Link>
      </div>
    </header>
  );
}
