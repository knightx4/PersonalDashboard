import Link, { linkVariants } from '@/components/ui/link';
import { CalendarClock, Video } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatInterviewWhen } from '@/lib/jobs/applications/load';
import { INTERVIEW_HORIZON_DAYS, type TodayBoard } from '@/lib/jobs/today/load';
import { roundDetail, roundLabel, roundsOf } from '@/lib/jobs/interview-groups';
import { interviewKindLabel } from '@/lib/jobs/interview-kinds';

/**
 * The week itself, lifted out of the section so it can be photographed.
 *
 * ThisWeekSection takes the board and decides whether the week is clear; this
 * is the interviews coming up, one line a round. The debriefs, the mail
 * waiting on you and the nudges that were listed under them left Now in plan
 * #1937.9: the mail and the reminders are rows in the Jobs Inbox. The list's
 * heading is an h3, under the section's h2.
 * The preview gallery cannot import a page whose first line asks for a
 * signed-in user.
 */
export function TodayLists({ board, timezone }: { board: TodayBoard; timezone: string }) {
  /**
   * One line per round, not per interview.
   *
   * A superday is one occasion with four conversations in it, and listed four
   * times over it reads as four separate things to prepare for. The line names
   * the round and says what is in it; the role's own tab is where each
   * conversation is read.
   *
   * `board.interviews` is already in the order they run out, and `roundsOf`
   * keeps that order, so the round sits where its first interview sat.
   */
  const rounds = roundsOf(
    board.interviews,
    board.interviews
      .map((interview) => interview.round)
      .filter((round): round is NonNullable<typeof round> => round !== null)
      .map((round) => ({
        id: round.id,
        label: round.label,
        roundNumber: round.roundNumber,
        notes: round.notes,
      })),
  );

  return (
    <div className="space-y-6">
      {board.interviews.length > 0 && (
        <Section
          icon={CalendarClock}
          title="Interviews"
          hint={`In the next ${INTERVIEW_HORIZON_DAYS} days.`}
          tone="brand"
        >
          <ul className="divide-y divide-border">
            {rounds.map(({ group, interviews, lead }) => {
              // The first conversation is when the round starts, which is
              // what a week is read against. What else is in it is said in the
              // detail line rather than as four more rows.
              const joinable = interviews.find((interview) => interview.meetingUrl);
              const round = roundLabel(group);
              const detail = roundDetail(
                round,
                interviewKindLabel(lead.kind),
                interviews.length,
                lead.durationMinutes,
              );

              return (
                <li
                  key={group?.id ?? lead.id}
                  className="row-pad relative gap-x-3 gap-y-1 sm:flex sm:items-baseline"
                >
                  {/* The when in a column of its own, so every round's role
                      starts at the same edge and what is left wraps under it
                      rather than under the date. */}
                  <span className="tabular block text-ui font-medium text-ink sm:w-44 sm:shrink-0">
                    {formatInterviewWhen(lead.scheduledAt, lead.timeKnown, timezone)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/jobs/roles/${lead.roleId}?tab=interviews&interview=${lead.id}`}
                      className="press-area text-ui font-medium text-ink transition-colors duration-quick hover:text-accent"
                    >
                      {/* The whole row opens the same place -- prep materials on
                          the role's Interviews tab -- so this stretches to cover
                          it rather than being the one sliver of the row that
                          responds to a click. */}
                      <span className="absolute inset-0" aria-hidden />
                      {lead.companyName} · {lead.roleTitle}
                    </Link>
                    <span className="text-small text-ink-muted">{detail}</span>
                    {joinable?.meetingUrl && (
                      <a
                        href={joinable.meetingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(linkVariants(), 'press-area inline-flex items-center gap-1 text-small font-medium')}
                      >
                        <Video className="size-3.5" strokeWidth={1.75} aria-hidden />
                        Join
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  hint?: string;
  tone?: 'brand';
  children: React.ReactNode;
}) {
  return (
    <Card padding="dense">
      {/* The hint drops below the heading on a phone. On one row with it, a
          long hint took the width and broke "Waiting on you" across two lines
          in the middle of the phrase. */}
      <header className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <Icon
          className={tone === 'brand' ? 'size-4 text-accent' : 'size-4 text-ink-muted'}
          strokeWidth={1.75}
          aria-hidden
        />
        <h3 className="text-ui font-semibold text-ink">{title}</h3>
        {hint && <span className="w-full text-small text-ink-muted sm:w-auto">{hint}</span>}
      </header>
      {children}
    </Card>
  );
}
