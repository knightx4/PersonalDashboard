'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { NotificationsButton } from '@/components/shell/notifications-button';
import { ThemePicker } from '@/components/shell/theme-picker';
import {
  WorkspaceSwitcher,
  type SwitcherCounts,
} from '@/components/shell/workspace-switcher';
import type { ModuleId } from '@/lib/modules';
import type { ThemeChoice } from '@/lib/theme';

export type NavSection = {
  href: string;
  label: string;
  /**
   * Prefix match by default. Exact for a section whose href is a parent of the
   * others -- /todo and /vault -- or every page in the workspace lights it up.
   */
  exact?: boolean;
  /** Also treat these prefixes as this section. */
  alsoMatches?: readonly string[];
  /**
   * A badge only where an unattended count causes silent data damage. Review
   * has earned one -- an unworked queue is how the dashboard quietly becomes
   * wrong. Nothing else in this app has.
   */
  badge?: number;
};

/**
 * The top bar, once.
 *
 * There were four of these, each about ninety per cent identical, and the
 * comments defended the split on the grounds that three components are easier
 * to change than one with three sets of conditionals. What the split actually
 * produced was drift nobody chose: Todo had no notifications button, Vault had
 * no settings gear, and the job side's section links were a pixel smaller than
 * everyone else's.
 *
 * Left to right, and this order is fixed: which workspace you are in, where in
 * it you are, the cross-cutting tools, this module's settings, the account.
 *
 * Two settings entries, deliberately: the gear is this module's, the avatar is
 * the account's. The dividing line is whether the setting would still mean
 * anything with the module switched off.
 */
export function WorkspaceNav({
  module,
  sections,
  settingsHref,
  settingsLabel,
  feedbackHref,
  displayName,
  email,
  enabledModules,
  counts,
  theme,
}: {
  module: ModuleId | null;
  sections: readonly NavSection[];
  /** Omitted where the workspace has no settings of its own. */
  settingsHref?: string;
  settingsLabel?: string;
  feedbackHref?: string;
  displayName: string | null;
  email: string;
  enabledModules?: readonly ModuleId[];
  counts?: SwitcherCounts;
  theme: ThemeChoice;
}) {
  const pathname = usePathname();
  const initial = (displayName || email).charAt(0).toUpperCase();
  const stripRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  const isActive = (section: NavSection) =>
    section.exact
      ? pathname === section.href ||
        (section.alsoMatches ?? []).some((prefix) => pathname.startsWith(prefix))
      : pathname.startsWith(section.href);

  /**
   * Bring the active tab into view on arrival.
   *
   * Without this you can land on /jobs/review with its own tab scrolled off the
   * right of a phone screen and no cue that it exists -- which was the worst
   * defect in the app.
   */
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    const strip = stripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <WorkspaceSwitcher current={module} enabled={enabledModules} counts={counts} />

        {/* The fade makes the scroll discoverable. A silently scrollable strip
            is a strip with hidden items. */}
        <div className="min-w-0 flex-1 [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] sm:[mask-image:none]">
          <nav
            ref={stripRef}
            className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Sections"
          >
            {sections.map((section) => {
              const active = isActive(section);
              return (
                <Link
                  key={section.href}
                  ref={active ? activeRef : undefined}
                  href={section.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative shrink-0 rounded-lg px-3 py-1.5 text-ui font-medium transition-colors duration-150',
                    active
                      ? 'bg-accent-tint text-accent'
                      : 'text-ink-muted hover:bg-sunken hover:text-ink',
                  )}
                >
                  {section.label}
                  {section.badge !== undefined && section.badge > 0 && (
                    <span className="tabular ml-1.5 rounded-full bg-caution-fill px-1.5 py-0.5 text-micro font-bold text-[#14100a]">
                      {section.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <ThemePicker value={theme} />
          <NotificationsButton />
          <FeedbackButton allHref={feedbackHref} />

          {settingsHref && (
            <Link
              href={settingsHref}
              aria-current={pathname.startsWith(settingsHref) ? 'page' : undefined}
              className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
              title={settingsLabel ?? 'Settings'}
            >
              <Settings className="size-4" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">{settingsLabel ?? 'Settings'}</span>
            </Link>
          )}

          <Link
            href="/account"
            className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-tint text-ui font-semibold text-accent"
            title={displayName ?? email}
          >
            {initial}
            <span className="sr-only">Account</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
