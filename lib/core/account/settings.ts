import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { normalizeTimeZone } from '@/lib/core/timezone';
import { MODULE_IDS, isModuleId, type ModuleId } from '@/lib/modules';
import { parseTheme, type ThemeChoice } from '@/lib/theme';

/**
 * The settings that belong to the account rather than to a workspace.
 *
 * The rule for what lives here, and it is the one to argue from when the next
 * setting turns up: **if turning a module off would make the setting
 * meaningless, it is a module setting.** Timezone survives every module being
 * off. The vault's repository does not.
 *
 * Reading these is one query against `core.account_settings`. The two
 * `profiles.timezone` columns are still there and still read by about thirty
 * call sites, but they are mirrors now -- a trigger on this table keeps them
 * true, so nothing has to remember to write them and nothing can disagree.
 * They go when their readers do, which is a change nobody can see.
 */

// Deliberately not re-exported from here. This module is `server-only`, and a
// client component that reached for the module list through it would pull the
// Supabase server client into the browser bundle -- which is a build failure
// with a stack trace pointing at the wrong file. Import from @/lib/modules.

export interface AccountSettings {
  displayName: string | null;
  timezone: string;
  displayCurrency: string;
  enabledModules: ModuleId[];
  /** Null means follow the system, which is not the same as choosing light. */
  theme: ThemeChoice;
}

/**
 * The defaults, used when the row cannot be read at all.
 *
 * Every module on: a failed read must not silently empty someone's switcher,
 * because a person whose workspaces vanished has no way to tell a bug from a
 * setting they do not remember changing.
 */
export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  displayName: null,
  timezone: 'UTC',
  displayCurrency: 'USD',
  enabledModules: [...MODULE_IDS],
  theme: null,
};

function toModuleIds(raw: unknown): ModuleId[] {
  if (!Array.isArray(raw)) return [...MODULE_IDS];
  const known = raw.filter((m): m is ModuleId => typeof m === 'string' && isModuleId(m));
  return known.length > 0 ? known : [...MODULE_IDS];
}

export async function loadAccountSettings(userId: string): Promise<AccountSettings> {
  const supabase = await createCoreClient();

  const { data } = await supabase
    .from('account_settings')
    .select('display_name, timezone, display_currency, enabled_modules, theme')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return DEFAULT_ACCOUNT_SETTINGS;

  return {
    displayName: (data.display_name as string | null) ?? null,
    timezone: normalizeTimeZone(data.timezone as string) ?? 'UTC',
    displayCurrency: (data.display_currency as string) ?? 'USD',
    enabledModules: toModuleIds(data.enabled_modules),
    theme: parseTheme(data.theme as string | null),
  };
}

/** Whether a module is switched on. Absent settings mean everything is on. */
export function moduleEnabled(settings: AccountSettings, module: ModuleId): boolean {
  return settings.enabledModules.includes(module);
}

/**
 * Write the account-level fields, from a place that is not the account page.
 *
 * Onboarding is the only such caller: it asks for a name and reads the
 * browser's timezone before either workspace has a settings screen to visit.
 * It goes here rather than to `profiles` because this table is the writer and
 * those columns are mirrors -- writing them directly would put the value in
 * one workspace and not the other, which is the bug this table exists to end.
 */
export async function saveAccountIdentity(
  userId: string,
  fields: { timezone?: string | null; displayName?: string | null },
): Promise<{ error: string | null }> {
  const patch: Record<string, string> = {};

  // Normalised here as well as at the form: this is reachable by any future
  // caller, and an unusable zone stored through it takes down every page that
  // formats a date. See lib/core/timezone.ts.
  const timezone = normalizeTimeZone(fields.timezone);
  if (timezone) patch.timezone = timezone;
  if (fields.displayName?.trim()) patch.display_name = fields.displayName.trim();

  if (Object.keys(patch).length === 0) return { error: null };

  const supabase = await createCoreClient();
  const { error } = await supabase.from('account_settings').update(patch).eq('user_id', userId);
  return { error: error?.message ?? null };
}
