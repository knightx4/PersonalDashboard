/**
 * What actually needs a human, and what only looked like it did.
 *
 * The review flag started as "anything the inbox decided on its own", which
 * was right when the inbox decided almost nothing. After six months of mail it
 * meant 295 flagged pursuits and 501 flagged events -- a badge reading 870,
 * which is the same as no queue at all. A flag on everything carries no
 * information, and the first thing that happens to a queue nobody can finish
 * is that nobody opens it.
 *
 * So the question here is narrower than "did a machine do this". It is: **is
 * there a decision only you can make?** Most of what the inbox infers is not a
 * judgement call at all -- an ATS does not email you a rejection for a job you
 * never applied to -- and the rows where it genuinely is a guess are few
 * enough to work through in a sitting.
 */

import type { AtsVendor } from '@/lib/jobs/email/ats-senders';
import type { MessageClassification } from '@/lib/jobs/email/classify';
import { isTerminal, type ApplicationEventKind, type ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * Mail that cannot exist unless you applied.
 *
 * Nobody is rejected from, assessed for, or offered a job they never applied
 * to. The pursuit is real; at most the *role title* is a guess, and a wrong
 * title is a detail you fix when you next look at the row, not a reason to
 * hold the whole thing in a queue.
 */
const SELF_PROVING: ReadonlySet<MessageClassification> = new Set([
  'rejection',
  'assessment',
  'offer',
]);

/** Senders that are a hiring system rather than a person or a mailing list. */
function isRecognisedAts(ats: AtsVendor): boolean {
  return ats !== 'unknown' && ats !== 'other';
}

export interface InferredFlagInput {
  /**
   * `application` -- mail that presupposes you applied, so a pursuit was
   * opened. `lead` -- inbound about a role with nothing on file, where whether
   * it belongs in the pipeline at all is the open question.
   */
  path: 'application' | 'lead';
  classification: MessageClassification;
  /** 'A' means Tier A settled it deterministically; the rest involved a model. */
  tier: 'A' | 'subject_heuristic' | 'none';
  ats: AtsVendor;
  /** Whether the company was already on file or invented from this message. */
  companyKind: 'existing' | 'new';
}

/**
 * Whether a pursuit the inbox opened needs you to confirm it exists.
 *
 * Note what is *not* considered: how sure the linker was about which role, or
 * whether the company record is new. Those affect the details on the row, and
 * the row is visible and editable either way. The flag is reserved for "this
 * might not be a real pursuit", because that is the only error that quietly
 * corrupts the funnel.
 */
export function inferredApplicationNeedsReview(input: InferredFlagInput): boolean {
  // A lead is the inbox's opinion that inbound mail is worth tracking. That is
  // a genuine guess about your intent, and it is the one it gets wrong.
  if (input.path === 'lead') return true;

  // A model reading prose is not evidence on its own, whatever it concluded.
  if (input.tier !== 'A') return true;

  if (SELF_PROVING.has(input.classification)) return false;

  // A confirmation is only self-proving when it came from a hiring system. The
  // same words from a person's own address are as likely to be a newsletter.
  if (input.classification === 'application_confirmation') {
    return !isRecognisedAts(input.ats);
  }

  return true;
}

/**
 * Whether an event that could not be applied is worth your attention.
 *
 * Only forward-moving mail is. A second rejection, or a confirmation arriving
 * after the pursuit closed, is an echo: recorded for the timeline, decided by
 * nobody. But an assessment or an interview invite landing on something the
 * app believes is closed means the app is probably wrong, and that is worth
 * exactly one look.
 */
const REOPENS_A_PURSUIT: ReadonlySet<ApplicationEventKind> = new Set([
  'screen_scheduled',
  'assessment_sent',
  'interview_scheduled',
  'offer',
  'recruiter_reply',
]);

export function unappliedEventNeedsReview(kind: ApplicationEventKind): boolean {
  return REOPENS_A_PURSUIT.has(kind);
}

/**
 * The same question for a message linked to a pursuit by hand.
 *
 * Linking from the queue records the event without moving a closed pursuit,
 * exactly as ingestion does -- so it asks the same thing, and for a while it
 * did not: it flagged *every* event that landed on a closed pursuit, kind
 * ignored. Linking a rejection to an already-rejected pursuit therefore put
 * "they really did come back -- reopen" in front of a person, on the strength
 * of mail saying the opposite. A rejection is the one kind of mail that can
 * never mean a pursuit reopened.
 */
export function handLinkedEventNeedsReview(
  status: ApplicationStatus,
  kind: ApplicationEventKind,
): boolean {
  return isTerminal(status) && unappliedEventNeedsReview(kind);
}

/**
 * Whether inbound mail may move a pursuit at this status.
 *
 * `rejected`, `withdrawn` and `role_closed` are facts, and nothing in the
 * mailbox overturns a fact. `ghosted` is not a fact -- it is this app's
 * assumption, made by a clock, that silence meant no. Mail arriving afterwards
 * is the thing that assumption was waiting for, so it wins: a rejection turns
 * a guess into a certainty, and an interview invite means the guess was simply
 * wrong and the pursuit is alive.
 */
export function inboundMayMove(status: ApplicationStatus): boolean {
  if (status === 'ghosted') return true;
  return !isTerminal(status);
}
