import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { fileFigureNeedSteps, type FileNeedStepsResult } from '@/lib/learn/figures/need-steps';

/**
 * Figures the lessons keep asking for, filed as plan steps, as a stage of the
 * daily cron (plan #2321.10). A few reads per account, and one insert per
 * step it writes; no model call.
 */
export async function runFigureNeedStepsDaily(): Promise<FileNeedStepsResult> {
  return fileFigureNeedSteps({ learn: createLearnServiceSupabase(), plan: createServiceSupabase() });
}
