import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/** The two comma lists on the profile that Find shows as the person's aim. */
export const AIM_COLUMNS = { targetTitles: 'target_titles', excludedIndustries: 'excluded_industries' } as const;
export type AimField = keyof typeof AIM_COLUMNS;

/** A comma or line list as Find's field reads it: trimmed, empties dropped. */
export function parseAimList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Target titles or excluded industries saved on the profile, as Find's field
 * and Dash's change_search_aim write them (plan #2473). The classifier and the
 * scores read the titles; the searches leave out the industries.
 */
export async function saveAimList(
  supabase: AppSupabaseClient,
  userId: string,
  field: AimField,
  list: string[],
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ [AIM_COLUMNS[field]]: list })
    .eq('id', userId)
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Record<string, unknown> | null) ?? null, error: null };
}
