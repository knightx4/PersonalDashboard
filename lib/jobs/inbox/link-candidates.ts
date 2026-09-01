import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { LinkCandidate } from '@/lib/jobs/email/link';

/**
 * Load the applications a message could plausibly belong to.
 *
 * Everything the linker scores, it scores from this shape. Loading the whole
 * pipeline is fine: a personal job search is hundreds of rows, not millions,
 * and narrowing here would mean duplicating the linker's own signal logic in
 * SQL where it cannot be tested.
 */
export async function loadLinkCandidates(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<LinkCandidate[]> {
  const { data, error } = await supabase
    .from('applications')
    .select(
      `id, role_id, status, attempt, submitted_at, created_at,
       roles!inner ( id, title, ats_job_id, company_id,
                     companies!inner ( id, name, domains ) )`,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error || !data) return [];

  type Row = {
    id: string;
    role_id: string;
    status: string;
    attempt: number;
    submitted_at: string | null;
    created_at: string;
    roles: {
      id: string;
      title: string;
      ats_job_id: string | null;
      company_id: string;
      companies: { id: string; name: string; domains: string[] };
    };
  };

  const rows = data as unknown as Row[];

  // Thread ids already linked, so thread continuity — the most precise signal —
  // can be checked without a query per candidate.
  const { data: threads } = await supabase
    .from('inbox_messages')
    .select('thread_id, resulting_application_id')
    .not('thread_id', 'is', null)
    .not('resulting_application_id', 'is', null)
    .in(
      'resulting_application_id',
      rows.map((r) => r.id),
    );

  const threadsByApplication = new Map<string, string[]>();
  for (const row of threads ?? []) {
    const applicationId = row.resulting_application_id as string;
    const list = threadsByApplication.get(applicationId) ?? [];
    list.push(row.thread_id as string);
    threadsByApplication.set(applicationId, list);
  }

  return rows.map((row) => ({
    applicationId: row.id,
    roleId: row.role_id,
    companyId: row.roles.companies.id,
    companyName: row.roles.companies.name,
    companyDomains: row.roles.companies.domains ?? [],
    roleTitle: row.roles.title,
    atsJobId: row.roles.ats_job_id,
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    createdAt: new Date(row.created_at),
    status: row.status,
    attempt: row.attempt,
    threadIds: threadsByApplication.get(row.id) ?? [],
  }));
}

export async function loadCompanies(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<Array<{ id: string; name: string; slug: string; domains: string[] }>> {
  const { data } = await supabase
    .from('companies')
    .select('id, name, slug, domains')
    .eq('user_id', userId);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    domains: (row.domains as string[]) ?? [],
  }));
}

/** The user's own additions to the ignored-sender list. See excluded_senders. */
export async function loadExcludedDomains(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase.from('excluded_senders').select('domain').eq('user_id', userId);
  return (data ?? []).map((row) => row.domain as string);
}
