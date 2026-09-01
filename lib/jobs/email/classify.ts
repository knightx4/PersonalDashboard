import {
  atsVendorForDomain,
  companyHintFromSubdomain,
  isIgnoredSender,
  domainFromAddress,
  isKnownAtsSender,
  isSchedulingSender,
  type AtsVendor,
} from './ats-senders';

/**
 * Tier A classification: deterministic, free, and correct on most of the
 * automated volume. Tier B (lib/email/extract.ts) sends what is left to a small
 * model.
 *
 * Rejections get the most attention here because they are the most consequential
 * class and the most euphemistic text in the corpus. "We have decided to move
 * forward with other candidates", "we are pausing the search", "we will keep
 * your resume on file" and "the position has been filled" are all rejections and
 * none of them contain the word. The fixture set for this class is the largest
 * for the same reason.
 */

export const CLASSIFICATIONS = [
  'application_confirmation',
  'rejection',
  'recruiter_outreach',
  'recruiter_reply',
  'interview_invite',
  'scheduling',
  'assessment',
  'offer',
  'networking',
  'job_alert',
  'not_relevant',
] as const;

export type MessageClassification = (typeof CLASSIFICATIONS)[number];

export interface CompanyDomainHit {
  id: string;
  slug: string;
  name: string;
  domains: string[];
}

export interface ClassifyInput {
  fromAddress: string | null;
  replyToAddress?: string | null;
  subject: string | null;
  /** First ~2000 chars of plaintext. Ephemeral; never persisted. */
  bodyPreview?: string | null;
  companies?: readonly CompanyDomainHit[];
  /**
   * The user's own additions to the ignored-sender list, on top of the
   * built-in one (Indeed). Unlike Indeed, a domain here is not blanket-noise
   * for everyone -- it is noise for this mailbox specifically, so it lives on
   * the profile rather than in code.
   */
  excludedDomains?: readonly string[];
}

export interface ClassifyResult {
  classification: MessageClassification;
  ats: AtsVendor;
  /** Only set when a domain matched a company the user already tracks. */
  company: CompanyDomainHit | null;
  /** A per-customer ATS subdomain, when the vendor uses one. */
  companyHint: string | null;
  /** True when the sender is a scheduling tool rather than an ATS. */
  scheduling: boolean;
  /** A = deterministic. subject_heuristic = keyword guess. none = needs Tier B. */
  tier: 'A' | 'subject_heuristic' | 'none';
}

/* -------------------------------------------------------------------------
 * Patterns. Ordered by consequence: the most damaging misclassification is a
 * rejection read as something else, so rejection is tested first.
 * ---------------------------------------------------------------------- */

/**
 * Euphemisms, in roughly descending frequency. Every one of these is a
 * rejection and only two of them contain a word a naive filter would look for.
 */
const REJECTION_BODY = [
  /mov(e|ing|ed) forward with other candidat/i,
  /decided to (move forward|proceed) with (other|another)/i,
  /pursu(e|ing) other candidat/i,
  /not (be )?(moving|progressing|proceeding) (you )?forward/i,
  /will not be (moving|progressing|proceeding)/i,
  /we (have )?(decided )?not to (move|proceed|continue|extend)/i,
  /decided not to (extend|proceed with|move forward with)/i,
  /not (selected|chosen) to (proceed|move forward|continue)/i,
  /(was|were) not selected/i,
  /other candidates whose (experience|background|qualifications)/i,
  /more closely (align|match)/i,
  /keep your (resume|cv|details|profile|application) on file/i,
  /(position|role|req(uisition)?) has been (filled|closed)/i,
  /we('| ha)ve (filled|closed) (the|this) (position|role)/i,
  /(pausing|placed on hold|put on hold|paused) (the|this) (search|role|position|req)/i,
  /no longer (moving forward|under consideration|being considered)/i,
  /(unfortunately|regret(fully)?|regret to inform)/i,
  /not (a|the) (right|best) (fit|match) (at this time|for this role)/i,
  /wish you (the best|well|luck)/i,
  /decided to go (in a different direction|with another candidate)/i,
  /will not be (extending|proceeding with) an offer/i,
];

const REJECTION_SUBJECT = [
  /\bupdate on your application\b/i,
  /\byour application (to|for|at)\b/i,
  /\bregarding your application\b/i,
  /\bapplication status\b/i,
  /\bthank you for (your interest|applying)\b/i,
];

const CONFIRMATION_SUBJECT = [
  /\b(we|thanks for|thank you for) (received|receiving) your application\b/i,
  /\bapplication received\b/i,
  /\bwe(?:'| ha)ve received your application\b/i,
  /\bthank(s| you) for applying\b/i,
  /\byour application (was|has been) (received|submitted)\b/i,
  /\bapplication (submitted|confirmation)\b/i,
];

/**
 * What an acknowledgement actually says.
 *
 * The original four all assumed the word "application" appears near the word
 * "received", and most auto-acks say neither. The plainest real one in the
 * corpus reads "Thank you for your interest in David Protein. Our team is
 * currently reviewing applications for this role." — no keyword, and a
 * subject of "Finance Associate - David Protein" with nothing in it either.
 * It was classified not relevant and vanished.
 *
 * Broadening this is safe in a way it would not be on its own, because two
 * things run first: rejections, which share most of this vocabulary, and the
 * scheduling ask below, which is what separates "we got it" from "pick a
 * time".
 */
const CONFIRMATION_BODY = [
  /(we|thanks for|thank you for) (have )?received your application/i,
  /your application (has been|was) (received|submitted|successfully submitted)/i,
  /thank(s| you) for (applying|your application|submitting|your interest)/i,
  /we(?:'| wi)ll review your (application|materials|resume)/i,
  /(currently|actively) reviewing (all |the )?(applications|candidates|submissions)/i,
  /(our|the) (team|hiring team|recruiting team) (is|are|will be) reviewing/i,
  /if there (are|is) any next steps/i,
  /(we|you)(?:'| wi)ll be in touch (with you )?(shortly|soon|if)/i,
  /has been (successfully )?(received|submitted)/i,
];

/**
 * A message that asks you to pick a time is an interview invitation, whatever
 * pleasantry it opened with.
 *
 * This exists because a great many invitations begin "Thank you for applying
 * to the X role at Y" and then ask for your availability. The confirmation
 * patterns matched that opening line, confirmation was tested first, and a
 * real interview invite was filed as an acknowledgement — so it never reached
 * the interviews board and the pursuit looked like it had gone quiet.
 *
 * Kept narrow deliberately. Every one of these is an instruction to the
 * candidate to do something about a time, which an acknowledgement never is.
 */
const SCHEDULING_ASK = [
  /(find|pick|choose|select|book|grab|suggest|share|submit|send) (a |your |some |your )?(time|times|availability)/i,
  /schedul(e|ing) (a |your )?(call|chat|interview|screen|meeting|time)/i,
  /would (like|love) to (set up|schedule|arrange|find a time)/i,
  /invite you to (an? )?(interview|conversation|call|chat)/i,
  /(let us|let's) (find|set up) a time/i,
  /what (does your|is your) (availability|schedule)/i,
  /(times|slots) that work for you/i,
  // The booking links themselves, which are unambiguous.
  /calendly\.com|ashbyhq\.com\/meeting|greenhouse\.io\/availability|savvycal\.com|cal\.com\/|modernloop|goodtime\.io|prelude\.co|hire\.withgoodtime/i,
];

const INTERVIEW_SUBJECT = [
  /\b(interview|phone screen|screening call|chat|conversation) (invit|request|schedul|with|for)/i,
  // "Interview Availability Request" -- a word between the two, which the
  // pattern above requires to be adjacent.
  /\binterview\b[^|]{0,20}\b(availability|request|scheduling)\b/i,
  /\bavailability (request|for)\b/i,
  /\binvitation to interview\b/i,
  /\b(next|following) steps?\b/i,
  /\bschedul(e|ing) (a |your )?(call|chat|interview|screen)/i,
  /\blet(?:'| u)s (find a time|set up a time)/i,
];

const INTERVIEW_BODY = [
  /would (you )?(like|love) to (set up|schedule|arrange)/i,
  /invite you to (an? )?(interview|conversation|call)/i,
  /(book|pick|choose|select) a time/i,
  /available (times|slots)/i,
  /moving (you )?(forward|to the next (round|stage))/i,
];

const ASSESSMENT_SUBJECT = [
  /\b(take[- ]?home|assessment|coding (challenge|exercise|test)|case study|work sample)\b/i,
  /\b(hackerrank|codesignal|codility|karat|woven|byteboard)\b/i,
];

const OFFER_SUBJECT = [
  /\boffer (letter|of employment)\b/i,
  /\bwe(?:'| a)re (thrilled|delighted|excited) to offer\b/i,
  /\byour offer\b/i,
];

const OFFER_BODY = [
  /(pleased|thrilled|delighted|excited) to (extend|offer)/i,
  /offer of employment/i,
  /formal offer/i,
];

const SCHEDULING_SUBJECT = [
  /\b(invitation|invite):/i,
  /\b(confirmed|reschedul|cancel(l)?ed):/i,
  /\bcalendar invite\b/i,
  /\bmeeting (confirmed|scheduled)\b/i,
];

const OUTREACH_SUBJECT = [
  /\b(opportunity|role|position) at\b/i,
  /\bquick question\b/i,
  /\b(reaching out|touching base|following up)\b/i,
  /\bare you open to\b/i,
  /\b(exciting|new) (role|opportunity)\b/i,
];

/**
 * Cold outreach markers. Deliberately separate from the reply markers below:
 * a message from a company the user already tracks is NOT automatically a
 * reply — recruiters at companies you have applied to also cold-source you for
 * unrelated roles, and calling that a reply links it to the wrong application.
 */
const OUTREACH_BODY = [
  /i(?:'| a)m a (recruiter|talent|technical sourcer)/i,
  /(came across|found) your (profile|linkedin|background)/i,
  /(would you be|are you) (open|interested) (to|in)/i,
  /reaching out (about|regarding)/i,
  /i(?:'| a)m (a )?(recruiter|sourcer) (at|with|working with)/i,
];

/** Continuation of a conversation that already exists. */
const REPLY_SUBJECT = [/^\s*(re|fw|fwd)\s*:/i];

const REPLY_BODY = [
  /thanks for (following up|the follow.?up|getting back|your patience)/i,
  /(as|per) (my|our) (last|previous) (email|message|note)/i,
  /where things stand/i,
  /(an )?update for you/i,
  /(circling|coming) back/i,
];

/**
 * Job boards generate enormous volume that matches every keyword above and
 * means nothing. This is why job_alert is its own classification rather than
 * being swept into not_relevant: labelled explicitly, it stays out of the
 * review queue instead of drowning it.
 */
const JOB_ALERT_SUBJECT = [
  /\b\d+\s+(new )?(jobs?|roles?|opportunit(y|ies)|matches)\b/i,
  /\bjobs? (for you|you might like|recommended|alert)\b/i,
  /\b(new|recommended|top) (jobs?|roles?|matches) (for you|in|at)\b/i,
  /\byour job alert\b/i,
  /\bjobs similar to\b/i,
  /\bbased on your (profile|searches|preferences)\b/i,
  /\bhiring now\b/i,
  /\bweekly (digest|roundup)\b/i,
];

const NETWORKING_SUBJECT = [
  /\b(invitation to connect|wants to connect|accepted your invitation)\b/i,
  /\b(intro|introduction) to\b/i,
  /\bcoffee chat\b/i,
];

/** Marketing and product mail from the same vendors, which is not job search. */
const NOT_RELEVANT_SUBJECT = [
  /\b(unsubscribe|newsletter|webinar|survey|feedback|product update|release notes)\b/i,
  /\b(invoice|receipt|payment|subscription)\b/i,
  /\b(password|verify your email|two-factor|security alert|sign-?in)\b/i,
];

/**
 * Collapse every run of whitespace to a single space.
 *
 * Not cosmetic. Mail is hard-wrapped at about seventy characters, so any
 * phrase long enough to be worth matching is eventually split across a
 * newline — and every pattern below contains a literal space. A real
 * rejection reading "we'll keep your resume on\nfile" matched nothing at all
 * and was filed as not relevant, which is the single most expensive miss this
 * classifier can make: a dead application stays counted as live and nothing
 * ever says otherwise.
 */
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function any(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function findCompany(
  domains: readonly (string | null)[],
  companies: readonly CompanyDomainHit[],
): CompanyDomainHit | null {
  for (const domain of domains) {
    if (!domain) continue;
    for (const company of companies) {
      for (const d of company.domains) {
        const needle = d.toLowerCase();
        if (domain === needle || domain.endsWith(`.${needle}`)) return company;
      }
    }
  }
  return null;
}

/**
 * Tier A. Returns `not_relevant` only when it is confident; anything recruiting
 * shaped that it cannot place is left at tier 'none' so Tier B sees it.
 */
export function classifyMessage(input: ClassifyInput): ClassifyResult {
  const fromDomain = domainFromAddress(input.fromAddress);
  const replyDomain = domainFromAddress(input.replyToAddress);
  const subject = flatten(input.subject ?? '');
  const body = flatten(input.bodyPreview ?? '');
  const blob = `${subject} ${body}`;

  const ats = atsVendorForDomain(fromDomain) !== 'unknown'
    ? atsVendorForDomain(fromDomain)
    : atsVendorForDomain(replyDomain);

  const company = findCompany([replyDomain, fromDomain], input.companies ?? []);
  const companyHint =
    companyHintFromSubdomain(fromDomain) ?? companyHintFromSubdomain(replyDomain);

  const known = isKnownAtsSender(fromDomain) || isKnownAtsSender(replyDomain);
  const scheduling = isSchedulingSender(fromDomain) || isSchedulingSender(replyDomain);
  const tier: 'A' | 'subject_heuristic' = known || company ? 'A' : 'subject_heuristic';

  const result = (classification: MessageClassification): ClassifyResult => ({
    classification,
    ats,
    company,
    companyHint,
    scheduling,
    tier,
  });

  // Ignored senders before anything else, including before job alerts: this is
  // "never mine", not "mine but uninteresting", and it should not spend a
  // single pattern match or reach the queue in any form. The user's own
  // additions are checked the same way as the built-in ones.
  const excludedDomains = (input.excludedDomains ?? []).map((d) => d.toLowerCase());
  const userExcluded = (domain: string | null) =>
    domain !== null &&
    excludedDomains.some((excluded) => domain === excluded || domain.endsWith(`.${excluded}`));
  if (
    isIgnoredSender(fromDomain) ||
    isIgnoredSender(replyDomain) ||
    userExcluded(fromDomain) ||
    userExcluded(replyDomain)
  ) {
    return { ...result('not_relevant'), tier: 'A' };
  }

  // Board digests next: they match every other pattern below and mean nothing.
  if (any(JOB_ALERT_SUBJECT, subject)) return result('job_alert');

  if (any(NOT_RELEVANT_SUBJECT, subject) && !any(REJECTION_BODY, blob)) {
    return { ...result('not_relevant'), tier: known ? 'A' : 'none' };
  }

  // Rejection before everything else: the subject of a rejection is usually
  // indistinguishable from a confirmation ("Your application to Acme"), so the
  // body is what decides, and a rejection read as a confirmation is the single
  // most damaging error the classifier can make.
  if (any(REJECTION_BODY, blob)) return result('rejection');

  if (any(OFFER_SUBJECT, subject) || any(OFFER_BODY, body)) return result('offer');

  if (any(ASSESSMENT_SUBJECT, blob)) return result('assessment');

  // Before confirmation, not after: an invitation that opens by thanking you
  // for applying is still an invitation, and it is the ask that says so.
  if (any(SCHEDULING_ASK, blob)) return result('interview_invite');

  if (any(CONFIRMATION_SUBJECT, subject) || any(CONFIRMATION_BODY, body)) {
    return result('application_confirmation');
  }

  if (any(INTERVIEW_SUBJECT, subject) || any(INTERVIEW_BODY, body)) {
    return result('interview_invite');
  }

  if (scheduling || any(SCHEDULING_SUBJECT, subject)) return result('scheduling');

  // A reply is a reply because it continues a conversation, not because the
  // sender's domain happens to be one the user tracks.
  if (any(REPLY_SUBJECT, subject) || any(REPLY_BODY, body)) {
    return result('recruiter_reply');
  }

  if (any(OUTREACH_BODY, body) || any(OUTREACH_SUBJECT, subject)) {
    return result('recruiter_outreach');
  }

  if (any(NETWORKING_SUBJECT, subject)) return result('networking');

  // A known ATS sender with an application-shaped subject is worth a second
  // look even when nothing above matched.
  if (known && any(REJECTION_SUBJECT, subject)) {
    return { ...result('rejection'), tier: 'A' };
  }

  if (known || company) {
    // Recruiting infrastructure, unrecognised shape: hand to Tier B rather than
    // discarding. Losing a rejection is invisible and expensive.
    return { ...result('not_relevant'), tier: 'none' };
  }

  return {
    classification: 'not_relevant',
    ats: 'unknown',
    company: null,
    companyHint: null,
    scheduling: false,
    tier: 'none',
  };
}

/** Classes that carry an application event and therefore need a full body. */
export const ACTIONABLE: ReadonlySet<MessageClassification> = new Set([
  'application_confirmation',
  'rejection',
  'recruiter_outreach',
  'recruiter_reply',
  'interview_invite',
  'scheduling',
  'assessment',
  'offer',
]);

/** The application_events kind each classification implies. */
export function eventKindFor(
  classification: MessageClassification,
): 'confirmation' | 'rejection' | 'recruiter_reply' | 'interview_scheduled' | 'assessment_sent' | 'offer' | 'screen_scheduled' | null {
  switch (classification) {
    case 'application_confirmation':
      return 'confirmation';
    case 'rejection':
      return 'rejection';
    case 'recruiter_outreach':
    case 'recruiter_reply':
      return 'recruiter_reply';
    case 'interview_invite':
      return 'interview_scheduled';
    case 'scheduling':
      return 'screen_scheduled';
    case 'assessment':
      return 'assessment_sent';
    case 'offer':
      return 'offer';
    default:
      return null;
  }
}
