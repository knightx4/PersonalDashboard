import 'server-only';

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import type { Notification } from '@/components/shell/notifications-button';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { getUser } from '@/lib/auth/server';
import type { SessionUser } from '@/lib/auth/session-user';
import { loadAccountSettings, type AccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadInboxBannerState } from '@/lib/core/inbox/banner';
import {
  estimatePaidActions,
  paidActionsUnder,
  type PaidAction,
} from '@/lib/core/spend/paid-actions';
import { InboxSyncBanner } from '@/components/shell/inbox-sync-banner';
import { isOwner } from '@/lib/dev/owner';
import type { ModuleId } from '@/lib/modules';
import { loadModuleCounts, type ModuleCounts } from '@/lib/modules/counts';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadGoalsBrief, loadNewsBrief, type Brief } from '@/lib/shell/brief';
import { loadMainCheck } from '@/lib/shell/main-check';

/**
 * The one place the app shell is built (docs/ONE-INTERFACE-SPEC.md, Part 6;
 * plan #1927.1).
 *
 * Every workspace layout, the layouts in the account's chrome and the pages
 * that drew the shell themselves used to repeat the same ten reads and the
 * same twenty props, and they had drifted: one passed a brief and the next
 * did not, one wrapped its pages in the paid-cost hints and the next did not.
 * Now each caller says what is its own (the sections, the settings link, the
 * brief, the banner, the presses whose cost it shows) and this does the rest.
 *
 * The reads every shell needs are made here in one round: the settings, the
 * owner check, the switcher's counts, what ran in the background, the open
 * raises and whether main is green. What a caller adds that needs them (a
 * section's badge, a brief that reads the timezone, a page drawn from the
 * settings) is given as a function of the frame and runs after that round,
 * all of it at once.
 */

/** What every shell reads, handed to a caller's own parts that need it. */
export type ShellFrame = {
  user: SessionUser;
  settings: AccountSettings;
  owner: boolean;
  counts: ModuleCounts;
  /** The open raises, which the bell lists and Dev's Inbox badge counts. */
  raised: Notification[];
};

/**
 * The workspaces that sync mail, which draw the sync banner above their pages.
 * The one list: a workspace added here gets the banner without its layout
 * passing anything.
 */
const MAIL_SYNC_MODULES: readonly ModuleId[] = ['shopping', 'jobs'];

/**
 * Presses outside a workspace's own folder that it also shows a cost beside.
 * The inbox import posts to an API route rather than an action.
 */
const EXTRA_PAID_ACTIONS: Partial<Record<ModuleId, readonly PaidAction[]>> = {
  shopping: ['app/api/inbox/sync/route.ts#POST'],
};

/**
 * The briefs that read only the frame. Workspaces whose brief needs a count
 * their layout already reads (shopping and jobs, the review queue) pass their
 * own.
 */
const FRAME_BRIEFS: Partial<Record<ModuleId, (frame: ShellFrame) => Promise<Brief | null>>> = {
  goals: ({ user, settings }) => loadGoalsBrief(user.id, settings.timezone),
  news: () => loadNewsBrief(),
};

/** A value, or one worked out from the frame once it is read. */
export type FromFrame<T> = T | ((frame: ShellFrame) => T | Promise<T>);

export type ShellOptions = {
  /** The workspace, or null for a page in the account's chrome. */
  module: ModuleId | null;
  /** The workspace's tabs. None in the account's chrome. */
  sections?: FromFrame<readonly NavSection[]>;
  settingsHref?: string;
  settingsLabel?: string;
  feedbackHref?: string;
  /**
   * The workspace's one-line brief, when it needs more than the frame. Omitted,
   * the shell uses the workspace's own from FRAME_BRIEFS, if it has one.
   */
  brief?: (frame: ShellFrame) => Promise<Brief | null>;
  /** Drawn above the page, inside the content column. */
  banner?: FromFrame<ReactNode>;
  /**
   * The paid presses under this shell, when they are not the workspace's own
   * (everything under app/<module>/ plus EXTRA_PAID_ACTIONS). Their estimates
   * are read in the first round and the pages are wrapped in
   * PaidCostsProvider, so every hint below reads its figure from there.
   */
  paidActions?: readonly PaidAction[];
  /**
   * The account's chrome centres its pages in a 3xl column. True for every
   * moduleless caller today, and the default where `module` is null.
   */
  narrow?: boolean;
  /** The signed-in user, when the caller has read it already for a gate. */
  user?: SessionUser;
  children: FromFrame<ReactNode>;
};

function resolve<T>(value: FromFrame<T> | undefined, frame: ShellFrame): Promise<T | undefined> {
  return Promise.resolve(
    typeof value === 'function' ? (value as (frame: ShellFrame) => T | Promise<T>)(frame) : value,
  );
}

export async function shellFor(options: ShellOptions) {
  const user = options.user ?? (await getUser());
  if (!user) redirect('/login');

  const paidActions =
    options.paidActions ??
    (options.module
      ? [
          ...paidActionsUnder(`app/${options.module}/`),
          ...(EXTRA_PAID_ACTIONS[options.module] ?? []),
        ]
      : undefined);

  const [settings, counts, activity, raised, mainCheck, owner, costs] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
    paidActions
      ? createCoreClient()
          .then((core) => estimatePaidActions(core, user.id, paidActions))
          .catch(() => ({}))
      : null,
  ]);

  const frame: ShellFrame = { user, settings, owner, counts, raised };
  const [sections, brief, banner, page] = await Promise.all([
    resolve(options.sections, frame),
    (options.brief ?? (options.module ? FRAME_BRIEFS[options.module] : undefined))?.(frame),
    options.banner !== undefined
      ? resolve(options.banner, frame)
      : options.module && MAIL_SYNC_MODULES.includes(options.module)
        ? loadInboxBannerState(user.id).then(({ accountIds, initialJob }) => (
            <InboxSyncBanner accountIds={accountIds} initialJob={initialJob} />
          ))
        : undefined,
    resolve(options.children, frame),
  ]);

  const narrow = options.narrow ?? options.module === null;
  const column = narrow ? <div className="mx-auto max-w-3xl">{page}</div> : page;

  return (
    <div
      data-workspace={options.module ?? undefined}
      className={options.module === null ? 'min-h-full' : undefined}
    >
      <AppShell
        account={user.id}
        module={options.module}
        sections={sections ?? []}
        settingsHref={options.settingsHref}
        settingsLabel={options.settingsLabel}
        feedbackHref={options.feedbackHref}
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        activity={activity}
        mainCheck={mainCheck}
        brief={brief}
        banner={banner}
      >
        {costs ? <PaidCostsProvider costs={costs}>{column}</PaidCostsProvider> : column}
      </AppShell>
    </div>
  );
}
