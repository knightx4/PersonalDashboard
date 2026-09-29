import { CLASSIFICATIONS, type MessageClassification } from './classify';

/**
 * Job-email triage as one question for Jev (feature #1161).
 *
 * The same eleven labels Haiku picks from in buildSystemPrompt(), each with
 * the meaning Haiku is given there or that Tier A applies, plus `other`: Jev
 * has to pick one of the options, and without an escape it would force a
 * message that fits none into the nearest label. The pilot (plan #1165) asks
 * this question; the rollout (plan #1166) asks the same one, so what the
 * pilot measured is what goes live.
 *
 * Jev reads the same text Haiku reads: sender, reply-to, subject and the
 * first 6,000 characters of the body.
 */

export type JevJobEmailLabel = MessageClassification | 'other';

export const JOB_EMAIL_OPTIONS: Readonly<Record<JevJobEmailLabel, string>> = {
  application_confirmation:
    'An automated acknowledgement that an application was received. Not written by a person.',
  rejection:
    'The candidate is turned down, however it is phrased: moving forward with other candidates, pausing the search, keeping the resume on file, the position has been filled, going in a different direction.',
  recruiter_outreach:
    'A recruiter or hiring person contacting the candidate first, about a role the candidate has not applied for.',
  recruiter_reply:
    'A person at the employer or an agency writing back about an application or conversation already under way, not to invite, schedule, assess, offer or reject.',
  interview_invite: 'An invitation to interview, or to book an interview slot.',
  scheduling:
    'Arranging, confirming, moving or cancelling the time of an interview or call already agreed, including calendar and booking tool notices.',
  assessment: 'A take-home task, coding test, questionnaire or other assessment to complete.',
  offer: 'A job offer, or the paperwork for one.',
  networking:
    'A person writing about the job search in general rather than one application: an introduction, a coffee chat, a referral.',
  job_alert: 'A digest of many jobs from a job board or alert service, whatever else it mentions.',
  not_relevant:
    'Not about the candidate’s job search: vendor marketing, newsletters, receipts, security and account mail.',
  other: 'About the candidate’s job search, but none of the other options fits.',
};

export const JOB_EMAIL_QUESTION = {
  type: 'choice',
  question: 'Which kind of email is this, from the point of view of a candidate looking for a job?',
  options: JOB_EMAIL_OPTIONS,
} as const;

/** The same cut Tier B makes (MAX_BODY_CHARS in lib/jobs/inbox/tier-b.ts). */
export const JEV_BODY_CHARS = 6_000;

export function jobEmailState(input: {
  fromAddress: string | null;
  replyToAddress: string | null;
  subject: string | null;
  body: string;
}): Record<string, string> {
  return {
    from: input.fromAddress ?? 'unknown',
    reply_to: input.replyToAddress ?? 'none',
    subject: input.subject ?? '(no subject)',
    body: input.body.slice(0, JEV_BODY_CHARS),
  };
}

export function isJobEmailLabel(value: string): value is JevJobEmailLabel {
  return value === 'other' || (CLASSIFICATIONS as readonly string[]).includes(value);
}
