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
 *
 * `interview_invite` and `scheduling` follow the stored labels and the
 * pipeline: a booked interview is `interview_invite`, which moves the
 * application to its interview stage (eventKindFor gives interview_scheduled),
 * and finding a time is `scheduling`, which only moves it to in_process. The
 * pilot's first wording had them nearly the other way round
 * (docs/trials/2026-09-29-jev-job-email.md).
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
  interview_invite:
    'An interview that is booked: an invitation that gives the time, a confirmation of the time, a reminder before it, or a calendar invite for it.',
  scheduling:
    'Finding a time for an interview or call that is not booked yet: a request for availability, a list of offered slots, or a link to a booking page.',
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

/**
 * Labels Jev's answer is never used for, however sure it is: the trial found
 * `recruiter_reply` unreliable (2 of 7 confident answers agreed, and the label
 * feeds the response rate), `offer` is rare and costly to get wrong, and
 * `other` has no classification to store. Haiku decides these.
 */
export const JEV_UNTRUSTED_LABELS: ReadonlySet<JevJobEmailLabel> = new Set(['recruiter_reply', 'offer', 'other']);

export function isJobEmailLabel(value: string): value is JevJobEmailLabel {
  return value === 'other' || (CLASSIFICATIONS as readonly string[]).includes(value);
}
