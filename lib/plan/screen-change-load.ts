import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  screenChanges,
  screenChangeViews,
  type ScreenCheckRow,
  type ScreenChangeView,
} from './screen-change';

/**
 * Every step's changed screens with their before and after pictures, by step
 * number (plan #1541), for the plan rows and the changelog lines.
 *
 * One read of `ui_checks`: a few rows per step that changed a screen, and
 * nothing is signed here. The pictures load through /dev/ui/shot when a row
 * is opened, so the page pays for a shot only when somebody looks at it.
 */
export async function loadScreenChanges(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<number, ScreenChangeView[]>> {
  const { data, error } = await supabase
    .from('ui_checks')
    .select('step, surface, round, verdict, shots, created_at')
    .eq('user_id', userId)
    .not('step', 'is', null);
  if (error) {
    console.error(`Could not read the design checks: ${error.message}`);
    return {};
  }
  return screenChangeViews(screenChanges((data ?? []) as ScreenCheckRow[]));
}
