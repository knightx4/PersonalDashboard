'use client';

import { useActionState } from 'react';
import { Briefcase, LayoutGrid, ListChecks, NotebookText, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { TimezoneField } from '@/components/ui/timezone-field';
import { DISPLAY_CURRENCIES } from '@/lib/fx/money-fx';
import { MODULES, type ModuleId } from '@/lib/modules';
import { updateAccountSettings, updateEnabledModules, type AccountState } from './actions';

/**
 * Icons only.
 *
 * Labels and descriptions come from lib/modules.ts, the one list -- writing
 * them again here is precisely the second list that list exists to remove.
 * Partial with a fallback, the same way the home page does it: a module added
 * to that list must never fail to render because nobody chose its icon yet.
 */
const ICONS: Partial<
  Record<ModuleId, React.ComponentType<{ className?: string; strokeWidth?: number }>>
> = {
  shopping: ShoppingBag,
  jobs: Briefcase,
  vault: NotebookText,
  todo: ListChecks,
};

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
    </div>
  );
}

function Banner({ state }: { state: AccountState }) {
  if (!state.error && !state.message) return null;
  return (
    <p
      className={cn(
        'rounded-lg px-3 py-2 text-[13px]',
        state.error ? 'bg-status-rejected-tint text-status-rejected' : 'bg-status-offer-tint text-status-offer',
      )}
    >
      {state.error ?? state.message}
    </p>
  );
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
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">You</h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">{email}</p>

      <form action={action} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="displayName">Name</Label>
            <Input id="displayName" name="displayName" defaultValue={settings.displayName} />
          </div>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <TimezoneField id="timezone" name="timezone" defaultValue={settings.timezone} />
            <p className="mt-1 text-[11px] text-ink-faint">
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
            <p className="mt-1 text-[11px] text-ink-faint">
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
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Workspaces</h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        Which of these appear in the switcher. Turning one off hides it — nothing is deleted, and
        turning it back on restores exactly what was there.
      </p>

      <form action={action} className="mt-4 space-y-3">
        {MODULES.map((module) => {
          const Icon = ICONS[module.id] ?? LayoutGrid;
          return (
            <label
              key={module.id}
              className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <input
                type="checkbox"
                name={`module:${module.id}`}
                defaultChecked={enabled.includes(module.id)}
                className="mt-1 size-4 accent-[var(--color-brand)]"
              />
              <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{module.label}</span>
                <span className="block text-[12px] leading-snug text-ink-muted">
                  {module.description}
                </span>
              </span>
            </label>
          );
        })}

        <Banner state={state} />
        <Button type="submit">Save</Button>
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
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Module settings</h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        Settings that only mean something inside one workspace live in that workspace.
      </p>

      <ul className="mt-4 divide-y divide-border">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="block py-2.5 hover:text-brand">
              <span className="block text-[13px] font-medium text-ink">{link.label}</span>
              <span className="block text-[12px] text-ink-muted">{link.hint}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
