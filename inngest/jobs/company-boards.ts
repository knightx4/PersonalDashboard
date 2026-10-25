import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { findCompanyBoards } from '@/lib/jobs/discover/company-boards';

/**
 * The daily look for the boards of the companies on file (plan #2535.2).
 *
 * The daily cron kicks /api/cron/company-boards, which answers at once and
 * works this after the response, so the cron's other stages never wait on
 * somebody else's slow careers page. Up to 60 companies an account a day
 * (lib/jobs/discover/company-boards.ts), every account with the job search
 * on. One account's failure is noted and the rest go on.
 */

export const COMPANY_BOARDS_ROUTE = '/api/cron/company-boards';

/** Everything the run may take, inside its route's five minutes. */
const BUDGET_MS = 240_000;
/** Less than this and another account would not get a batch in. */
const MIN_ACCOUNT_MS = 60_000;

export type CompanyBoardsSummary = {
  people: number;
  checked: number;
  found: number;
  noSite: number;
  left: number;
  failed: string[];
};

export async function runCompanyBoards(now: Date = new Date()): Promise<CompanyBoardsSummary> {
  const core = createCoreServiceSupabase();
  const jobs = createServiceSupabase();
  const { data, error } = await core.from('account_settings').select('user_id');
  if (error) throw new Error(`Reading the accounts failed: ${error.message}`);

  const deadline = Date.now() + BUDGET_MS;
  const summary: CompanyBoardsSummary = { people: 0, checked: 0, found: 0, noSite: 0, left: 0, failed: [] };
  for (const { user_id: userId } of (data ?? []) as { user_id: string }[]) {
    if (deadline - Date.now() < MIN_ACCOUNT_MS) break;
    try {
      if (!moduleEnabled(await loadAccountSettings(userId, core), 'jobs')) continue;
      summary.people += 1;
      const result = await findCompanyBoards(jobs, userId, { now, deadline });
      summary.checked += result.checked;
      summary.found += result.found;
      summary.noSite += result.noSite;
      summary.left += result.left;
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}

/** Ask the route to run the look. False when it could not be reached; tomorrow's cron tries again. */
export async function kickCompanyBoards(origin: string): Promise<{ kicked: boolean }> {
  const token = process.env.CRON_SECRET?.trim() || process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!token) return { kicked: false };
  const res = await fetch(`${origin}${COMPANY_BOARDS_ROUTE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`The company boards route answered ${res.status}`);
  return { kicked: true };
}
