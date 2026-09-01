import { domainFromAddress, isKnownAtsSender, isSchedulingSender } from './ats-senders';
import type { MessageClassification } from './classify';

/**
 * Linking an inbound message to an existing application.
 *
 * This is the hard part of the project, and it is hard in a different place
 * than the commerce app was. Extraction is easier here — there is no arithmetic
 * to reconcile — but there is also no arithmetic gate to lean on, so the
 * decision to write or hold has to be made by a confidence score with explicit
 * deterministic filters around it.
 *
 * The governing rule: NEVER auto-create an application from an ambiguous match.
 * A wrongly created duplicate corrupts the funnel silently, and a funnel you do
 * not trust is a funnel you stop opening. Missing a link is recoverable in ten
 * seconds from the review queue.
 */

export interface LinkCandidate {
  applicationId: string;
  roleId: string;
  companyId: string;
  companyName: string;
  companyDomains: string[];
  roleTitle: string;
  atsJobId: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  status: string;
  attempt: number;
  /** Thread ids already linked to this application. */
  threadIds: string[];
}

export interface LinkInput {
  threadId: string | null;
  fromAddress: string | null;
  replyToAddress: string | null;
  subject: string | null;
  bodyPreview: string | null;
  receivedAt: Date | null;
  classification: MessageClassification;
  /** Company name the extractor pulled out of the message, if any. */
  extractedCompany: string | null;
  extractedRole: string | null;
  extractedAtsJobId: string | null;
  /** Per-customer ATS subdomain, when the vendor uses one. */
  companyHint: string | null;
}

export type LinkMethod =
  | 'thread'
  | 'ats_job_id'
  | 'domain'
  | 'company_name'
  | 'company_hint'
  | 'role_title'
  | 'none';

export interface ScoredCandidate {
  candidate: LinkCandidate;
  confidence: number;
  method: LinkMethod;
  reasons: string[];
}

/**
 * The company an inferred pursuit belongs to.
 *
 * `new` exists because the alternative was a deadlock. Company resolution only
 * ever matched companies already on file, and nothing in the ingestion path
 * created one — so on a first scan of a real mailbox every message failed to
 * resolve a company, every one was held, and the pipeline stayed empty no
 * matter how much recruiting mail was in there. The one thing the app promises
 * (the confirmation email is the log entry) could not happen until you had
 * already done the work by hand.
 */
export type LinkCompany =
  | { kind: 'existing'; id: string; name: string }
  | { kind: 'new'; name: string; domain: string | null };

export type LinkDecision =
  | { action: 'link'; candidate: LinkCandidate; confidence: number; method: LinkMethod; reasons: string[] }
  | { action: 'review'; candidates: ScoredCandidate[]; reason: string }
  | { action: 'create_inferred_application'; company: LinkCompany; confidence: number; reasons: string[] }
  | { action: 'create_lead'; company: LinkCompany; reasons: string[] }
  | { action: 'hold'; reason: string };

/** Auto-link only above this, and only with exactly one candidate. */
export const AUTO_LINK_THRESHOLD = 0.85;
/** Below this a message is not offered as a link at all. */
export const REVIEW_FLOOR = 0.5;
/**
 * How recent a confirmation must be to infer an application from it.
 *
 * The default is the backfill window rather than a week. Seven days meant a
 * first scan — which reads months of mail — inferred nothing from any of it,
 * because every message it found was older than the window on the day it was
 * read. The caller passes the window the sync actually covered.
 */
export const INFERRED_APPLICATION_WINDOW_DAYS = 180;

/**
 * Mail that can only exist because you applied.
 *
 * A rejection is as much proof of an application as a confirmation is -- more,
 * in the common case where you applied through a portal that never emailed you
 * and the only trace in the mailbox is the "we have decided to move forward
 * with other candidates". Held instead of inferred, that whole company never
 * appears anywhere in the app, which is exactly how a mailbox full of job mail
 * shows an empty Companies page.
 *
 * `scheduling` is deliberately not here -- finding a time can just as easily
 * follow inbound outreach you never applied to, so it opens a lead below
 * rather than an application you may never have sent. `recruiter_reply` is
 * vaguer still and stays held.
 */
const PRESUPPOSES_APPLICATION: ReadonlySet<MessageClassification> = new Set([
  'application_confirmation',
  'rejection',
  'assessment',
  'offer',
]);

/** How each of those reads in the reason line shown next to the pursuit. */
const OUTCOME_NOUN: Partial<Record<MessageClassification, string>> = {
  application_confirmation: 'Confirmation',
  rejection: 'Rejection',
  assessment: 'Assessment',
  offer: 'Offer',
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|sa|ag|bv|nv|technologies|technology|labs|group|holdings)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(senior|sr|junior|jr|staff|lead|principal|i{1,3}|iv|v|\d+)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trigram similarity, matching what pg_trgm does closely enough to reason about. */
export function titleSimilarity(a: string, b: string): number {
  const trigrams = (value: string): Set<string> => {
    const padded = `  ${value} `;
    const out = new Set<string>();
    for (let i = 0; i < padded.length - 2; i += 1) out.add(padded.slice(i, i + 3));
    return out;
  };
  const left = trigrams(normalizeTitle(a));
  const right = trigrams(normalizeTitle(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function domainHit(candidate: LinkCandidate, domains: readonly (string | null)[]): boolean {
  for (const domain of domains) {
    if (!domain) continue;
    for (const owned of candidate.companyDomains) {
      const needle = owned.toLowerCase();
      if (domain === needle || domain.endsWith(`.${needle}`)) return true;
    }
  }
  return false;
}

/**
 * Score one candidate. Signals are ordered by precision, and the two exact ones
 * (thread and ATS job id) short-circuit the rest — they are either right or the
 * data is corrupt, and hedging them with fuzzy signals only lowers a correct
 * score.
 */
export function scoreCandidate(input: LinkInput, candidate: LinkCandidate): ScoredCandidate {
  const reasons: string[] = [];

  // 1. Thread continuity. Exact, cheap, and checked before anything else.
  //    If any message in this thread is already linked, this one belongs there.
  if (input.threadId && candidate.threadIds.includes(input.threadId)) {
    return {
      candidate,
      confidence: 1,
      method: 'thread',
      reasons: ['Same email thread as a message already linked to this application'],
    };
  }

  // 2. ATS job id present in the message and matching the role. Also exact,
  //    except that a reposted role keeps its job id across attempts, so a
  //    closed attempt is nudged below a live one at the same role.
  if (
    input.extractedAtsJobId &&
    candidate.atsJobId &&
    input.extractedAtsJobId.trim() === candidate.atsJobId.trim()
  ) {
    const closed = TERMINAL_CANDIDATE_STATUSES.has(candidate.status);
    return {
      candidate,
      confidence: closed ? 0.9 : 0.97,
      method: 'ats_job_id',
      reasons: [
        `ATS job id ${candidate.atsJobId} matches this role`,
        ...(closed ? ['This attempt is already closed'] : []),
      ],
    };
  }

  let score = 0;
  let method: LinkMethod = 'none';

  const fromDomain = domainFromAddress(input.fromAddress);
  const replyDomain = domainFromAddress(input.replyToAddress);

  // 3. Sender or reply-to domain owned by the company. Strong; narrows to a
  //    company but not to a role.
  if (domainHit(candidate, [replyDomain, fromDomain])) {
    score += 0.55;
    method = 'domain';
    reasons.push('Sender or reply-to domain belongs to this company');
  }

  // 4. Company name match, normalised. Strong.
  const candidateName = normalizeCompanyName(candidate.companyName);
  const extractedName = input.extractedCompany
    ? normalizeCompanyName(input.extractedCompany)
    : null;
  if (extractedName && candidateName && extractedName === candidateName) {
    score += 0.5;
    if (method === 'none') method = 'company_name';
    reasons.push(`Message names ${candidate.companyName}`);
  } else if (candidateName && input.subject) {
    const subject = normalizeCompanyName(input.subject);
    if (candidateName.length >= 3 && subject.includes(candidateName)) {
      score += 0.35;
      if (method === 'none') method = 'company_name';
      reasons.push(`Subject line mentions ${candidate.companyName}`);
    }
  }

  // 5. Per-customer ATS subdomain (acme.greenhouse.io).
  if (input.companyHint && candidateName) {
    const hint = normalizeCompanyName(input.companyHint);
    if (hint && (hint === candidateName || candidateName.startsWith(hint))) {
      score += 0.3;
      if (method === 'none') method = 'company_hint';
      reasons.push(`Sent from the ${input.companyHint} board`);
    }
  }

  // 6. Role title similarity. Disambiguates between several roles at one
  //    company rather than establishing the company in the first place.
  if (input.extractedRole) {
    const similarity = titleSimilarity(input.extractedRole, candidate.roleTitle);
    if (similarity >= 0.75) {
      score += 0.25;
      reasons.push(`Role title matches "${candidate.roleTitle}"`);
    } else if (similarity >= 0.4) {
      score += 0.1;
      reasons.push(`Role title is similar to "${candidate.roleTitle}"`);
    } else if (score > 0) {
      // Same company, clearly different role: actively less likely.
      score -= 0.15;
      reasons.push(`Role title does not match "${candidate.roleTitle}"`);
    }
  }

  // A closed pursuit is a slightly worse home for new mail than a live one.
  // Small on purpose: it breaks ties between attempts without ever pulling an
  // exact thread or job-id match below the auto-link threshold.
  if (score > 0 && TERMINAL_CANDIDATE_STATUSES.has(candidate.status)) {
    score -= 0.05;
    reasons.push('This attempt is already closed');
  }

  return {
    candidate,
    confidence: Math.max(0, Math.min(1, score)),
    method: score > 0 ? method : 'none',
    reasons,
  };
}

const TERMINAL_CANDIDATE_STATUSES = new Set([
  'rejected',
  'withdrawn',
  'ghosted',
  'role_closed',
]);

/**
 * Date plausibility. A FILTER, not a score: a message that predates the
 * submission cannot belong to that application, and no amount of name matching
 * makes it possible.
 */
export function isDatePlausible(input: LinkInput, candidate: LinkCandidate): boolean {
  if (!input.receivedAt) return true;
  const floor = candidate.submittedAt ?? candidate.createdAt;
  // One day of slack: submitted_at is often the user's own date entry, and an
  // auto-ack can beat it across a timezone boundary.
  return input.receivedAt.getTime() >= floor.getTime() - DAY_MS;
}

export interface DecideOptions {
  /** Companies the user tracks, for the create-a-lead and inferred paths. */
  companies: ReadonlyArray<{ id: string; name: string; domains: string[] }>;
  now?: Date;
  /**
   * How far back a confirmation may be dated and still infer an application.
   * Pass the window the sync actually covered; the default is the backfill's.
   */
  inferredWindowDays?: number;
}

/**
 * Names that are not a company.
 *
 * The extractor returns whatever the message called the employer, and a good
 * fraction of recruiting mail calls it "the hiring team". Creating a company
 * called Talent Acquisition is worse than holding the message, because it then
 * absorbs every later message that fails to resolve.
 */
const NON_COMPANY_NAMES = new Set([
  'careers',
  'recruiting',
  'recruitment',
  'talent',
  'talent acquisition',
  'hiring',
  'hiring team',
  'the hiring team',
  'the team',
  'people team',
  'human resources',
  'hr',
  'no reply',
  'noreply',
  'do not reply',
  'jobs',
  'apply',
  'application',
  'notifications',
  'candidates',
  'candidate',
  'applicants',
  'support',
  'admin',
  'team',
  'company',
  'unknown',
  // Placeholders a posting uses when it will not name the employer. Seen in
  // the wild as a company called "Confidential" collecting pursuits.
  'confidential',
  'undisclosed',
  'not disclosed',
  'stealth',
  'stealth startup',
  'private',
  'various',
  'multiple',
  'n a',
  'none',
]);

/**
 * A company name worth creating a record from, or null.
 *
 * Deliberately strict. Everything that gets through here becomes a row that
 * later messages match against, so a junk name does not just clutter the list —
 * it starts collecting other companies' mail.
 */
export function usableCompanyName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return null;

  const normalized = normalizeCompanyName(name);
  if (!normalized) return null;
  if (NON_COMPANY_NAMES.has(normalized)) return null;

  // An address or a URL is a sender, not a name.
  if (/@|https?:\/\//.test(name)) return null;
  // A bare number, or a string with no letters at all.
  if (!/[a-z]/i.test(name)) return null;

  // A bare hostname is an identifier, not a name: "buildwithporter.com" went
  // in verbatim and sat in the company list looking like a bug, because it is
  // one. The label in front of the suffix is the company, so use that.
  const hostname = name.match(/^([a-z0-9][a-z0-9-]*)\.[a-z.]{2,}$/i);
  if (hostname) {
    const label = hostname[1];
    if (label.length < 2) return null;
    if (NON_COMPANY_NAMES.has(normalizeCompanyName(label))) return null;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  return name;
}

/**
 * The employer's own domain, when the message carries one.
 *
 * The ATS's domain is not it: `greenhouse.io` on a company record would match
 * every Greenhouse customer's mail to that one company, which is the worst
 * possible outcome for a field whose whole job is disambiguation. Scheduling
 * tools are excluded for the same reason.
 */
export function employerDomain(input: LinkInput): string | null {
  for (const domain of [domainFromAddress(input.replyToAddress), domainFromAddress(input.fromAddress)]) {
    if (!domain) continue;
    if (isKnownAtsSender(domain) || isSchedulingSender(domain)) continue;
    // Free mail is a person, not an employer.
    if (/^(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton(mail)?|aol)\./.test(domain)) continue;
    return domain;
  }
  return null;
}

/**
 * The company to attribute an unmatched message to: one already on file, or a
 * new one described well enough to create.
 */
export function companyForMessage(
  input: LinkInput,
  companies: DecideOptions['companies'],
): LinkCompany | null {
  const existing = resolveCompany(input, companies);
  if (existing) return { kind: 'existing', id: existing.id, name: existing.name };

  // The extractor read the employer out of the body; the hint is the ATS
  // subdomain, which is the company's own name by construction.
  const extracted = usableCompanyName(input.extractedCompany);
  const hinted = usableCompanyName(input.companyHint);
  const domain = employerDomain(input);
  // A domain-derived name is trusted only for mail that presupposes an
  // application: that mail could only exist because you already applied
  // somewhere, so the sender's own domain is the employer's -- the extractor
  // failing to name them in the body is not a reason to hold a written
  // interview from delano.henry@canonical.com. Cold outreach gets no such
  // trust: an agency's own domain is not the employer's, and guessing one
  // from it is worse than holding the message.
  const domainName =
    !extracted && !hinted && PRESUPPOSES_APPLICATION.has(input.classification)
      ? usableCompanyName(domain)
      : null;
  if (!extracted && !hinted && !domainName) return null;

  // A subdomain is lowercase by construction, and "ramp" reads as a typo on a
  // page full of properly cased names. A name from the body is left exactly as
  // the sender wrote it, because they know how it is spelled.
  const name = extracted ?? (hinted ? titleCaseSlug(hinted) : domainName!);

  return { kind: 'new', name, domain };
}

function titleCaseSlug(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Score every candidate and decide what to do.
 *
 * The one exception to "never auto-create" is the feature that makes the app
 * worth building: an application_confirmation, from a known company, dated
 * within the last few days, with no matching application, creates one flagged
 * for review. That is the case where you applied through a portal and never
 * logged it — which is most of the time — and it appears in the pipeline asking
 * you to confirm the details rather than asking you to remember it existed.
 */
export function decideLink(
  input: LinkInput,
  candidates: readonly LinkCandidate[],
  opts: DecideOptions,
): LinkDecision {
  const now = opts.now ?? new Date();

  const plausible = candidates.filter((candidate) => isDatePlausible(input, candidate));

  const scored = plausible
    .map((candidate) => scoreCandidate(input, candidate))
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      // Recency tiebreak: when two attempts at one role are both plausible, the
      // more recent open one wins.
      const aAt = a.candidate.submittedAt ?? a.candidate.createdAt;
      const bAt = b.candidate.submittedAt ?? b.candidate.createdAt;
      return bAt.getTime() - aAt.getTime();
    });

  const best = scored[0];
  const runnerUp = scored[1];

  if (best && best.confidence >= AUTO_LINK_THRESHOLD) {
    // Two attempts at the SAME role are not an ambiguity — re-applying is
    // normal, and the more recent open attempt is where new mail belongs. The
    // sort has already put it first. An ambiguity is two DIFFERENT roles
    // scoring the same, and that is what goes to review.
    const sameRole = runnerUp && runnerUp.candidate.roleId === best.candidate.roleId;
    const tied = runnerUp && !sameRole && best.confidence - runnerUp.confidence < 0.1;
    if (!tied) {
      return {
        action: 'link',
        candidate: best.candidate,
        confidence: best.confidence,
        method: best.method,
        reasons: best.reasons,
      };
    }
    return {
      action: 'review',
      candidates: scored.slice(0, 3),
      reason: 'Two applications match this message about equally well.',
    };
  }

  if (best && best.confidence >= REVIEW_FLOOR) {
    return {
      action: 'review',
      candidates: scored.slice(0, 3),
      reason: 'Confident enough to suggest, not confident enough to link.',
    };
  }

  // Nothing matched well. Can we at least work out the company — either one on
  // file, or one this message describes well enough to create?
  const company = companyForMessage(input, opts.companies);

  if (!company) {
    return {
      action: 'hold',
      reason: 'Could not work out which company this is about.',
    };
  }

  const windowDays = opts.inferredWindowDays ?? INFERRED_APPLICATION_WINDOW_DAYS;
  const fresh =
    input.receivedAt !== null && now.getTime() - input.receivedAt.getTime() <= windowDays * DAY_MS;

  const isNew = company.kind === 'new';
  const provenance = isNew
    ? `${company.name} is not on your list yet, so it was added alongside this`
    : 'Created and flagged for review rather than silently added to the funnel';

  if (PRESUPPOSES_APPLICATION.has(input.classification) && fresh) {
    return {
      action: 'create_inferred_application',
      company,
      // A brand-new company is a weaker claim than a recognised one: the name
      // came out of the message rather than off a record you maintain.
      confidence: isNew ? 0.5 : 0.6,
      reasons: [
        `${OUTCOME_NOUN[input.classification] ?? 'Mail'} from ${company.name} with no matching application on file`,
        provenance,
      ],
    };
  }

  // Inbound mail about a role you never applied to is genuinely new
  // information. It belongs in the pipeline as a lead, not as an application:
  // counting it as one would put a denominator in the funnel that you never
  // actually sent.
  if (
    input.classification === 'recruiter_outreach' ||
    input.classification === 'interview_invite' ||
    input.classification === 'scheduling'
  ) {
    return {
      action: 'create_lead',
      company,
      reasons: [`Inbound about a role with no application on file at ${company.name}`, provenance],
    };
  }

  return {
    action: 'hold',
    reason: isNew
      ? `This looks like it is from ${company.name}, but not enough to open a pursuit from.`
      : `Recognised ${company.name} but could not match this to an application.`,
  };
}

function resolveCompany(
  input: LinkInput,
  companies: DecideOptions['companies'],
): { id: string; name: string } | null {
  const fromDomain = domainFromAddress(input.fromAddress);
  const replyDomain = domainFromAddress(input.replyToAddress);

  for (const domain of [replyDomain, fromDomain]) {
    if (!domain) continue;
    for (const company of companies) {
      if (
        company.domains.some(
          (owned) => domain === owned.toLowerCase() || domain.endsWith(`.${owned.toLowerCase()}`),
        )
      ) {
        return company;
      }
    }
  }

  const extracted = input.extractedCompany ? normalizeCompanyName(input.extractedCompany) : null;
  if (extracted) {
    for (const company of companies) {
      if (normalizeCompanyName(company.name) === extracted) return company;
    }
  }

  if (input.companyHint) {
    const hint = normalizeCompanyName(input.companyHint);
    for (const company of companies) {
      const name = normalizeCompanyName(company.name);
      if (name && (name === hint || name.startsWith(hint))) return company;
    }
  }

  return null;
}
