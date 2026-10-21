import type { SchemaClient } from '@/lib/ask/db';

/**
 * Renaming a theme on the vault map, as the theme's page and Dash's
 * rename_theme both do it (plan #2473.5). Names are unique per person,
 * ignoring case, so a name another theme has comes back as `taken`. The
 * write names the user as well as relying on row level security, so the
 * connector's service-role client is held to the person too. The name comes
 * in trimmed and checked (themeNameProblem).
 */

export const THEME_NAME_MAX = 200;

/** Why a theme name cannot be used, in the page's words, or null. */
export function themeNameProblem(name: string): string | null {
  if (!name) return 'A theme needs a name.';
  if (name.length > THEME_NAME_MAX) return `Keep the name under ${THEME_NAME_MAX} characters.`;
  return null;
}

export type ThemeRename =
  | { ok: true; row: Record<string, unknown> }
  /** `taken`: another theme of theirs has the name. `missing`: no theme of theirs has that id. */
  | { ok: false; reason: 'taken' | 'missing' | 'error'; message?: string };

export async function renameThemeRow(
  supabase: SchemaClient,
  userId: string,
  id: string,
  name: string,
  columns = '*',
): Promise<ThemeRename> {
  const { data, error } = await supabase.from('themes').update({ name }).eq('id', id).eq('user_id', userId).select(columns);
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'taken' };
    return { ok: false, reason: 'error', message: error.message };
  }
  const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
  return row ? { ok: true, row } : { ok: false, reason: 'missing' };
}
