'use client';

import { useActionState, useState, useSyncExternalStore, useTransition } from 'react';
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Banner as UiBanner } from '@/components/ui/banner';
import { ModuleMark } from '@/components/ui/module-mark';
import { signOut } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { TimezoneField, detectTimeZone } from '@/components/ui/timezone-field';
import { DISPLAY_CURRENCIES } from '@/lib/fx/money-fx';
import { MODULES, modulesFor, type ModuleId } from '@/lib/modules';
import { updateAccountSettings, updateEnabledModules, type AccountState } from './actions';
import { cardVariants } from '@/components/ui/card';
import { NotificationsSection } from './notifications';
import { FeelSection } from './haptics';
import { ConnectedAppsSection } from './connected-apps';
import { CaptureTokensSection } from './capture-tokens';
import { CaptureShortcutSection } from './capture-shortcut';
import type { CaptureTokenListing } from '@/lib/capture/tokens';
import type { ConnectedApp } from '@/lib/connector/apps';
import { PageHeader } from '@/components/shell/page-header';
import { TabbedSections } from '@/components/patterns/tabbed-sections';
import { ACCOUNT_TAB_ADDRESS, ACCOUNT_TABS, type AccountTab } from './tabs';

/**
 * Account, one section at a time behind tabs (the tabbed sections pattern,
 * plan #1628). The page reads the open tab from the address and passes it
 * in, and only that tab's sections are drawn; app/account/tabs.ts says which
 * sections each tab holds.
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
   * The Capture tokens section's data (plan #1705), read with the connected
   * apps and only on Activity; null on the other tabs. `justMade` is the
   * gallery's, for a token as it shows straight after it is made.
   */
  capture: {
    tokens: CaptureTokenListing[];
    failed: string | null;
    justMade?: { label: string; token: string };
    /** The capture address on this app's own origin, for the Shortcut's steps. */
    address: string;
  } | null;
}) {
  return (
    <>
      <PageHeader title="Account" />
      <TabbedSections
        tabs={ACCOUNT_TABS}
        label="Account"
        address={opensOn ? { ...ACCOUNT_TAB_ADDRESS, opensOn } : ACCOUNT_TAB_ADDRESS}
      >
        <div className="space-y-6">
          {tab === 'you' && <YouSection email={email} settings={settings} />}
          {tab === 'workspaces' && (
            <>
              <ModulesSection enabled={settings.enabledModules} isOwner={isOwner} />
              <ModuleSettingsSection enabled={settings.enabledModules} />
            </>
          )}
          {tab === 'notifications' && (
            <>
              <NotificationsSection publicKey={vapidPublicKey} />
              <FeelSection />
            </>
          )}
          {tab === 'activity' && (
            <>
              {connected && <ConnectedAppsSection {...connected} timezone={settings.timezone} />}
              {capture && (
                <>
                  <CaptureTokensSection
                    tokens={capture.tokens}
                    failed={capture.failed}
                    justMade={capture.justMade}
                    timezone={settings.timezone}
                  />
                  <CaptureShortcutSection address={capture.address} />
                </>
              )}
            </>
          )}
          {tab === 'session' && (
            <>
              <SessionSection />
              <DangerSection vaultEnabled={settings.enabledModules.includes('vault')} />
            </>
          )}
        </div>
      </TabbedSections>
    </>
  );
}

function YouSection({
  email,
  settings,
}: {
  email: string;
  settings: { displayName: string; timezone: string; displayCurrency: string };
}) {
  const [values, setValues] = useState({
    displayName: settings.displayName,
    timezone: settings.timezone,
    displayCurrency: settings.displayCurrency,
  });
  const [editing, setEditing] = useState<keyof typeof values | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const detected = useSyncExternalStore(subscribeNever, detectTimeZone, () => null);

  /** Saves the three together, as the action expects, when one has changed. */
  function commit(field: keyof typeof values, value: string) {
    setEditing(null);
    if (value === values[field]) return;
    const next = { ...values, [field]: value };
    setValues(next);
    setError(null);
    const form = new FormData();
    form.set('displayName', next.displayName);
    form.set('timezone', next.timezone);
    form.set('displayCurrency', next.displayCurrency);
    startTransition(async () => {
      const result = await updateAccountSettings({}, form);
      if (result.error) {
        setError(result.error);
        setValues(values);
      }
    });
  }

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      {/* No "You" heading: the tab above already says it (law 9). */}
      <p className="text-ui text-ink-muted">{email}</p>

      <div
        className={cn(
          'mt-3 divide-y divide-border border-y border-border',
          pending && 'opacity-70',
        )}
      >
        <SettingRow
          label="Name"
          editing={editing === 'displayName'}
          onOpen={() => setEditing('displayName')}
          display={values.displayName || 'Add a name'}
          empty={!values.displayName}
        >
          <Input
            aria-label="Name"
            autoFocus
            defaultValue={values.displayName}
            onBlur={(event) => commit('displayName', event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setEditing(null);
            }}
          />
        </SettingRow>

        <SettingRow
          label="Timezone"
          editing={editing === 'timezone'}
          onOpen={() => setEditing('timezone')}
          display={values.timezone.replace(/_/g, ' ')}
          aside={
            detected && detected !== values.timezone ? (
              <button
                type="button"
                onClick={() => commit('timezone', detected)}
                className="text-micro text-accent hover:underline"
              >
                Use {detected.replace(/_/g, ' ')}
              </button>
            ) : null
          }
        >
          <div
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              const input = event.currentTarget.querySelector('input');
              commit('timezone', input?.value.trim() ?? values.timezone);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                // The combobox swallows Enter when it picks a suggestion.
                if (!event.defaultPrevented) event.target.blur();
              }
            }}
          >
            <TimezoneField
              id="timezone"
              name="timezone"
              defaultValue={values.timezone}
              suggest={false}
              autoFocus
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Currency"
          editing={editing === 'displayCurrency'}
          onOpen={() => setEditing('displayCurrency')}
          display={values.displayCurrency}
        >
          <Select
            aria-label="Currency"
            autoFocus
            defaultValue={values.displayCurrency}
            onChange={(event) => commit('displayCurrency', event.target.value)}
            onBlur={() => setEditing(null)}
          >
            {DISPLAY_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </SettingRow>
      </div>

      {error && (
        <div className="mt-3">
          <UiBanner tone="bad">{error}</UiBanner>
        </div>
      )}
    </section>
  );
}

/**
 * A setting as a line of text. Pressing it opens its editor in place; leaving
 * the editor saves, so there is no Save button to find.
 */
function SettingRow({
  label,
  display,
  empty,
  editing,
  onOpen,
  aside,
  children,
}: {
  label: string;
  display: string;
  empty?: boolean;
  editing: boolean;
  onOpen: () => void;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="row-pad flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-24 shrink-0 text-small font-medium text-ink-muted">{label}</span>
      {editing ? (
        <div className="min-w-0 flex-1">{children}</div>
      ) : (
        <>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${label}: ${display}. Edit`}
            className={cn(
              'min-w-0 flex-1 truncate text-left text-ui hover:text-accent',
              empty ? 'text-ink-ghost' : 'text-ink',
            )}
          >
            {display}
          </button>
          {aside}
        </>
      )}
    </div>
  );
}

function Banner({ state }: { state: AccountState }) {
  if (!state.error && !state.message) return null;
  // A saved form is not a "good" event -- good is reserved for money coming
  // back -- so success is info.
  return <UiBanner tone={state.error ? 'bad' : 'info'}>{state.error ?? state.message}</UiBanner>;
}

/** The detected zone never changes while the page is open. */
function subscribeNever(): () => void {
  return () => {};
}

function ModulesSection({ enabled, isOwner }: { enabled: ModuleId[]; isOwner: boolean }) {
  const [state, action] = useActionState<AccountState, FormData>(updateEnabledModules, {});

  /**
   * The workspaces this account may have, not every workspace there is. A
   * checkbox for one it may not open would be a switch that does nothing --
   * `updateEnabledModules` filters the form through the same rule, so ticking
   * it by hand leaves it off anyway.
   */
  const modules = modulesFor(isOwner);

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      {/* No "Workspaces" heading: the tab above already says it (law 9). */}
      <p className="text-ui text-ink-muted">Turning one off hides it. Nothing is deleted.</p>

      <form action={action} className="mt-4">
        {/* Divides, not one box per row. Six workspaces drawn as six bordered
            rectangles inside a bordered card is the card's own hairline
            repeated once per item, and a page of that reads as boxes rather
            than as workspaces. The rules between them say "one list" on their
            own -- law 11. */}
        <div className="divide-y divide-border border-y border-border">
          {modules.map((module) => (
            <label key={module.id} className="row-pad flex items-start gap-3">
              <input
                type="checkbox"
                name={`module:${module.id}`}
                defaultChecked={enabled.includes(module.id)}
                className="mt-1 size-4 accent-accent"
              />
              <ModuleMark module={module.id} size="sm" className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-ui font-medium text-ink">{module.label}</span>
                <span className="block text-small leading-snug text-ink-muted">
                  {module.description}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          <Banner state={state} />
          <Button type="submit">Save</Button>
        </div>
      </form>
    </section>
  );
}

/**
 * Where the rest of the settings went.
 *
 * Account settings are the ones that survive every module being switched off.
 * Everything else belongs to the module it is about, and this says so plainly
 * rather than leaving someone hunting for the Gmail connection.
 */
function ModuleSettingsSection({ enabled }: { enabled: ModuleId[] }) {
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
    <section aria-label="More" className={cardVariants({ padding: 'standard' })}>
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
 * person who switched Shopping off under Workspaces had no way to sign
 * out of their own account. An account-level action can never live inside a
 * module.
 */
function SessionSection() {
  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Sign out</h2>
      <p className="mt-0.5 text-ui text-ink-muted">Nothing is deleted.</p>
      <form action={signOut} className="mt-4">
        <Button variant="secondary" type="submit">
          Sign out
        </Button>
      </form>
    </section>
  );
}

/**
 * Deleting the account, from the one page that outlives every module.
 *
 * It used to live on the job search settings page, which made the whole
 * account deletable only from inside one workspace -- switch that workspace
 * off under Workspaces and there was no way to leave. Signing out moved
 * here for exactly the same reason; deleting is the same kind of action, one
 * step further.
 */
function DangerSection({ vaultEnabled }: { vaultEnabled: boolean }) {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    // The app's card, with the danger border in place of the hairline: this is
    // the one section on the page whose edge is a warning rather than a
    // grouping, so it keeps a coloured one and gets the shared everything else.
    <section className={cn(cardVariants({ padding: 'standard' }), 'border-danger/30')}>
      <h2 className="flex items-center gap-2 text-body font-semibold text-danger">
        <ShieldAlert className="size-4" strokeWidth={1.75} />
        Delete everything
      </h2>
      <p className="mt-1 text-ui leading-relaxed text-ink-muted">
        Revokes the Google grant, deletes every row in every workspace and every stored file, and
        removes the account itself. There is no undo and no export first.
      </p>
      {vaultEnabled && (
        // The one credential this cannot reach. A page that lists what it
        // revokes and stays quiet about the token it cannot is the page that
        // leaves somebody believing a live token is gone.
        <p className="mt-2 text-small leading-relaxed text-ink-muted">
          One thing this cannot do for you: the vault&rsquo;s GitHub token was pasted in here, so it
          lives on your GitHub account. This forgets it — only you can delete it, under Developer
          settings there.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Label htmlFor="confirm">Type &ldquo;delete everything&rdquo;</Label>
          <Input
            id="confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="delete everything"
          />
        </div>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busy || confirm.trim().toLowerCase() !== 'delete everything'}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch('/api/account/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm }),
              });
              if (response.ok) {
                // The account is gone, so the router cache and every rendered
                // tree holding its rows have to go with it. router.push()
                // keeps both, which is what this rule would have us use.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = '/';
                return;
              }
              const data = await response.json();
              setError(data.error ?? 'Could not delete the account.');
            } catch {
              setError('Could not delete the account.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-ui text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
