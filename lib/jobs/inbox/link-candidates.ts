import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { LinkCandidate } from '@/lib/jobs/email/link';
import { gmailOpenUrl } from '@/lib/email/gmail-open';

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

export interface UnlinkedMessage {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  classification: string;
  /** Deep link into the connected mailbox; null once the envelope is scrubbed. */
  gmailHref: string | null;
}

/**
 * Unlinked mail whose subject or sender mentions a search term, for the
 * "possible matches" box on the role page and its "add other" search.
 *
 * A plain `ilike` on the term is the whole test, deliberately: it is exactly
 * the signal a person uses eyeballing an inbox, matches what the note that
 * asked for this described, and it is all that is available for old mail —
 * the extracted fields `scoreCandidate` uses only exist at ingestion time.
 */
export async function findUnlinkedMessages(
  supabase: AppSupabaseClient,
  userId: string,
  opts: { applicationId: string; term: string; limit?: number },
): Promise<UnlinkedMessage[]> {
  const term = opts.term.trim();
  if (term.length < 2) return [];
  const limit = opts.limit ?? 20;
  // Escape ilike's own wildcards so a company name containing % or _ is
  // matched literally rather than as a pattern.
  const needle = term.replace(/[%_]/g, (char) => `\\${char}`);

  // One read per column rather than one `or` expression over both: a comma in
  // the term reads as the separator between an `or`'s conditions, and
  // `.ilike()` sends the pattern as its own parameter where a comma is
  // ordinary text. The limit applies to each read rather than to the pair.
  const matching = (column: 'subject' | 'from_address') =>
    supabase
      .from('inbox_messages')
      .select(
        'id, subject, from_address, received_at, classification, email_address, thread_id, provider_message_id',
      )
      .eq('user_id', userId)
      .is('resulting_application_id', null)
      .is('scrubbed_at', null)
      .ilike(column, `%${needle}%`)
      .order('received_at', { ascending: false })
      .limit(limit + 25);

  const [{ data: dismissed }, { data: bySubject }, { data: byFrom }] = await Promise.all([
    supabase
      .from('message_link_dismissals')
      .select('message_id')
      .eq('application_id', opts.applicationId),
    matching('subject'),
    matching('from_address'),
  ]);

  const dismissedIds = new Set((dismissed ?? []).map((row) => row.message_id as string));

  // A message matched by both columns is one message, and the two reads are
  // each newest first, so the merge is sorted again to keep the list in the
  // order the page shows.
  const seen = new Set<string>();
  const messages = [...(bySubject ?? []), ...(byFrom ?? [])]
    .filter((row) => {
      const id = row.id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => {
      const left = (a.received_at as string) ?? '';
      const right = (b.received_at as string) ?? '';
      return left === right ? 0 : left < right ? 1 : -1;
    });

  return messages
    .filter((row) => !dismissedIds.has(row.id as string))
    .slice(0, limit)
    .map((row) => ({
      id: row.id as string,
      subject: row.subject as string | null,
      fromAddress: row.from_address as string | null,
      receivedAt: row.received_at as string | null,
      classification: row.classification as string,
      gmailHref: gmailOpenUrl({
        emailAddress: (row.email_address as string) ?? null,
        threadId: (row.thread_id as string) ?? null,
        messageId: (row.provider_message_id as string) ?? null,
      }),
    }));
}
