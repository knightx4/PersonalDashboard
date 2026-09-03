'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import type { ModuleId } from '@/lib/modules';

/**
 * Workspace switcher top left, sections across the top, then this workspace's
 * own settings and the account avatar top right. The gear is the module's
 * settings, the avatar is the account's -- the dividing line being whether the
 * setting would still mean anything with this module switched off.
 *
 * Review carries a count because an unattended review queue is exactly how the
 * funnel quietly becomes wrong, and a number you can see is the cheapest way to
 * keep that from happening.
 */
const SECTIONS = [
  { href: '/jobs/today', label: 'This week' },
  { href: '/jobs/pipeline', label: 'Pipeline' },
  { href: '/jobs/roles', label: 'Roles' },
  { href: '/jobs/companies', label: 'Companies' },
  { href: '/jobs/contacts', label: 'Contacts' },
  { href: '/jobs/interviews', label: 'Interviews' },
  { href: '/jobs/answers', label: 'Answers' },
  { href: '/jobs/analytics', label: 'Analytics' },
  { href: '/jobs/review', label: 'Review' },
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
        <WorkspaceSwitcher current="jobs" enabled={enabledModules} />

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Sections">
          {SECTIONS.map((section) => {
            const active = pathname.startsWith(section.href);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-150',
                  active
                    ? 'bg-brand-tint text-brand'
                    : 'text-ink-muted hover:bg-canvas hover:text-ink',
                )}
              >
                {section.label}
                {section.href === '/jobs/review' && reviewCount > 0 && (
                  <span className="tabular ml-1.5 rounded-full bg-accent-orange px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {reviewCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <FeedbackButton allHref="/jobs/feedback" />

        <Link
          href="/jobs/settings"
          aria-current={pathname.startsWith('/jobs/settings') ? 'page' : undefined}
          className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink"
          title="Job search settings"
        >
          <Settings className="size-4" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Job search settings</span>
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
