import Link from 'next/link';
import { CalendarClock, Clock, MailQuestion, PenLine, Video } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDateTime, formatInterviewWhen } from '@/lib/jobs/applications/load';
import { INTERVIEW_HORIZON_DAYS, type TodayBoard } from '@/lib/jobs/today/load';
import { roundDetail, roundLabel, roundsOf } from '@/lib/jobs/interview-groups';
import { interviewKindLabel } from '@/lib/jobs/interview-kinds';
import { ReminderActions } from './reminder-actions';
import { WaitingActions } from './waiting-actions';

/**
 * The week itself, lifted out of the page so it can be photographed.
 *
 * The page still loads the board and decides whether the week is clear; this
 * is the three lists, unchanged on the way out. The preview gallery cannot
 * import a page whose first line asks for a signed-in user.
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
              //
              // A round with no prep anywhere in it is the one worth
              // flagging: notes on one of four conversations still means
              // somebody has looked at the day.
              const hasPrep = interviews.some((interview) => interview.hasPrep);
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
                  className="row-pad relative flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <span className="tabular w-full text-ui font-medium text-ink sm:w-44">
                    {formatInterviewWhen(lead.scheduledAt, lead.timeKnown, timezone)}
                  </span>
                  <Link
                    href={`/jobs/roles/${lead.roleId}?tab=interviews&interview=${lead.id}`}
                    className="text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
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
                      className="relative inline-flex items-center gap-1 text-small font-medium text-accent underline underline-offset-2"
                    >
                      <Video className="size-3.5" strokeWidth={1.75} aria-hidden />
                      Join
                    </a>
                  )}
                  {!hasPrep && (
                    <span className="rounded-full bg-caution-tint px-1.5 py-0.5 text-micro text-ink">
                      no prep notes
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {board.waiting.length > 0 && (
        <Section
          icon={MailQuestion}
          title="Waiting on you"
          hint="Mail that asked for something and has not been answered."
        >
          <ul className="divide-y divide-border">
            {board.waiting.map((row) => (
              <li key={row.eventId} className="row-pad flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tabular w-full text-small text-ink-muted sm:w-44">
                  {formatDateTime(row.occurredAt, timezone)}
                </span>
                <Link
                  href={`/jobs/roles/${row.roleId}`}
                  className="text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
                >
                  {row.companyName} · {row.roleTitle}
                </Link>
                {row.summary && (
                  <span className="w-full text-small text-ink-muted sm:w-auto sm:flex-1">
                    {row.summary}
                  </span>
                )}
                <WaitingActions eventId={row.eventId} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {board.reminders.length > 0 && (
        <Section icon={Clock} title="Nudges" hint="Raised by the nightly sweep.">
          <ul className="divide-y divide-border">
            {board.reminders.map((reminder) => (
              <li key={reminder.id} className="row-pad flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {reminder.roleId ? (
                  <Link
                    href={`/jobs/roles/${reminder.roleId}`}
                    className="text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
                  >
                    {reminder.companyName} · {reminder.roleTitle}
                  </Link>
                ) : (
                  <span className="text-ui font-medium text-ink">Reminder</span>
                )}
                <span className="w-full text-small text-ink-muted sm:w-auto sm:flex-1">
                  {reminder.body}
                </span>
                {reminder.followUpHref && <DraftLink href={reminder.followUpHref} />}
                <ReminderActions id={reminder.id} />
              </li>
            ))}
          </ul>
        </Section>
      )}

    </div>
  );
}

/**
 * Opens Gmail's own composer with the follow-up already written.
 *
 * Not a draft written through the API: that needs `gmail.compose` on top of
 * the read-only grant this app asks for, and a reconnect to get it. A wider
 * key to the mailbox is a poor trade for saving one click.
 */
function DraftLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
    >
      <PenLine className="size-3.5" strokeWidth={1.75} aria-hidden />
      Draft follow-up
    </a>
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
  hint: string;
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
        <h2 className="text-ui font-semibold text-ink">{title}</h2>
        <span className="w-full text-small text-ink-muted sm:w-auto">{hint}</span>
      </header>
      {children}
    </Card>
  );
}
