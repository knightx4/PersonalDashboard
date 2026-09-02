import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import {
  atsVendorForDomain,
  companyHintFromSubdomain,
  domainFromAddress,
} from '@/lib/jobs/email/ats-senders';
import { isBoardVendor } from '@/lib/jobs/ats/detect';
import { discoverBoard, type CompanyBoardIdentity } from '@/lib/jobs/ats/discover';
import { hydrate } from '@/lib/jobs/ats/board';
import { matchPosting, type BoardMatch } from '@/lib/jobs/ats/match';
import {
  extractCompBand,
  extractRequirements,
  guessSeniority,
  guessWorkMode,
  jdHash,
} from '@/lib/jobs/jd/requirements';
import { PLACEHOLDER_ROLE_TITLE } from '@/lib/jobs/inbox/ingest-messages';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { FetchedPosting } from '@/lib/jobs/ats/types';

/**
 * Filling in job descriptions from the employer's own board.
 *
 * A role that arrived through the inbox has a title and nothing else. The
 * fetcher that could read its description has existed the whole time — it was
 * simply only ever reachable from the role form, so it only ever ran on roles
 * somebody had already typed in by hand.
 *
 * The unit of work here is a COMPANY, not a role, and that is the whole reason
 * this is affordable: every vendor serves its board in one call, so forty
 * missing descriptions at one employer cost one request. It also means the same
 * request tells us which of your postings have since closed, for free.
 *
 * Two rules it will not break:
 *
 *   - It fills blanks and never argues with something you typed. `jd_text is
 *     null` is the entry condition, and every other field is written only where
 *     it was empty.
 *   - It never guesses between two plausible postings. Ambiguity is recorded on
 *     the role in words and left for you, exactly as the inbox linker leaves an
 *     ambiguous message rather than inventing a link.
 */

export interface JdBackfillSummary {
  companies: number;
  filled: number;
  ambiguous: number;
  closed: number;
  noBoard: number;
}

/** Messages to look back through when recovering a board hint from mail. */
const MAIL_LOOKBACK = 50;

/** How long before a role with no description is worth another look. */
const RETRY_AFTER_DAYS = 14;

/** Companies per run. Each one is a board fetch plus, at worst, a few probes. */
const COMPANY_LIMIT = 6;

/**
 * The run's own clock. The daily cron has other stages after this one, and a
 * slow board must not be what stops the sweep from happening.
 */
const BUDGET_MS = 45_000;

interface RoleRow {
  id: string;
  user_id: string;
  company_id: string;
  title: string;
  ats_job_id: string | null;
  location: string | null;
  work_mode: string | null;
  seniority: string | null;
  comp_min_cents: number | null;
  comp_max_cents: number | null;
  jd_url: string | null;
  posting_status: string;
  companies: {
    id: string;
    name: string;
    ats_type: string | null;
    ats_board_token: string | null;
    ats_board_hint: string | null;
    careers_url: string | null;
    website: string | null;
  } | null;
}

export async function runJdBackfill(
  opts: { companyLimit?: number; now?: Date } = {},
): Promise<JdBackfillSummary> {
  const supabase = createServiceSupabase();
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
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
    .select(
      `id, user_id, company_id, title, ats_job_id, location, work_mode, seniority,
       comp_min_cents, comp_max_cents, jd_url, posting_status,
       companies!inner ( id, name, ats_type, ats_board_token, ats_board_hint, careers_url, website )`,
    )
    .is('jd_text', null)
    .or(`jd_lookup_at.is.null,jd_lookup_at.lt.${cutoff}`)
    .order('jd_lookup_at', { ascending: true, nullsFirst: true })
    .limit((opts.companyLimit ?? COMPANY_LIMIT) * 10);

  if (error) throw new Error(error.message);

  const byCompany = new Map<string, RoleRow[]>();
  for (const row of (data ?? []) as unknown as RoleRow[]) {
    if (!row.companies) continue;
    // Grouped by company, which is the whole economy of this job: one board
    // call answers every role at that employer. A company row belongs to
    // exactly one user -- two people tracking the same employer hold two rows
    // -- so the group's user_id is unambiguous and is what the service client's
    // updates filter on.
    const key = row.company_id;
    const bucket = byCompany.get(key);
    if (bucket) bucket.push(row);
    else byCompany.set(key, [row]);
  }

  for (const roles of byCompany.values()) {
    if (summary.companies >= (opts.companyLimit ?? COMPANY_LIMIT)) break;
    if (Date.now() - startedAt > BUDGET_MS) break;
    summary.companies += 1;
    await backfillCompany(supabase, roles, summary, now);
  }

  return summary;
}

async function backfillCompany(
  supabase: AppSupabaseClient,
  roles: RoleRow[],
  summary: JdBackfillSummary,
  now: Date,
): Promise<void> {
  const company = roles[0].companies;
  if (!company) return;

  // Ingestion records the ATS sending subdomain from here on, but every
  // company that predates that has none -- and those are precisely the roles
  // with no description. Recovering it from the mail already ingested is what
  // stops the first runs from being reduced to guessing at names.
  const recalled =
    !company.ats_board_hint && !company.ats_board_token
      ? await recallBoardHintFromMail(supabase, roles[0].user_id, company.id)
      : null;

  if (recalled) {
    const patch: Record<string, unknown> = { ats_board_hint: recalled.hint };
    if (!company.ats_type || company.ats_type === 'unknown') patch.ats_type = recalled.vendor;
    await supabase.from('companies').update(patch).eq('id', company.id);
    company.ats_board_hint = recalled.hint;
    if (!company.ats_type || company.ats_type === 'unknown') company.ats_type = recalled.vendor;
  }

  const identity: CompanyBoardIdentity = {
    name: company.name,
    atsType: company.ats_type,
    boardToken: company.ats_board_token,
    boardHint: company.ats_board_hint,
    careersUrl: company.careers_url,
    website: company.website,
  };

  // A placeholder title confirms nothing, so it is not offered as evidence.
  const realTitles = roles
    .map((role) => role.title)
    .filter((title) => title && title !== PLACEHOLDER_ROLE_TITLE);

  const outcome = await discoverBoard(identity, realTitles);

  const companyPatch: Record<string, unknown> = { ats_board_checked_at: now.toISOString() };
  if (outcome.ok) {
    // Proven now, whichever way it was found -- a guessed token that a board
    // answered to and a role confirmed is a token. Next run costs one call.
    const { vendor, token } = outcome.board;
    if (company.ats_board_token !== token) companyPatch.ats_board_token = token;
    if (!company.ats_type || company.ats_type === 'unknown') companyPatch.ats_type = vendor;
  }
  await supabase.from('companies').update(companyPatch).eq('id', company.id);

  if (!outcome.ok) {
    summary.noBoard += 1;
    await noteAll(supabase, roles, outcome.reason, now);
    return;
  }

  const { vendor, token, postings, trust } = outcome.board;

  for (const role of roles) {
    const match = matchPosting({ title: role.title, atsJobId: role.ats_job_id }, postings);

    if (match.kind === 'ambiguous') {
      summary.ambiguous += 1;
      const titles = match.candidates
        .slice(0, 4)
        .map((candidate) => `“${candidate.title}”`)
        .join(', ');
      await noteAll(
        supabase,
        [role],
        `${match.candidates.length} postings on the ${vendor} board could be this role (${titles}). Open the one that is yours and paste it, rather than have the wrong description written here.`,
        now,
      );
      continue;
    }

    if (match.kind === 'none') {
      // A live board that does not carry this posting is the board saying the
      // posting is gone. Only said out loud where the role has something to
      // match on in the first place.
      const matchable = Boolean(role.ats_job_id) || role.title !== PLACEHOLDER_ROLE_TITLE;
      if (matchable && role.posting_status === 'unknown') {
        summary.closed += 1;
        await supabase
          .from('roles')
          .update({
            posting_status: 'closed',
            jd_lookup_at: now.toISOString(),
            jd_lookup_note: `Not on the ${vendor} board any more, so the posting has closed and its description is no longer published.`,
          })
          .eq('id', role.id)
          .eq('user_id', role.user_id);
        continue;
      }
      await noteAll(
        supabase,
        [role],
        matchable
          ? `No posting on the ${vendor} board matched this role.`
          : 'This role still has no title, so there is nothing to match against the board.',
        now,
      );
      continue;
    }

    const posting = await hydrateQuietly(vendor, token, match.posting);
    if (!posting || !posting.text.trim()) {
      await noteAll(
        supabase,
        [role],
        `Found the posting on the ${vendor} board, but it published no description.`,
        now,
      );
      continue;
    }

    await writePosting(supabase, role, posting, match, trust, now);
    summary.filled += 1;
  }
}

/**
 * The ATS sending subdomain, read back out of mail already ingested.
 *
 * `ramp.greenhouse.io` in a From header says both that this employer uses
 * Greenhouse and that their board is probably called `ramp` -- the strongest
 * pointer at a board that exists anywhere in a mailbox, given that the mail
 * almost never links to the posting. Classification worked it out for every
 * message and discarded it, so for every company that predates that being
 * recorded it has to be recovered rather than waited for.
 *
 * Three queries, and only for a company that has neither a hint nor a proven
 * token. The envelope lives in `core` and the verdict in `job_search`, hence
 * the second client; ids are shared between the two by design.
 *
 * `companyHintFromSubdomain` is the single definition of what counts as a
 * tenant subdomain rather than the vendor's own infrastructure, which is why
 * this reads mail through it rather than matching domains in SQL.
 */
async function recallBoardHintFromMail(
  supabase: AppSupabaseClient,
  userId: string,
  companyId: string,
): Promise<{ hint: string; vendor: string } | null> {
  const { data: applications } = await supabase
    .from('applications')
    .select('id, roles!inner ( company_id )')
    .eq('user_id', userId)
    .eq('roles.company_id', companyId)
    .limit(MAIL_LOOKBACK);

  const applicationIds = (applications ?? []).map((row) => row.id as string);
  if (applicationIds.length === 0) return null;

  const { data: verdicts } = await supabase
    .from('ingested_messages')
    .select('id')
    .in('resulting_application_id', applicationIds)
    .limit(MAIL_LOOKBACK);

  const messageIds = (verdicts ?? []).map((row) => row.id as string);
  if (messageIds.length === 0) return null;

  const core = createCoreServiceSupabase();
  const { data: envelopes } = await core
    .from('ingested_messages')
    .select('from_address, reply_to_address, received_at')
    .in('id', messageIds)
    // A scrubbed envelope has had its headers removed on purpose. Nothing here
    // is a reason to go looking at what they used to say.
    .is('scrubbed_at', null)
    .order('received_at', { ascending: false })
    .limit(MAIL_LOOKBACK);

  for (const envelope of envelopes ?? []) {
    for (const address of [envelope.from_address, envelope.reply_to_address]) {
      const domain = domainFromAddress(address as string | null);
      const hint = companyHintFromSubdomain(domain);
      if (!hint) continue;
      const vendor = atsVendorForDomain(domain);
      if (!isBoardVendor(vendor)) continue;
      return { hint, vendor };
    }
  }

  return null;
}

async function hydrateQuietly(
  vendor: Parameters<typeof hydrate>[0],
  token: string,
  posting: FetchedPosting,
): Promise<FetchedPosting | null> {
  try {
    return await hydrate(vendor, token, posting);
  } catch {
    return null;
  }
}

async function writePosting(
  supabase: AppSupabaseClient,
  role: RoleRow,
  posting: FetchedPosting,
  match: BoardMatch,
  trust: 'known' | 'confirmed',
  now: Date,
): Promise<void> {
  const text = posting.text.trim();
  const comp = extractCompBand(text);

  const update: Record<string, unknown> = {
    jd_text: text,
    jd_hash: jdHash(text),
    jd_fetched_at: now.toISOString(),
    jd_source: 'board_match',
    jd_lookup_at: now.toISOString(),
    jd_lookup_note: provenance(posting, match, trust),
    requirements: extractRequirements(text),
    requirements_extracted_at: now.toISOString(),
    posting_status: 'open',
  };

  // Everything below fills a blank and nothing below overwrites one.
  if (!role.jd_url && posting.url) update.jd_url = posting.url;
  if (!role.ats_job_id && posting.atsJobId) update.ats_job_id = posting.atsJobId;
  if (!role.location && posting.location) update.location = posting.location;
  if (!role.seniority) update.seniority = guessSeniority(role.title, text);
  if (!role.work_mode) update.work_mode = guessWorkMode(text);
  if (role.comp_min_cents == null && role.comp_max_cents == null && comp) {
    update.comp_min_cents = comp.minCents;
    update.comp_max_cents = comp.maxCents;
    update.comp_source = 'posted';
  }

  const { error } = await supabase
    .from('roles')
    .update(update)
    .eq('id', role.id)
    .eq('user_id', role.user_id);

  // The one collision worth expecting: two roles at the same company whose
  // descriptions turn out to be the same posting. The unique index on jd_hash
  // is what noticed, and saying so is more use than a stack trace.
  if (error) {
    await noteAll(
      supabase,
      [role],
      /jd_hash/.test(error.message)
        ? 'The board posting matched here is already saved on another role for this company.'
        : 'Could not save the description read from the board.',
      now,
    );
  }
}

/**
 * What is written on the role about where its description came from.
 *
 * An id match needs no explanation. A title match does — it is the one that can
 * be wrong, and a line saying which posting was picked is what makes it
 * checkable in two seconds instead of never.
 */
function provenance(
  posting: FetchedPosting,
  match: BoardMatch,
  trust: 'known' | 'confirmed',
): string | null {
  if (match.kind === 'id') return null;
  if (match.kind === 'exact' && trust === 'known') return null;

  const how =
    match.kind === 'fuzzy'
      ? `matched on a close title, “${posting.title}”`
      : `matched on title, “${posting.title}”`;
  const board =
    trust === 'confirmed'
      ? `${posting.vendor} board found from the company name`
      : `${posting.vendor} board`;
  return `Read from the ${board} and ${how}. Worth a glance.`;
}

/**
 * Record what the attempt did on every role it applies to.
 *
 * One statement, because the roles handed here are always one company's and a
 * company's roles are always one user's -- which is also why the user_id filter
 * the service client requires can be taken from any of them.
 */
async function noteAll(
  supabase: AppSupabaseClient,
  roles: RoleRow[],
  note: string,
  now: Date,
): Promise<void> {
  if (roles.length === 0) return;

  await supabase
    .from('roles')
    .update({ jd_lookup_at: now.toISOString(), jd_lookup_note: note })
    .in('id', roles.map((role) => role.id))
    .eq('user_id', roles[0].user_id);
}
