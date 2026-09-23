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

type KindedInterview = { kind: string; scheduledAt: string | null };

function latest(interviews: readonly KindedInterview[]): KindedInterview | null {
  return interviews.reduce<KindedInterview | null>((top, interview) => {
    if (!top) return interview;
    // An unscheduled interview sorts after a scheduled one: it is the newer plan.
    if (interview.scheduledAt === null) return interview;
    if (top.scheduledAt === null) return top;
    return interview.scheduledAt > top.scheduledAt ? interview : top;
  }, null);
}

/**
 * The kind a new interview's form starts on.
 *
 * Inside a round that already has interviews, the round's latest kind: the
 * conversations in one round are almost always the same sort. Otherwise, the
 * step after the pursuit's latest interview, because nobody does the recruiter
 * screen twice. Informal sits outside that ladder, and final is where it stops.
 * It is a starting value in a visible select, so a wrong guess is one change.
 */
export function startingInterviewKind(
  round: readonly KindedInterview[],
  pursuit: readonly KindedInterview[],
): InterviewKind {
  const inRound = latest(round);
  if (inRound && (INTERVIEW_KINDS as readonly string[]).includes(inRound.kind)) {
    return inRound.kind as InterviewKind;
  }
  const ladder = INTERVIEW_KINDS.filter((kind) => kind !== 'informal');
  const before = latest(pursuit.filter((interview) => interview.kind !== 'informal'));
  if (!before) return 'recruiter_screen';
  const at = ladder.indexOf(before.kind as (typeof ladder)[number]);
  if (at === -1) return 'recruiter_screen';
  return ladder[Math.min(at + 1, ladder.length - 1)];
}
