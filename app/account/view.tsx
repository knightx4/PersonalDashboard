import { signOut } from '@/app/(auth)/actions';
import { SettingsPage } from '@/components/patterns/settings-page';
import { ThemePicker } from '@/components/shell/theme-picker';
import { Button } from '@/components/ui/button';
import type { CaptureTokenListing } from '@/lib/capture/tokens';
import type { ConnectedApp } from '@/lib/connector/apps';
import { MODULES, type ModuleId } from '@/lib/modules';
import type { Theme } from '@/lib/theme';
import { AskShortcutSection, CaptureShortcutSection } from './capture-shortcut';
import { CaptureTokensSection } from './capture-tokens';
import { ConnectedAppsSection } from './connected-apps';
import { FeelSection } from './haptics';
import { NotificationsSection } from './notifications';
import { DangerSection, ModulesSection, YouSection } from './sections';
import { ACCOUNT_TAB_ADDRESS, ACCOUNT_TABS, type AccountTab } from './tabs';

/**
 * Account on the settings page pattern (plan #1937.11): five sections behind
 * tabs, as every settings page with more than three reads. The page reads
 * the open tab from the address and passes it in, and only that tab's
 * section is drawn; app/account/tabs.ts says what each tab holds.
 */
export function AccountView({
  tab,
  opensOn,
  email,
  settings,
  isOwner,
  vapidPublicKey,
  connected,
  capture,
}: {
  /** The open tab, read from the address by the page. */
  tab: AccountTab;
  /**
   * The gallery's: the tab the row marks when the address names none. The
   * page leaves it out, since its address and `tab` always agree.
   */
  opensOn?: AccountTab;
  email: string;
  settings: {
    displayName: string;
    timezone: string;
    displayCurrency: string;
    enabledModules: ModuleId[];
    theme: Theme;
  };
  /** Whether this account owns the app. Read on the server; see lib/dev/owner. */
  isOwner: boolean;
  /** The key browsers subscribe to push with; null when the server has none. */
  vapidPublicKey: string | null;
  /**
   * The Connected apps section's data, read on the server (plan #1258), and
   * only when Activity is the open tab; null on the others.
   */
  connected: { apps: ConnectedApp[]; failed: string | null; connectorAddress: string } | null;
  /**
   * The Tokens section's data (plan #1705), read with the connected
   * apps and only on Activity; null on the other tabs. `justMade` is the
   * gallery's, for a token as it shows straight after it is made.
   */
  capture: {
    tokens: CaptureTokenListing[];
    failed: string | null;
    justMade?: { label: string; token: string };
    /** The capture address on this app's own origin, for the Shortcut's steps. */
    address: string;
    /** The ask address on this app's own origin, for the ask Shortcut's steps. */
    askAddress: string;
  } | null;
}) {
  const title = (id: AccountTab) => ACCOUNT_TABS.find((entry) => entry.id === id)!.label;
  return (
    <SettingsPage
      title="Account"
      href="/account"
      tab={tab}
      address={opensOn ? { ...ACCOUNT_TAB_ADDRESS, opensOn } : ACCOUNT_TAB_ADDRESS}
      sections={[
        {
          id: 'you',
          title: title('you'),
          content: () => (
            <Parts>
              <YouSection email={email} settings={settings} />
              {/* The theme and the density, where the setting lives. They
                  were an icon in the top bar; ⌘K still switches the theme
                  from anywhere. */}
              <section>
                <h3 className="text-ui font-semibold text-ink">Theme</h3>
                <div className="mt-3">
                  <ThemePicker value={settings.theme} />
                </div>
              </section>
            </Parts>
          ),
        },
        {
          id: 'workspaces',
          title: title('workspaces'),
          content: () => (
            <Parts>
              <ModulesSection enabled={settings.enabledModules} isOwner={isOwner} />
              <ModuleSettingsLinks enabled={settings.enabledModules} />
            </Parts>
          ),
        },
        {
          id: 'notifications',
          title: title('notifications'),
          content: () => (
            <Parts>
              <NotificationsSection publicKey={vapidPublicKey} />
              <FeelSection />
            </Parts>
          ),
        },
        {
          id: 'activity',
          title: title('activity'),
          content: () => (
            <Parts>
              {connected && <ConnectedAppsSection {...connected} timezone={settings.timezone} />}
              {capture && (
                <CaptureTokensSection
                  tokens={capture.tokens}
                  failed={capture.failed}
                  justMade={capture.justMade}
                  timezone={settings.timezone}
                />
              )}
              {capture && <CaptureShortcutSection address={capture.address} />}
              {capture && <AskShortcutSection address={capture.askAddress} />}
            </Parts>
          ),
        },
        {
          id: 'session',
          title: title('session'),
          content: () => (
            <Parts>
              <SessionPart />
              <DangerSection vaultEnabled={settings.enabledModules.includes('vault')} />
            </Parts>
          ),
        },
      ]}
    />
  );
}

/**
 * The parts of one tab's card, set apart by space rather than boxed again
 * (law 11). No rule between them: several parts end on a list's own rule, and
 * a second one beside it reads as an empty row.
 */
function Parts({ children }: { children: React.ReactNode }) {
  return <div className="space-y-8">{children}</div>;
}

/**
 * Where the rest of the settings went.
 *
 * Account settings are the ones that survive every module being switched off.
 * Everything else belongs to the module it is about, and this says so plainly
 * rather than leaving someone hunting for the Gmail connection.
 */
function ModuleSettingsLinks({ enabled }: { enabled: ModuleId[] }) {
  // From the module list, so a workspace with a settings page cannot be left out.
  const links = MODULES.flatMap((module) =>
    module.settings && enabled.includes(module.id)
      ? [
          {
            href: module.settings.href,
            label: `${module.label} settings`,
            hint: module.settings.hint,
          },
        ]
      : [],
  );
  // Account-wide pages read every workspace, so they sit in the same list.
  const rows = [
    ...links,
    {
      href: '/timeline',
      label: 'Timeline',
      hint: 'Orders, applications, tasks, notes, Learn and goals, month by month',
    },
    {
      href: '/account/spend',
      label: 'Model spend',
      hint: 'This month and all time, by module and operation',
    },
  ];

  return (
    <section aria-label="More">
      <ul className="divide-y divide-border">
        {rows.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="block py-2.5 hover:text-accent">
              <span className="block text-ui font-medium text-ink">{link.label}</span>
              <span className="block text-small text-ink-muted">{link.hint}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Signing out is an account action, so it lives on the account page.
 *
 * It used to exist in exactly one place -- Shopping settings -- which meant a
 * person who switched Shopping off under Workspaces had no way to sign out of
 * their own account. An account-level action can never live inside a module.
 */
function SessionPart() {
  return (
    <section>
      <h3 className="text-ui font-semibold text-ink">Sign out</h3>
      <p className="mt-0.5 text-ui text-ink-muted">Nothing is deleted.</p>
      <form action={signOut} className="mt-4">
        <Button variant="secondary" type="submit">
          Sign out
        </Button>
      </form>
    </section>
  );
}
