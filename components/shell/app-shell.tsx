'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { NotificationsButton } from '@/components/shell/notifications-button';
import { ThemePicker } from '@/components/shell/theme-picker';
import { StatusLine } from '@/components/shell/status-line';
import { CommandPalette } from '@/components/shell/command-palette';
import { KeyHintsProvider, Kbd } from '@/components/shell/key-hints';
import { ToastProvider } from '@/components/ui/toast';
import { ModuleMark } from '@/components/ui/module-mark';
import { NAV_ICONS, type NavIconName } from '@/components/shell/nav-icons';
import {
  WorkspaceSwitcher,
  type SwitcherCounts,
} from '@/components/shell/workspace-switcher';
import { HOME_MARK, moduleById, type ModuleId } from '@/lib/modules';
import type { ThemeChoice } from '@/lib/theme';
import type { ActivityLine } from '@/lib/shell/activity';
import type { Brief } from '@/lib/shell/brief';

const NAV_COLLAPSED_KEY = 'pt_nav_collapsed';

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
  brief,
  activity = [],
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
  /** The one thing this workspace would say if it could say only one thing. */
  brief?: Brief | null;
  /** What the system did while nobody was looking. */
  activity?: ActivityLine[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const initial = (displayName || email).charAt(0).toUpperCase();

  /**
   * How wide you want the column, remembered.
   *
   * Per-viewer and disposable, so localStorage rather than the account -- the
   * same call the workspace switcher makes for where you were, and guarded the
   * same way, because it throws outright where site data is blocked. Read
   * after mount rather than during render: the server has no way to know the
   * answer, and rendering one width and hydrating another is a mismatch.
   */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
    } catch {
      /* Blocked storage simply means the column starts open every time. */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* Not remembering it is a smaller failure than not doing it. */
      }
      return next;
    });
  }

  const isActive = (section: NavSection) =>
    section.exact
      ? pathname === section.href ||
        (section.alsoMatches ?? []).some((prefix) => pathname.startsWith(prefix))
      : pathname.startsWith(section.href);

  /**
   * ⌥1–9 jumps to a section, in the order the column lists them.
   *
   * Alt rather than Cmd: ⌘1–4 already switch workspaces and ⌘K opens the
   * palette, and a second meaning on the same modifier is a coin toss. Read
   * by `event.code` because on a Mac ⌥ plus a digit types a symbol, not the
   * digit. The hints beside each row appear while the key is held; see
   * key-hints.tsx.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const match = /^Digit([1-9])$/.exec(event.code);
      if (!match) return;
      const target = sections[Number(match[1]) - 1];
      if (!target) return;
      event.preventDefault();
      router.push(target.href);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sections, router]);

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

  /**
   * One row of the column. The settings link uses it too, so the workspace's
   * own settings look like a place you can go rather than a tool in a tray.
   */
  const navRow = ({
    href,
    label,
    Icon,
    on,
    badge,
    narrow = false,
    hint,
  }: {
    href: string;
    label: string;
    Icon: React.ComponentType<{
      className?: string;
      strokeWidth?: number;
      'aria-hidden'?: boolean;
    }> | null;
    on: boolean;
    badge?: number;
    /** In the collapsed column: the icon alone, with the name as its tooltip. */
    narrow?: boolean;
    /** The shortcut that opens it, shown while a modifier is held. */
    hint?: string;
  }) => (
    <Link
      key={href}
      href={href}
      // Opening a section is exactly when the drawer should close.
      onClick={() => setDrawer(false)}
      aria-current={on ? 'page' : undefined}
      title={narrow ? label : undefined}
      className={cn(
        'group relative flex items-center gap-2 rounded-lg py-1.5 text-ui font-medium transition-colors duration-150',
        narrow ? 'justify-center px-2' : 'pl-3 pr-2',
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
      {/* The name is a tooltip in the narrow column, but it stays in the
          accessibility tree either way: a rail of unlabelled icons is not a
          navigation a screen reader can use. */}
      <span className={cn('flex-1 truncate', narrow && 'sr-only')}>{label}</span>
      {hint && !narrow && <Kbd>{hint}</Kbd>}
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'tabular bg-caution-fill font-bold text-caution-fill-ink',
            narrow
              ? // No room for a number beside a centred icon, so it becomes a
                // dot in the corner -- still "something is waiting here".
                'absolute right-1.5 top-1 size-1.5 rounded-full'
              : 'rounded-full px-1.5 py-0.5 text-micro',
          )}
        >
          <span className={cn(narrow && 'sr-only')}>{badge}</span>
        </span>
      )}
    </Link>
  );

  const nav = (narrow: boolean) => (
    <nav className="flex flex-col gap-0.5" aria-label="Sections">
      {sections.map((section, index) =>
        navRow({
          href: section.href,
          label: section.label,
          Icon: section.icon ? NAV_ICONS[section.icon] : null,
          on: isActive(section),
          badge: section.badge,
          narrow,
          hint: index < 9 ? `⌥${index + 1}` : undefined,
        }),
      )}
    </nav>
  );

  const sidebarInner = (narrow: boolean) => (
    <>
      <div className={cn('pt-3', narrow ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher
          current={module}
          enabled={enabledModules}
          counts={counts}
          onShell
          compact={narrow}
        />
      </div>
      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">{nav(narrow)}</div>

      {/* The workspace's own settings, at the foot of its own column.
          They were a gear in the top bar, next to the theme picker and the
          account avatar -- controls that belong to the person rather than to
          the workspace -- which is exactly the wrong company for them. Below
          the section list rather than in it: settings are not a tenth place to
          work, and a rule keeps them from reading as one. */}
      {settingsHref && (
        <div className="border-t border-shell-border px-2 py-2">
          {navRow({
            href: settingsHref,
            label: settingsLabel ?? 'Settings',
            Icon: Settings,
            on: pathname.startsWith(settingsHref),
            narrow,
          })}
        </div>
      )}
    </>
  );

  /**
   * The phone's navigation: the first four sections as a bar of tabs along
   * the bottom, and everything else behind More. A hamburger was the only way
   * in before, which made every section two taps away and the current one
   * invisible. Four, because that is what fits with a label under each icon
   * at 390px; the rest are one tap further, which is where they were anyway.
   */
  const tabs = sections.slice(0, 4);
  const overflow = sections.length > 4 || Boolean(settingsHref);

  return (
    <ToastProvider>
    <KeyHintsProvider />
    <div
      className={cn(
        'min-h-dvh lg:grid',
        collapsed ? 'lg:grid-cols-[3.5rem_minmax(0,1fr)]' : 'lg:grid-cols-[13.5rem_minmax(0,1fr)]',
      )}
    >
      {/* The column, from lg up.

          z-40 rather than nothing: `sticky` makes this element a stacking
          context, so the workspace switcher's menu cannot escape it however
          high its own z-index goes. Without a z-index here the column lands in
          the auto layer, which every positioned element in the page column --
          and the page column comes later in the DOM -- paints over. That is
          how a company logo and a filter chip ended up in front of an open
          switcher menu. Level with the top bar, below the palette and the
          sheets that are meant to cover the whole shell. */}
      <aside className="sticky top-0 z-40 hidden h-dvh flex-col border-r border-shell-border bg-shell lg:flex">
        {sidebarInner(collapsed)}

        {/* Narrow it when the page needs the width, without losing the way
            out: the workspace switcher stays at the top of the rail as its
            mark, so switching module is still one click from here. Below the
            settings rule, because it is a thing you do to the column rather
            than a place you can go. */}
        <div className="border-t border-shell-border px-2 py-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            aria-pressed={collapsed}
            className={cn(
              'press flex w-full items-center gap-2 rounded-lg py-1.5 text-ui font-medium text-shell-muted transition-colors duration-150 hover:bg-shell-hover/60 hover:text-shell-ink',
              collapsed ? 'justify-center px-2' : 'pl-3 pr-2',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            )}
            <span className={cn('flex-1 text-left', collapsed && 'sr-only')}>
              {collapsed ? 'Expand' : 'Collapse'}
            </span>
          </button>
        </div>
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
            {/* Never narrow: a drawer you opened on purpose has no width to
                save, and it closes the moment you pick something. */}
            {sidebarInner(false)}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        {/* The top bar is chrome, not page: it takes the shell's ground and
            the shell's ink, the same as the column beside it. In four themes
            the shell is a near-neighbour of the surface it used to use, so
            this reads as the bar picking up its own sidebar's tone. In
            Lightbox it is the difference between a white strip across the top
            of a black bench and one continuous bench. */}
        <header className="sticky top-0 z-40 border-b border-shell-border bg-shell/85 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-shell-muted hover:bg-shell-hover hover:text-shell-ink lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-4" strokeWidth={1.75} aria-hidden />
            </button>

            <span className="lg:hidden">
              <ModuleMark module={module} size="sm" />
            </span>

            <h2 className="font-display shrink-0 truncate text-lead font-semibold tracking-tight text-shell-ink">
              {title}
            </h2>

            {/* The middle of the bar was empty. It now carries the one thing
                this workspace would say if it could say only one -- read on
                arrival, not watched. Hidden on a phone, where there is no
                middle. */}
            {brief && (
              <p className="hidden min-w-0 flex-1 justify-center truncate px-4 text-center text-ui sm:flex">
                {brief.href ? (
                  <Link
                    href={brief.href}
                    className={cn(
                      'truncate rounded-full px-2.5 py-1 transition-colors',
                      // Dimming on hover rather than thinning the tint: the
                      // pill is a lit chip in dark chrome under Lightbox, and
                      // a translucent tint there stops being a lit chip while
                      // its text carries on assuming it is one.
                      brief.tone === 'caution'
                        ? 'bg-caution-tint text-caution hover:opacity-90'
                        : 'text-shell-muted hover:bg-shell-hover hover:text-shell-ink',
                    )}
                  >
                    {brief.text}
                  </Link>
                ) : (
                  <span className="truncate px-2.5 py-1 text-shell-muted">{brief.text}</span>
                )}
              </p>
            )}
            {/* The gap that puts the account controls in the right corner.
                From sm up the brief is the flexible middle of the bar and does
                that job itself, so the spacer stands down. Below sm the brief
                is `display: none` and takes no part in the layout at all --
                which is how, on a phone, the theme, notification, feedback and
                account icons ended up bunched against the page title instead
                of in the corner. */}
            <span className={cn('min-w-0 flex-1', brief && 'sm:hidden')} />

            {/* What is left here belongs to the person, not to the workspace:
                their theme, their notifications, their feedback, their
                account. The workspace's own settings moved into its column --
                see sidebarInner. */}
            <div className="flex shrink-0 items-center gap-0.5">
              <ThemePicker value={theme} />
              <NotificationsButton />
              <FeedbackButton allHref={feedbackHref} />

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

        {/* Below sm the brief has no middle of the bar to live in, so it gets
            its own line under the bar. Read on arrival, same as on a desktop. */}
        {brief && (
          <p className="border-b border-shell-border bg-shell px-4 py-1.5 text-center text-small sm:hidden">
            {brief.href ? (
              <Link
                href={brief.href}
                className={cn(
                  'truncate',
                  brief.tone === 'caution' ? 'font-medium text-caution' : 'text-shell-muted',
                )}
              >
                {brief.text}
              </Link>
            ) : (
              <span className="text-shell-muted">{brief.text}</span>
            )}
          </p>
        )}

        {banner}
        <main
          className={cn(
            'mx-auto max-w-[1400px] px-4 py-6 sm:px-6',
            // Room for the tab bar, which is fixed over the foot of the page.
            tabs.length > 0 && 'pb-24 lg:pb-6',
          )}
        >
          {children}
        </main>
        <StatusLine lines={activity} />

        {tabs.length > 0 && (
          <nav
            aria-label="Sections"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-shell-border bg-shell/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
          >
            <ul className="grid auto-cols-fr grid-flow-col">
              {tabs.map((section) => {
                const Icon = section.icon ? NAV_ICONS[section.icon] : null;
                const on = isActive(section);
                return (
                  <li key={section.href}>
                    <Link
                      href={section.href}
                      aria-current={on ? 'page' : undefined}
                      className={cn(
                        'press relative flex flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-micro font-medium',
                        on ? 'text-shell-ink' : 'text-shell-muted',
                      )}
                    >
                      {Icon && <Icon className="size-5" strokeWidth={on ? 2 : 1.75} aria-hidden />}
                      <span className="truncate">{section.label}</span>
                      {section.badge !== undefined && section.badge > 0 && (
                        <span
                          className="absolute right-1/2 top-1.5 -mr-4 size-1.5 rounded-full bg-caution-fill"
                          aria-hidden
                        />
                      )}
                      <span
                        className={cn(
                          'absolute inset-x-6 top-0 h-0.5 rounded-b-full transition-opacity duration-150',
                          on ? 'opacity-100' : 'opacity-0',
                        )}
                        style={{ background: (moduleById(module) ?? HOME_MARK).key.from }}
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
              {overflow && (
                <li>
                  <button
                    type="button"
                    onClick={() => setDrawer(true)}
                    className="press flex w-full flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-micro font-medium text-shell-muted"
                  >
                    <MoreHorizontal className="size-5" strokeWidth={1.75} aria-hidden />
                    More
                  </button>
                </li>
              )}
            </ul>
          </nav>
        )}
      </div>

      <CommandPalette module={module} sections={sections} enabledModules={enabledModules} />
    </div>
    </ToastProvider>
  );
}
