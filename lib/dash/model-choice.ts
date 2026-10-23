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

export type SaveDashModelResult =
  | { ok: true; before: DashChoiceId | null; after: DashChoiceId | null }
  | { ok: false; error: string };

/**
 * Save the model an account chose for Dash, or null to clear the choice back
 * to the default. The one write: the picker's server action
 * (lib/dash/model-choice-actions.ts) calls it as the signed-in person, and
 * Dash's set_dash_model tool (lib/dash/model-writes.ts) as the person it is
 * answering, so the button and Dash cannot disagree about what is allowed.
 *
 * Refuses anything but the three ids in lib/core/models.ts before it reaches
 * the database, which refuses it too (account_settings_dash_model_ck). Says
 * what was saved before as well, which Dash's record of the change keeps.
 */
export async function saveDashModel(
  core: Pick<CoreSupabaseClient, 'from'>,
  userId: string,
  model: string | null,
): Promise<SaveDashModelResult> {
  if (model !== null && !isDashChoice(model)) {
    return { ok: false, error: 'Dash can answer with Haiku, Sonnet or Opus.' };
  }
  const failed = { ok: false, error: 'Could not save that choice. Try again.' } as const;
  try {
    const { data, error: readError } = await core
      .from('account_settings')
      .select('dash_model')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) return failed;
    const saved = (data as { dash_model?: unknown } | null)?.dash_model;
    const { error } = await core
      .from('account_settings')
      .upsert({ user_id: userId, dash_model: model }, { onConflict: 'user_id' });
    if (error) return failed;
    return { ok: true, before: isDashChoice(saved) ? saved : null, after: model };
  } catch {
    return failed;
  }
}
