'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Banner as UiBanner } from '@/components/ui/banner';
import { ModuleMark } from '@/components/ui/module-mark';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label, Select } from '@/components/ui/field';
import { TimezoneField, detectTimeZone } from '@/components/ui/timezone-field';
import { useSettingSave } from '@/components/patterns/settings-fields';
import { DISPLAY_CURRENCIES } from '@/lib/fx/money-fx';
import { modulesFor, type ModuleId } from '@/lib/modules';
import { updateAccountSettings, updateEnabledModules } from './actions';

/**
 * Account's sections that run in the browser. The page itself
 * (view.tsx) is drawn on the server by the settings page pattern, which puts
 * each of these in the card of its tab.
 */

export function YouSection({
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
    <div>
      <p className="text-ui text-ink-muted">{email}</p>

      <div
        className={cn(
          'mt-3 divide-y divide-border border-t border-border',
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
              <Button
                type="button"
                variant="link"
                onClick={() => commit('timezone', detected)}
                className="text-micro"
              >
                Use {detected.replace(/_/g, ' ')}
              </Button>
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
    </div>
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

/** The detected zone never changes while the page is open. */
function subscribeNever(): () => void {
  return () => {};
}

/**
 * Which workspaces are on, each saved when it is ticked (the settings page
 * pattern, plan #1937.11), where a Save button once sat under the list. The
 * whole current choice is sent, so two quick presses cannot undo each other,
 * and a refused save puts the box back with a toast.
 */
export function ModulesSection({ enabled, isOwner }: { enabled: ModuleId[]; isOwner: boolean }) {
  const [on, setOn] = useState<ModuleId[]>(enabled);
  const { run } = useSettingSave(saveModules);

  /**
   * The workspaces this account may have, not every workspace there is. A
   * checkbox for one it may not open would be a switch that does nothing --
   * `updateEnabledModules` filters the form through the same rule, so ticking
   * it by hand leaves it off anyway.
   */
  const modules = modulesFor(isOwner);

  function toggle(id: ModuleId, checked: boolean) {
    const previous = on;
    const next = checked ? [...on, id] : on.filter((m) => m !== id);
    setOn(next);
    run(next, () => setOn(previous));
  }

  return (
    <div>
      <p className="text-ui text-ink-muted">Turning one off hides it. Nothing is deleted.</p>
      {/* Divides, not one box per row: the card around them already says
          "one list" (law 11). */}
      <div className="mt-3 divide-y divide-border border-t border-border">
        {modules.map((module) => (
          <label key={module.id} className="row-pad flex items-start gap-3">
            <Checkbox
              checked={on.includes(module.id)}
              onChange={(event) => toggle(module.id, event.target.checked)}
              className="mt-1"
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
    </div>
  );
}

/** The chosen workspaces, as the form the action reads. */
async function saveModules(ids: ModuleId[]): Promise<{ error?: string }> {
  const form = new FormData();
  for (const id of ids) form.set(`module:${id}`, 'on');
  return updateEnabledModules({}, form);
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
export function DangerSection({ vaultEnabled }: { vaultEnabled: boolean }) {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section>
      <h3 className="flex items-center gap-2 text-ui font-semibold text-danger">
        <ShieldAlert className="size-4" strokeWidth={1.75} aria-hidden />
        Delete everything
      </h3>
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
