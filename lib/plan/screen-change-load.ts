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

/**
 * The changed screens of the steps checked since `since`, for the strip on
 * Home (what shipped lately, as pictures). Two reads: the steps with a check
 * in the window, then every round of those steps, since a step's before shot
 * can sit in a round older than the window.
 */
export async function loadRecentScreenChanges(
  supabase: SupabaseClient,
  userId: string,
  since: string,
): Promise<Record<number, ScreenChangeView[]>> {
  const recent = await supabase
    .from('ui_checks')
    .select('step')
    .eq('user_id', userId)
    .not('step', 'is', null)
    .gte('created_at', since);
  if (recent.error) {
    console.error(`Could not read the recent design checks: ${recent.error.message}`);
    return {};
  }
  const steps = [...new Set((recent.data ?? []).map((row) => row.step as number))];
  if (steps.length === 0) return {};

  const { data, error } = await supabase
    .from('ui_checks')
    .select('step, surface, round, verdict, shots, created_at')
    .eq('user_id', userId)
    .in('step', steps);
  if (error) {
    console.error(`Could not read the recent design checks: ${error.message}`);
    return {};
  }
  return screenChangeViews(screenChanges((data ?? []) as ScreenCheckRow[]));
}
