'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';

/**
 * The vault's own top bar.
 *
 * Two sections, because there are two pages. It exists as its own component
 * rather than a parameterised shared one for the same reason the job side has
 * its own: the three navs diverge on what they count, badge and link to, and a
 * component with three sets of conditionals is harder to change than three
 * components.
 */
const SECTIONS = [
  { href: '/vault', label: 'Notes', exact: true },
  { href: '/vault/settings', label: 'Settings', exact: false },
] as const;

export function VaultTopNav({
  displayName,
  email,
}: {
  displayName: string | null;
  email: string;
}) {
  const pathname = usePathname();
  const initial = (displayName || email).charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <WorkspaceSwitcher current="vault" />

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Sections">
          {SECTIONS.map((section) => {
            // "Notes" covers /vault and every note under /vault/n/, but must
            // not light up on /vault/settings -- hence the exact flag rather
            // than a prefix match for both.
            const active = section.exact
              ? pathname === section.href || pathname.startsWith('/vault/n/')
              : pathname.startsWith(section.href);
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
              </Link>
            );
          })}
        </nav>

        <FeedbackButton />

        <Link
          href="/vault/settings"
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
