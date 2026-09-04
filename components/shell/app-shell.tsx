'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Settings, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { NotificationsButton } from '@/components/shell/notifications-button';
import { ThemePicker } from '@/components/shell/theme-picker';
import { ModuleMark } from '@/components/ui/module-mark';
import { NAV_ICONS, type NavIconName } from '@/components/shell/nav-icons';
import {
  WorkspaceSwitcher,
  type SwitcherCounts,
} from '@/components/shell/workspace-switcher';
import { HOME_MARK, moduleById, type ModuleId } from '@/lib/modules';
import type { ThemeChoice } from '@/lib/theme';

export type NavSection = {
  href: string;
  label: string;
  /**
   * Named, not passed: see components/shell/nav-icons.ts. A section without
   * one still renders -- the label is what the row means, and the icon is
   * what makes it findable at a glance.
   */
  icon?: NavIconName;
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
 * The shell: a sidebar of sections, a top bar that says where you are, and the
 * page.
 *
 * The sections were a horizontal strip, which is a shape that stops working at
 * about six items. The job search has ten. A vertical list holds ten without
 * crowding, has room for a count beside each, and leaves the top bar free to
 * do the one thing a top bar is good at -- naming the page and holding the
 * controls that belong to the account rather than to the page.
 *
 * The filter rail, where a page has one, stays a second column from xl up and
 * a sheet below that. Merging it into this sidebar is the obvious next move
 * and is deliberately not done here: the rail is server-rendered markup inside
 * the page, and hoisting it into a layout means either a portal, which would
 * make filters appear only after hydration, or moving it into every page's
 * props. Neither is worth doing in the same change as this one.
 */
export function AppShell({
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
  banner,
  children,
}: {
  module: ModuleId | null;
  sections: readonly NavSection[];
  settingsHref?: string;
  settingsLabel?: string;
  feedbackHref?: string;
  displayName: string | null;
  email: string;
  enabledModules?: readonly ModuleId[];
  counts?: SwitcherCounts;
  theme: ThemeChoice;
  /** Rendered above the page, inside the content column. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const initial = (displayName || email).charAt(0).toUpperCase();

  const isActive = (section: NavSection) =>
    section.exact
      ? pathname === section.href ||
        (section.alsoMatches ?? []).some((prefix) => pathname.startsWith(prefix))
      : pathname.startsWith(section.href);

  const active = sections.find(isActive);
  // The top bar names the page. Falling back to the workspace rather than to
  // nothing: a bar that goes blank on an unlisted route reads as broken.
  const title = active?.label ?? moduleById(module)?.label ?? 'Home';

  useEffect(() => {
    if (!drawer) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawer(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawer]);

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Sections">
      {sections.map((section) => {
        const on = isActive(section);
        const Icon = section.icon ? NAV_ICONS[section.icon] : null;
        return (
          <Link
            key={section.href}
            href={section.href}
            // Opening a section is exactly when the drawer should close.
            onClick={() => setDrawer(false)}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-2 text-ui font-medium transition-colors duration-150',
              on
                ? 'bg-shell-hover text-shell-ink'
                : 'text-shell-muted hover:bg-shell-hover/60 hover:text-shell-ink',
            )}
          >
            {/* The workspace's own colour, as a bar rather than a tint. A tint
                would have to be legible on five different shells; a 2px bar in
                the mark key's fixed hue is vivid on all of them. */}
            <span
              className={cn(
                'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full transition-opacity duration-150',
                on ? 'opacity-100' : 'opacity-0',
              )}
              style={{ background: (moduleById(module) ?? HOME_MARK).key.from }}
              aria-hidden
            />
            {/* Muted until the row is current, so the column reads as a list
                of names with marks beside them rather than a wall of icons
                competing with the one that says where you are. */}
            {Icon && (
              <Icon
                className={cn(
                  'size-4 shrink-0 transition-colors duration-150',
                  on ? 'text-shell-ink' : 'text-shell-muted group-hover:text-shell-ink',
                )}
                strokeWidth={1.75}
                aria-hidden
              />
            )}
            <span className="flex-1 truncate">{section.label}</span>
            {section.badge !== undefined && section.badge > 0 && (
              <span className="tabular rounded-full bg-caution-fill px-1.5 py-0.5 text-micro font-bold text-[#14100a]">
                {section.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarInner = (
    <>
      <div className="px-3 pt-3">
        <WorkspaceSwitcher
          current={module}
          enabled={enabledModules}
          counts={counts}
          onShell
        />
      </div>
      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">{nav}</div>
    </>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      {/* The column, from lg up. */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-shell-border bg-shell lg:flex">
        {sidebarInner}
      </aside>

      {/* The drawer, below lg. */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-shell-border bg-shell">
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="press flex size-8 items-center justify-center rounded-lg text-shell-muted hover:bg-shell-hover hover:text-shell-ink"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
                <span className="sr-only">Close navigation</span>
              </button>
            </div>
            {sidebarInner}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-4" strokeWidth={2} aria-hidden />
            </button>

            <span className="lg:hidden">
              <ModuleMark module={module} size="sm" />
            </span>

            <h2 className="font-display min-w-0 flex-1 truncate text-lead font-semibold tracking-tight text-ink">
              {title}
            </h2>

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

        {banner}
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
