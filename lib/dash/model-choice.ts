import 'server-only';

import { isDashChoice, type DashChoiceId } from '@/lib/core/models';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { DASH_MODELS } from '@/lib/dash/models';

/**
 * The model Dash answers this account with (plan #2458.1).
 *
 * Backed by `core.account_settings.dash_model` (migration 0271), null until
 * the person picks one. Null, a value outside the three models, a failed read
 * and a deploy that lands before the column exists all read as the default,
 * DASH_MODELS.ask (Sonnet), so a question is always answered.
 */
export async function dashModelFor(
  core: Pick<CoreSupabaseClient, 'from'>,
  userId: string,
): Promise<DashChoiceId> {
  const fallback = DASH_MODELS.ask as DashChoiceId;
  try {
    const { data, error } = await core
      .from('account_settings')
      .select('dash_model')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return fallback;
    const value = (data as { dash_model?: unknown }).dash_model;
    return isDashChoice(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
