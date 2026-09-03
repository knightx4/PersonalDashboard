/**
 * What kind of round an interview is, and what to call it on screen.
 *
 * Its own module because three places need the same list — the extractor that
 * guesses a kind from mail, the form that adds a round by hand, and the card
 * that lets a wrong guess be corrected — and a 'use server' file cannot export
 * a constant for them to share.
 */
export const INTERVIEW_KINDS = [
  'recruiter_screen',
  'hiring_manager',
  'technical',
  'case',
  'panel',
  'onsite',
  'final',
  'informal',
] as const;

export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const INTERVIEW_KIND_LABEL: Record<InterviewKind, string> = {
  recruiter_screen: 'Recruiter screen',
  hiring_manager: 'Hiring manager',
  technical: 'Technical',
  case: 'Case study',
  panel: 'Panel',
  onsite: 'Onsite',
  final: 'Final',
  informal: 'Informal',
};

/** A kind read back from the database, which may predate this list. */
export function interviewKindLabel(kind: string): string {
  return (
    INTERVIEW_KIND_LABEL[kind as InterviewKind] ??
    kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}
