import 'server-only';

import { discoverBoard, type CompanyBoardIdentity } from '@/lib/jobs/ats/discover';
import { hydrate, type BoardVendor } from '@/lib/jobs/ats/board';
import { matchPosting, type BoardMatch } from '@/lib/jobs/ats/match';
import { isBoardVendor } from '@/lib/jobs/ats/detect';
import {
  atsVendorForDomain,
  companyHintFromSubdomain,
  domainFromAddress,
} from '@/lib/jobs/email/ats-senders';
import {
  extractCompBand,
  extractRequirements,
  guessSeniority,
  guessWorkMode,
  jdHash,
} from '@/lib/jobs/jd/requirements';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { FetchedPosting } from '@/lib/jobs/ats/types';

/**
 * Reading a role's job description off the employer's own board.
 *
 * One implementation, two callers with quite different shapes: the nightly
 * backfill, which walks companies in batches on the service client, and the
 * "Look it up" button, which does one role on the user's own session. Splitting
 * the work at the board — resolve once per company, apply once per role — is
 * what lets both share it, because the expensive half is per company and the
 * decision half is per role.
 *
 * The rules both callers inherit:
 *
 *   - Fill blanks, never argue with something a person typed.
 *   - Never choose between two plausible postings. Ambiguity is an outcome,
 *     reported in words, not a coin toss.
 *   - Say why nothing happened. An empty description panel asks for nothing.
 */

/** The role fields the lookup reads and refuses to overwrite. */
export interface RoleForLookup {
  id: string;
  user_id: string;
  title: string;
  ats_job_id: string | null;
  location: string | null;
  work_mode: string | null;
  seniority: string | null;
  comp_min_cents: number | null;
  comp_max_cents: number | null;
  jd_url: string | null;
  posting_status: string;
}

export interface CompanyForLookup {
  id: string;
  name: string;
  ats_type: string | null;
  ats_board_token: string | null;
  ats_board_hint: string | null;
  careers_url: string | null;
  website: string | null;
}

export interface ResolvedBoard {
  vendor: BoardVendor;
  token: string;
  postings: FetchedPosting[];
  trust: 'known' | 'confirmed';
}

export type LookupOutcome =
  | { kind: 'filled'; vendor: string; title: string; note: string | null }
  | { kind: 'ambiguous'; vendor: string; candidates: Array<{ title: string; url: string | null }> }
  | { kind: 'closed'; vendor: string }
  | { kind: 'no_match'; vendor: string }
  | { kind: 'untitled' }
  | { kind: 'no_description'; vendor: string }
  | { kind: 'save_failed'; note: string };

/** Messages to look back through when recovering a board hint from mail. */
const MAIL_LOOKBACK = 50;

/**
 * The title ingestion gives a role whose name no message could supply.
 *
 * Duplicated from the inbox module on purpose: importing it from there would
 * pull the whole ingestion pipeline — the Gmail client, the model SDK — into
 * every caller of this file, including a server action that renders a button.
 * A string constant with a test holding the two in agreement is the cheaper
 * side of that trade.
 */
export const PLACEHOLDER_TITLE = 'Role from email';

/**
 * Find the company's board, and remember what was learned about it.
 *
 * Writes back whatever the search established — a recovered hint, a proven
 * token, the vendor — so the next lookup for this company costs one call
 * instead of a cascade. `ats_board_checked_at` is stamped either way, so a
 * company with no public board is retried on a clock rather than on every
 * sweep.
 */
export async function resolveBoard(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  company: CompanyForLookup,
  /** Whose company this is. The service client bypasses RLS, so it is stated. */
  userId: string,
  roleTitles: readonly string[],
  now: Date,
): Promise<{ ok: true; board: ResolvedBoard } | { ok: false; reason: string }> {
  let atsType = company.ats_type;
  let boardHint = company.ats_board_hint;

  // Ingestion records the ATS sending subdomain from here on, but every company
  // that predates that has none — and those are precisely the roles with no
  // description. Recovering it from mail already ingested is what stops the
  // first lookups from being reduced to guessing at names.
  if (!boardHint && !company.ats_board_token) {
    const recalled = await recallBoardHintFromMail(supabase, core, userId, company.id);
    if (recalled) {
      boardHint = recalled.hint;
      if (!atsType || atsType === 'unknown') atsType = recalled.vendor;
      const patch: Record<string, unknown> = { ats_board_hint: recalled.hint };
      if (!company.ats_type || company.ats_type === 'unknown') patch.ats_type = recalled.vendor;
      await supabase.from('companies').update(patch).eq('id', company.id);
    }
  }

  const identity: CompanyBoardIdentity = {
    name: company.name,
    atsType,
    boardToken: company.ats_board_token,
    boardHint,
    careersUrl: company.careers_url,
    website: company.website,
  };

  // A placeholder title confirms nothing, so it is not offered as evidence.
  const evidence = roleTitles.filter((title) => title && title !== PLACEHOLDER_TITLE);

  const outcome = await discoverBoard(identity, evidence);

  const patch: Record<string, unknown> = { ats_board_checked_at: now.toISOString() };
  if (outcome.ok) {
    // Proven now, whichever way it was found — a guessed token that a board
    // answered to and a role confirmed is a token.
    const { vendor, token } = outcome.board;
    if (company.ats_board_token !== token) patch.ats_board_token = token;
    if (!atsType || atsType === 'unknown') patch.ats_type = vendor;
  }
  await supabase.from('companies').update(patch).eq('id', company.id);

  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  return { ok: true, board: outcome.board };
}

/**
 * Decide which posting on the board is this role's, and write it.
 *
 * Every path here ends by stamping `jd_lookup_at` and a note, so a role that
 * came back empty says why rather than looking untried.
 */
export async function applyBoardToRole(
  supabase: AppSupabaseClient,
  role: RoleForLookup,
  board: ResolvedBoard,
  now: Date,
): Promise<LookupOutcome> {
  const { vendor, token, postings, trust } = board;
  const match = matchPosting({ title: role.title, atsJobId: role.ats_job_id }, postings);

  if (match.kind === 'ambiguous') {
    const candidates = match.candidates.slice(0, 4).map((candidate) => ({
      title: candidate.title,
      url: candidate.url,
    }));
    const titles = candidates.map((candidate) => `“${candidate.title}”`).join(', ');
    await note(
      supabase,
      role,
      `${match.candidates.length} postings on the ${vendor} board could be this role (${titles}). Open the one that is yours and paste it, rather than have the wrong description written here.`,
      now,
    );
    return { kind: 'ambiguous', vendor, candidates };
  }

  if (match.kind === 'none') {
    const matchable = Boolean(role.ats_job_id) || role.title !== PLACEHOLDER_TITLE;
    if (!matchable) {
      await note(
        supabase,
        role,
        'This role still has no title, so there is nothing to match against the board.',
        now,
      );
      return { kind: 'untitled' };
    }

    // A live board that does not carry this posting is the board saying the
    // posting is gone.
    if (role.posting_status === 'unknown') {
      await supabase
        .from('roles')
        .update({
          posting_status: 'closed',
          jd_lookup_at: now.toISOString(),
          jd_lookup_note: `Not on the ${vendor} board any more, so the posting has closed and its description is no longer published.`,
        })
        .eq('id', role.id)
        .eq('user_id', role.user_id);
      return { kind: 'closed', vendor };
    }

    await note(supabase, role, `No posting on the ${vendor} board matched this role.`, now);
    return { kind: 'no_match', vendor };
  }

  let posting: FetchedPosting | null;
  try {
    posting = await hydrate(vendor, token, match.posting);
  } catch {
    posting = null;
  }

  if (!posting || !posting.text.trim()) {
    await note(
      supabase,
      role,
      `Found the posting on the ${vendor} board, but it published no description.`,
      now,
    );
    return { kind: 'no_description', vendor };
  }

  return writePosting(supabase, role, posting, match, trust, now);
}

async function writePosting(
  supabase: AppSupabaseClient,
  role: RoleForLookup,
  posting: FetchedPosting,
  match: BoardMatch,
  trust: 'known' | 'confirmed',
  now: Date,
): Promise<LookupOutcome> {
  const text = posting.text.trim();
  const comp = extractCompBand(text);
  const provenanceNote = provenance(posting, match, trust);

  const update: Record<string, unknown> = {
    jd_text: text,
    jd_hash: jdHash(text),
    jd_fetched_at: now.toISOString(),
    jd_source: 'board_match',
    jd_lookup_at: now.toISOString(),
    jd_lookup_note: provenanceNote,
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

  if (!error) {
    return { kind: 'filled', vendor: posting.vendor, title: posting.title, note: provenanceNote };
  }

  // The one collision worth expecting: two roles at the same company whose
  // descriptions turn out to be the same posting. The unique index on jd_hash
  // is what noticed, and saying so is more use than a stack trace.
  const reason = /jd_hash/.test(error.message)
    ? 'The board posting matched here is already saved on another role for this company.'
    : 'Could not save the description read from the board.';
  await note(supabase, role, reason, now);
  return { kind: 'save_failed', note: reason };
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

async function note(
  supabase: AppSupabaseClient,
  role: RoleForLookup,
  text: string,
  now: Date,
): Promise<void> {
  await supabase
    .from('roles')
    .update({ jd_lookup_at: now.toISOString(), jd_lookup_note: text })
    .eq('id', role.id)
    .eq('user_id', role.user_id);
}

/**
 * Record an attempt that never reached a board, on every role it applies to.
 *
 * One statement: the roles passed here are always one company's, and a company
 * belongs to one user.
 */
export async function noteRoles(
  supabase: AppSupabaseClient,
  roles: readonly RoleForLookup[],
  text: string,
  now: Date,
): Promise<void> {
  if (roles.length === 0) return;

  await supabase
    .from('roles')
    .update({ jd_lookup_at: now.toISOString(), jd_lookup_note: text })
    .in(
      'id',
      roles.map((role) => role.id),
    )
    .eq('user_id', roles[0].user_id);
}

/**
 * The ATS sending subdomain, read back out of mail already ingested.
 *
 * `ramp.greenhouse.io` in a From header says both that this employer uses
 * Greenhouse and that their board is probably called `ramp` — the strongest
 * pointer at a board anywhere in a mailbox, given the mail almost never links
 * to the posting. Classification worked it out for every message and discarded
 * it, so for companies that predate it being recorded it has to be recovered
 * rather than waited for.
 *
 * Three queries, and only for a company with neither a hint nor a proven token.
 * The envelope lives in `core` and the verdict in `job_search`, hence the
 * second client; ids are shared between the two by design.
 *
 * Read through `companyHintFromSubdomain` rather than by matching domains in
 * SQL, so the judgement about what is a tenant subdomain and what is the
 * vendor's own infrastructure keeps its single definition.
 */
async function recallBoardHintFromMail(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
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
