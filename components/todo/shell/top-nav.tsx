'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import type { ModuleId } from '@/lib/modules';

/**
 * Two sections and nothing else.
 *
 * "Agenda" is what needs you; "All" is everything, including what is finished.
 * A todo module that grows a third section has probably grown a feature it did
 * not need.
 */
const SECTIONS = [
  { href: '/todo', label: 'Agenda', exact: true },
  { href: '/todo/all', label: 'All', exact: false },
] as const;

export function TodoTopNav({
  displayName,
  email,
  enabledModules,
}: {
  displayName: string | null;
  email: string;
  enabledModules?: readonly ModuleId[];
}) {
  const pathname = usePathname();
  const initial = (displayName || email).charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <WorkspaceSwitcher current="todo" enabled={enabledModules} />

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Sections">
          {SECTIONS.map((section) => {
            // Exact for the agenda, or every page in the workspace would light
            // it up -- the same flag the vault's nav carries, for the same
            // reason.
            const active = section.exact
              ? pathname === section.href
              : pathname.startsWith(section.href);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
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
          href="/todo/settings"
          aria-current={pathname.startsWith('/todo/settings') ? 'page' : undefined}
          className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink"
          title="Todo settings"
        >
          <Settings className="size-4" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Todo settings</span>
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
