import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import {
  applyBoardToRole,
  noteRoles,
  resolveBoard,
  type CompanyForLookup,
  type RoleForLookup,
} from '@/lib/jobs/jd/lookup';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Filling in job descriptions from the employer's own board, nightly.
 *
 * A role that arrived through the inbox has a title and nothing else. The
 * fetcher that could read its description has existed the whole time -- it was
 * simply only ever reachable from the role form, so it only ever ran on roles
 * somebody had already typed in by hand.
 *
 * This is the batching and the budget. The judgement -- which board, which
 * posting, what may be written over -- lives in lib/jobs/jd/lookup.ts, shared
 * with the button on the role page, so a description found by hand and one
 * found at 3am are found the same way.
 *
 * The unit of work is a COMPANY, not a role, and that is the whole reason this
 * is affordable: every vendor serves its board in one call, so forty missing
 * descriptions at one employer cost one request. It also means the same request
 * tells us which of your postings have since closed, for free.
 */

export interface JdBackfillSummary {
  companies: number;
  filled: number;
  ambiguous: number;
  closed: number;
  noBoard: number;
}

/** How long before a role with no description is worth another look. */
const RETRY_AFTER_DAYS = 14;

/** Companies per run. Each one is a board fetch plus, at worst, a few probes. */
const COMPANY_LIMIT = 6;

/**
 * The run's own clock. The daily cron has other stages after this one, and a
 * slow board must not be what stops the sweep from happening.
 */
const BUDGET_MS = 45_000;

const ROLE_COLUMNS = `id, user_id, company_id, title, ats_job_id, location, work_mode, seniority,
   comp_min_cents, comp_max_cents, jd_url, posting_status,
   companies!inner ( id, name, ats_type, ats_board_token, ats_board_hint, careers_url, website )`;

type RoleRow = RoleForLookup & {
  company_id: string;
  companies: CompanyForLookup | null;
};

export async function runJdBackfill(
  opts: { companyLimit?: number; now?: Date } = {},
): Promise<JdBackfillSummary> {
  const supabase = createServiceSupabase();
  const core = createCoreServiceSupabase();
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  const companyLimit = opts.companyLimit ?? COMPANY_LIMIT;
  const summary: JdBackfillSummary = {
    companies: 0,
    filled: 0,
    ambiguous: 0,
    closed: 0,
    noBoard: 0,
  };

  const cutoff = new Date(now.getTime() - RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('roles')
    .select(ROLE_COLUMNS)
    .is('jd_text', null)
    .or(`jd_lookup_at.is.null,jd_lookup_at.lt.${cutoff}`)
    .order('jd_lookup_at', { ascending: true, nullsFirst: true })
    .limit(companyLimit * 10);

  if (error) throw new Error(error.message);

  const byCompany = new Map<string, RoleRow[]>();
  for (const row of (data ?? []) as unknown as RoleRow[]) {
    if (!row.companies) continue;
    // Grouped by company, which is the whole economy of this job: one board
    // call answers every role at that employer. A company row belongs to
    // exactly one user -- two people tracking the same employer hold two rows
    // -- so the group's user_id is unambiguous and is what the service client's
    // updates filter on.
    const bucket = byCompany.get(row.company_id);
    if (bucket) bucket.push(row);
    else byCompany.set(row.company_id, [row]);
  }

  for (const roles of byCompany.values()) {
    if (summary.companies >= companyLimit) break;
    if (Date.now() - startedAt > BUDGET_MS) break;
    summary.companies += 1;
    await backfillCompany(supabase, core, roles, summary, now);
  }

  return summary;
}

async function backfillCompany(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  roles: RoleRow[],
  summary: JdBackfillSummary,
  now: Date,
): Promise<void> {
  const company = roles[0].companies;
  if (!company) return;

  const resolved = await resolveBoard(
    supabase,
    core,
    company,
    roles[0].user_id,
    roles.map((role) => role.title),
    now,
  );

  if (!resolved.ok) {
    summary.noBoard += 1;
    await noteRoles(supabase, roles, resolved.reason, now);
    return;
  }

  for (const role of roles) {
    const outcome = await applyBoardToRole(supabase, role, resolved.board, now);
    if (outcome.kind === 'filled') summary.filled += 1;
    else if (outcome.kind === 'ambiguous') summary.ambiguous += 1;
    else if (outcome.kind === 'closed') summary.closed += 1;
  }
}
