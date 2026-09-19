'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { NotificationsButton, type Notification } from '@/components/shell/notifications-button';
import { ThemePicker } from '@/components/shell/theme-picker';
import { StatusLine } from '@/components/shell/status-line';
import { CommandPalette } from '@/components/shell/command-palette';
import { SearchBar } from '@/components/shell/search-bar';
import { CaptureButton, CaptureProvider } from '@/components/shell/capture';
import { KeyHintsProvider, Kbd } from '@/components/shell/key-hints';
import { ToastProvider } from '@/components/ui/toast';
import { scrim } from '@/components/ui/popover';
import { NAV_ICONS, type NavIconName } from '@/components/shell/nav-icons';
import { MAIN_BOX } from '@/components/shell/main-box';
import {
  WorkspaceSheet,
  WorkspaceSwitcher,
  type SwitcherCounts,
} from '@/components/shell/workspace-switcher';
import { ModuleMark } from '@/components/ui/module-mark';
import { HOME_MARK, moduleById, switchableModules, type ModuleId } from '@/lib/modules';
import type { Theme } from '@/lib/theme';
import type { ActivityLine } from '@/lib/shell/activity';
import type { MainCheck } from '@/lib/plan/main-check';
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
   * wrong -- and Raised has, because an unread question is a session that
   * guessed and built on the guess. Nothing else in this app has.
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
  account,
  module,
  sections,
  settingsHref,
  settingsLabel,
  feedbackHref,
  displayName,
  email,
  enabledModules,
  isOwner = false,
  counts,
  theme,
  banner,
  brief,
  activity = [],
  mainCheck = null,
  notifications = [],
  children,
}: {
  /** The signed-in user's id. ⌘K stamps the list it holds with it. */
  account: string;
  module: ModuleId | null;
  sections: readonly NavSection[];
  settingsHref?: string;
  settingsLabel?: string;
  feedbackHref?: string;
  displayName: string | null;
  email: string;
  enabledModules?: readonly ModuleId[];
  /**
   * Whether the signed-in account owns this app. Read once on the server, in
   * the layout, and passed down: the check costs a round trip and is
   * server-only, so nothing in here may ask for itself.
   *
   * Omitted means "not the owner", which hides one workspace too many rather
   * than showing one that is not theirs. Every real call site passes the
   * answer.
   */
  isOwner?: boolean;
  counts?: SwitcherCounts;
  theme: Theme;
  /** Rendered above the page, inside the content column. */
  banner?: React.ReactNode;
  /** The one thing this workspace would say if it could say only one thing. */
  brief?: Brief | null;
  /** What the system did while nobody was looking. */
  activity?: ActivityLine[];
  /**
   * Whether main is green, as the last overnight tick read it. The status line
   * draws it as a dot; null is "nothing has been read", which is a state of its
   * own rather than a reason to draw nothing.
   */
  mainCheck?: MainCheck | null;
  /** What is waiting on you, wherever you are standing. Today: open raises. */
  notifications?: Notification[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const paneRef = useRef<HTMLDivElement>(null);
  const [drawer, setDrawer] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const initial = (displayName || email).charAt(0).toUpperCase();

  /**
   * The workspaces this person may switch to: the ones they switched on,
   * minus any this account is not allowed to see at all.
   *
   * Three lists below read it -- the column's switcher, the phone's sheet and
   * ⌘K -- and the filtering happens once here rather than in each of them,
   * because three lists disagreeing about which workspaces exist is the bug
   * this shell was written to end.
   *
   * The rule itself is in lib/modules, where it can be read by a test without
   * a DOM -- these three lists are a menu, a sheet and a palette, and none of
   * them puts a workspace in its markup until it is opened.
   */
  const workspaces = switchableModules(enabledModules, isOwner);

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

  /**
   * A new page starts at the top of the page.
   *
   * The router scrolls `window` on navigation, and from lg up the window is
   * not the thing that scrolls -- the pane is. Without this, opening a role
   * from halfway down the pipeline lands you halfway down the role. Below lg
   * the pane is not a scroll container and this is a no-op.
   */
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

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
          enabled={workspaces}
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
        <div className="px-2 py-2">
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
   * The phone's navigation: sections as a bar of tabs along the bottom, the
   * workspace switcher in the middle of them, and everything else behind More.
   * A hamburger was the only way in before, which made every section two taps
   * away and the current one invisible.
   *
   * Five slots, because that is what fits with a label under each icon at
   * 390px. The switcher takes the centre one -- the thumb's own position, and
   * the only control on the bar that leaves the workspace rather than moving
   * around inside it -- so three sections show beside More, or four when there
   * is no More. The rest are one tap further, which is where they were anyway.
   *
   * The bar itself does not wait for sections. Home and the account page have
   * none -- they are not workspaces -- and the bar was hung on `tabs.length`,
   * so on exactly the two pages with no other navigation on them the way out
   * disappeared: no bottom bar, and the switcher only in the top corner. The
   * switcher is reason enough for the bar on its own, and the slot it takes is
   * the same one it takes everywhere else, so the control does not move when
   * you arrive home from a workspace.
   */
  const overflow = sections.length > 3 || Boolean(settingsHref);
  const tabs = sections.slice(0, overflow ? 3 : 4);

  const dockKey = (moduleById(module) ?? HOME_MARK).key.from;
  const dockItem =
    'press flex w-full flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-micro font-medium';

  const dockTabs = tabs.map((section) => {
    const Icon = section.icon ? NAV_ICONS[section.icon] : null;
    const on = isActive(section);
    return (
      <li key={section.href}>
        <Link
          href={section.href}
          aria-current={on ? 'page' : undefined}
          className={cn(dockItem, 'relative', on ? 'text-shell-ink' : 'text-shell-muted')}
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
            style={{ background: dockKey }}
            aria-hidden
          />
        </Link>
      </li>
    );
  });

  if (overflow) {
    dockTabs.push(
      <li key="__more">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className={cn(dockItem, 'text-shell-muted')}
        >
          <MoreHorizontal className="size-5" strokeWidth={1.75} aria-hidden />
          More
        </button>
      </li>,
    );
  }

  /**
   * The centre slot. The mark rather than an icon, because it is the one
   * control on the bar that answers "where am I" as well as "where else could
   * I be" -- and it is already the thing a person taps at the top of the
   * column on a desktop.
   */
  const dockSwitcher = (
    <li key="__switcher">
      <button
        type="button"
        onClick={() => setSwitcher(true)}
        aria-haspopup="menu"
        aria-expanded={switcher}
        className={cn(dockItem, switcher ? 'text-shell-ink' : 'text-shell-muted')}
      >
        {/* The mark is 24px against the tabs' 20px icons, so it is pulled back
            in by 2px a side -- otherwise the centre label sits lower than the
            four beside it. */}
        <ModuleMark module={module} size="sm" className="-my-0.5" />
        <span className="truncate">Switch</span>
      </button>
    </li>
  );

  // One or two tabs to the switcher's left. The bar holds four at the most --
  // three plus More, or four with no More -- so this is dead centre of five
  // and one past centre of four.
  const split = dockTabs.length >= 3 ? 2 : 1;
  const dock = [...dockTabs.slice(0, split), dockSwitcher, ...dockTabs.slice(split)];

  return (
    <ToastProvider>
      <KeyHintsProvider />
      <CaptureProvider>
        <div
          className={cn(
            // The ground, not a container: the sidebar and the page pane are both
            // laid on it, and it carries the workspace's wash. See `.shell-ground`
            // in globals.css.
            'shell-ground min-h-dvh lg:grid lg:h-dvh lg:overflow-hidden',
            // The inset the page pane floats in. Six pixels of ground showing on
            // every side is what turns two panels butted together into an object
            // laid on a surface.
            'lg:gap-1.5 lg:p-1.5',
            collapsed
              ? 'lg:grid-cols-[3.5rem_minmax(0,1fr)]'
              : 'lg:grid-cols-[13.5rem_minmax(0,1fr)]',
          )}
        >
          {/* The column, from lg up.

          z-chrome rather than nothing: `sticky` makes this element a stacking
          context, so the workspace switcher's menu cannot escape it however
          high its own z-index goes. Without a z-index here the column lands in
          the auto layer, which every positioned element in the page column --
          and the page column comes later in the DOM -- paints over. That is
          how a company logo and a filter chip ended up in front of an open
          switcher menu. Level with the top bar, below the palette and the
          sheets that are meant to cover the whole shell. */}
          <aside className="sticky top-1.5 z-chrome hidden h-[calc(100dvh-0.75rem)] flex-col lg:flex">
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
            <div className="fixed inset-0 z-overlay lg:hidden">
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setDrawer(false)}
                className={scrim}
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

          {/* A column, so the status line can be held against the foot of the
          window on a page too short to reach it.

          `sticky bottom-0` only pins an element that would otherwise be below
          the fold; on a short page there is nothing to pin it against, so the
          line came to rest directly under the content with empty page beneath
          it. Making this a full-height flex column and letting `main` take the
          slack puts the line at the bottom of the window when the page is
          short, and `sticky` keeps doing its job when the page is long. */}
          <div ref={paneRef} className="page-pane flex min-h-dvh min-w-0 flex-col lg:min-h-0">
            {/* The top bar is chrome, not page: it takes the shell's ground and
            the shell's ink, the same as the column beside it. In three themes
            the shell is a near-neighbour of the surface it used to use, so
            this reads as the bar picking up its own sidebar's tone. In
            Lightbox it is the difference between a white strip across the top
            of a black bench and one continuous bench. */}
            <header className="sticky top-0 z-chrome bg-page/85 backdrop-blur">
              <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
                <button
                  type="button"
                  onClick={() => setDrawer(true)}
                  className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-shell-muted hover:bg-shell-hover hover:text-shell-ink lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu className="size-4" strokeWidth={1.75} aria-hidden />
                </button>

                {/* The mark in the bar is the switcher, not a picture of one.
                From lg up the column carries it -- and still does when the
                column is collapsed, as its mark. Below lg there is no column
                until you open the drawer, and this icon sat there looking
                exactly like the thing that switches workspaces while doing
                nothing, which made changing module a drawer away. */}
                <span className="lg:hidden">
                  <WorkspaceSwitcher
                    current={module}
                    enabled={workspaces}
                    counts={counts}
                    onShell
                    compact
                  />
                </span>

                <h2 className="font-display shrink-0 truncate text-body font-semibold tracking-tight text-shell-ink">
                  {title}
                </h2>

                {/* The one thing this workspace would say if it could say only
                one, in the middle of the bar -- read on arrival, not watched.
                Only between sm and lg now. From lg up it reads on the status
                line at the foot of the page instead (#689, #707) and the
                search bar has this space, and below sm it gets its own line
                under the bar (#688), further down. */}
                {brief && (
                  <p className="hidden min-w-0 flex-1 justify-center truncate px-4 text-center text-ui sm:flex lg:hidden">
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
                {/* Search, in the top bar of every page from lg up, narrowed to
                the workspace the page is in. The chip is drawn from `module`,
                so it names this workspace and goes back to naming it after a
                move to another one; on Home and the account page `module` is
                null, there is no chip, and the bar searches everything.

                Below lg there is no field here at all and ⌘K is the way in.
                1024 is where the column appears, and a field competing with
                the page title for a phone's width would leave neither of them
                readable. */}
                <SearchBar
                  account={account}
                  module={module}
                  sections={sections}
                  enabledModules={workspaces}
                  theme={theme}
                  className="hidden min-w-0 flex-1 lg:block"
                />

                {/* The gap that puts the account controls in the right corner.
                Between sm and lg the brief is the flexible middle of the bar
                and does that job itself, so the spacer stands down. Outside
                that band the brief is `display: none` and takes no part in the
                layout at all -- which is how, on a phone, the theme,
                notification, feedback and account icons ended up bunched
                against the page title instead of in the corner. From lg up the
                search bar is the flexible middle, on every page and whether or
                not there is a brief, so the spacer stands down there too. Two
                items both growing from nothing would split the middle between
                them, leaving the bar half the width it should have. */}
                <span className={cn('min-w-0 flex-1', brief && 'sm:hidden', 'lg:hidden')} />

                {/* What is left here belongs to the person, not to the workspace:
                their theme, their notifications, their feedback, their
                account. The workspace's own settings moved into its column --
                see sidebarInner. */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <CaptureButton />
                  <ThemePicker value={theme} />
                  <NotificationsButton notifications={notifications} />
                  <FeedbackButton allHref={feedbackHref} isOwner={isOwner} />

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
              <p className="bg-page px-4 py-1.5 text-center text-small sm:hidden">
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
                // The width and the gutter, shared with the anatomy surfaces on
                // /dev/ui so a drawing of a page is made in the box a page gets.
                MAIN_BOX,
                // Takes the leftover height, so the status line below it is held
                // against the foot of the window rather than the foot of the text.
                'flex-1',
                // Room for the tab bar, which is fixed over the foot of the page.
                'pb-24 lg:pb-6',
              )}
            >
              {children}
            </main>
            {/* The brief goes down here from lg up, which is exactly the width
            this line is drawn at, so the two copies above and this one never
            show at once. */}
            <StatusLine lines={activity} brief={brief} main={mainCheck} />

            <nav
              // Named for what is actually in it: on home and the account page it
              // holds no sections at all, and a landmark called "Sections" that
              // contains one workspace switcher is a lie to anyone listing them.
              aria-label={tabs.length > 0 ? 'Sections' : 'Workspace'}
              className="fixed inset-x-0 bottom-0 z-chrome border-t border-shell-border bg-shell/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
            >
              {/* With no sections the switcher is the only cell, so it takes the
              width. Its contents are centred either way, which is what "in the
              middle" means here -- the mark and its label land where they land
              on every other page, with a wider target under them. */}
              <ul className="grid auto-cols-fr grid-flow-col">{dock}</ul>
            </nav>
          </div>

          <WorkspaceSheet
            current={module}
            enabled={workspaces}
            counts={counts}
            open={switcher}
            onClose={() => setSwitcher(false)}
          />

          <CommandPalette
            account={account}
            module={module}
            sections={sections}
            enabledModules={workspaces}
            theme={theme}
          />
        </div>
      </CaptureProvider>
    </ToastProvider>
  );
}
