import Link from 'next/link';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { FeedbackButton } from '@/components/shell/feedback-button';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import { AccountView } from './view';

export const metadata = { title: 'Account' };

/**
 * The account, not a workspace.
 *
 * Everything here is true about you no matter which of the workspaces you are
 * in, which is exactly the test for what belongs: if turning a module off would
 * make the setting meaningless, it is a module setting and it lives behind that
 * module's own gear.
 *
 * It exists because the timezone did not have one home. It had two -- a column
 * on each workspace's `profiles` row, both defaulting to UTC, with one screen
 * editing one of them -- so the shopping side had silently been on UTC forever
 * and no page could merge the two workspaces without picking a side.
 *
 * Same chrome as /home rather than a workspace shell: this belongs to the
 * account, and wearing one workspace's navigation would imply otherwise.
 */
export default async function AccountPage() {
  const user = await requireUser();
  const settings = await loadAccountSettings(user.id);

  const initial = (settings.displayName || user.email || '').charAt(0).toUpperCase();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <WorkspaceSwitcher current={null} enabled={settings.enabledModules} />
          <div className="flex-1" />
          <FeedbackButton />
          <Link
            href="/account"
            aria-current="page"
            className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand"
            title={settings.displayName ?? user.email ?? ''}
          >
            {initial}
            <span className="sr-only">Account</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Account</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Settings that hold across every workspace.
        </p>

        <div className="mt-6">
          <AccountView
            email={user.email ?? ''}
            settings={{
              displayName: settings.displayName ?? '',
              timezone: settings.timezone,
              displayCurrency: settings.displayCurrency,
              enabledModules: settings.enabledModules,
            }}
          />
        </div>
      </main>
    </div>
  );
}
