'use client';

import { useActionState } from 'react';
import { Banner as UiBanner } from '@/components/ui/banner';
import { ModuleMark } from '@/components/ui/module-mark';
import { signOut } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { TimezoneField } from '@/components/ui/timezone-field';
import { DISPLAY_CURRENCIES } from '@/lib/fx/money-fx';
import { MODULES, type ModuleId } from '@/lib/modules';
import { updateAccountSettings, updateEnabledModules, type AccountState } from './actions';
import { cardVariants } from '@/components/ui/card';

export function AccountView({
  email,
  settings,
}: {
  email: string;
  settings: {
    displayName: string;
    timezone: string;
    displayCurrency: string;
    enabledModules: ModuleId[];
  };
}) {
  return (
    <div className="space-y-6">
      <YouSection email={email} settings={settings} />
      <ModulesSection enabled={settings.enabledModules} />
      <ModuleSettingsSection enabled={settings.enabledModules} />
      <SessionSection />
    </div>
  );
}

function Banner({ state }: { state: AccountState }) {
  if (!state.error && !state.message) return null;
  // A saved form is not a "good" event -- good is reserved for money coming
  // back -- so success is info.
  return <UiBanner tone={state.error ? 'bad' : 'info'}>{state.error ?? state.message}</UiBanner>;
}

function YouSection({
  email,
  settings,
}: {
  email: string;
  settings: { displayName: string; timezone: string; displayCurrency: string };
}) {
  const [state, action] = useActionState<AccountState, FormData>(updateAccountSettings, {});

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">You</h2>
      <p className="mt-0.5 text-ui text-ink-muted">{email}</p>

      <form action={action} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="displayName">Name</Label>
            <Input id="displayName" name="displayName" defaultValue={settings.displayName} />
          </div>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <TimezoneField id="timezone" name="timezone" defaultValue={settings.timezone} />
            <p className="mt-1 text-small text-ink-muted">
              Every workspace reads dates in this zone — what counts as today, when a return
              window closes, what time an interview is.
            </p>
          </div>
          <div>
            <Label htmlFor="displayCurrency">Display currency</Label>
            <Select
              id="displayCurrency"
              name="displayCurrency"
              defaultValue={settings.displayCurrency}
            >
              {DISPLAY_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-small text-ink-muted">
              Spend totals are converted into this. Orders keep the currency they were paid in.
            </p>
          </div>
        </div>

        <Banner state={state} />
        <Button type="submit">Save</Button>
      </form>
    </section>
  );
}

function ModulesSection({ enabled }: { enabled: ModuleId[] }) {
  const [state, action] = useActionState<AccountState, FormData>(updateEnabledModules, {});

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Workspaces</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        Which of these appear in the switcher. Turning one off hides it — nothing is deleted, and
        turning it back on restores exactly what was there.
      </p>

      <form action={action} className="mt-4">
        {/* Divides, not one box per row. Six workspaces drawn as six bordered
            rectangles inside a bordered card is the card's own hairline
            repeated once per item, and a page of that reads as boxes rather
            than as workspaces. The rules between them say "one list" on their
            own -- law 11. */}
        <div className="divide-y divide-border border-y border-border">
          {MODULES.map((module) => (
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
  const links = ([
    {
      module: 'shopping',
      href: '/shopping/settings',
      label: 'Shopping settings',
      hint: 'Connected mailbox, merchants and return windows',
    },
    {
      module: 'jobs',
      href: '/jobs/settings',
      label: 'Job search settings',
      hint: 'Target titles, ghost threshold, résumés and evidence',
    },
    {
      module: 'vault',
      href: '/vault/settings',
      label: 'Vault settings',
      hint: 'The repository this mirrors, and its token',
    },
    {
      module: 'todo',
      href: '/todo/settings',
      label: 'Todo settings',
      hint: 'How far ahead the agenda looks, and what feeds it',
    },
  ] as const).filter((link) => enabled.includes(link.module));

  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Module settings</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        Settings that only mean something inside one workspace live in that workspace.
      </p>

      <ul className="mt-4 divide-y divide-border">
        {links.map((link) => (
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
 * person who switched Shopping off under Workspaces above had no way to sign
 * out of their own account. An account-level action can never live inside a
 * module.
 */
function SessionSection() {
  return (
    <section className={cardVariants({ padding: 'standard' })}>
      <h2 className="text-body font-semibold text-ink">Session</h2>
      <p className="mt-0.5 text-ui text-ink-muted">
        Signing out ends this session on this device. Nothing is deleted.
      </p>
      <form action={signOut} className="mt-4">
        <Button variant="secondary" type="submit">
          Sign out
        </Button>
      </form>
    </section>
  );
}
