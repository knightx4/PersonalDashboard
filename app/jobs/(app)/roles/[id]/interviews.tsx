'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { formatDate } from '@/lib/jobs/applications/load';
import { createInterviewRound, groupInterviews } from './interview-actions';
import { groupableDays, sectionInterviews } from '@/lib/jobs/interview-groups';
import { INTERVIEW_MAIL, type InterviewSeed } from './shared';
import { InterviewGroupCard } from './interview-round';
import { InterviewCard } from './interview-card';
import { AddInterview } from './add-interview';
import type { PanelProps } from './types';

export function Interviews({
  interviews,
  interviewGroups,
  applicationId,
  timezone,
  focusInterviewId,
  messages,
  companyContacts,
  seed,
  onSeedUsed,
}: PanelProps & { seed?: InterviewSeed | null; onSeedUsed?: () => void }) {
  // Mail that says an interview exists while this tab says none does. The
  // combination is always a miss -- a hand-link that recorded only the event,
  // or a thread the extractor read without finding a date -- so it is stated
  // rather than left as a blank the tab count already implied was correct.
  const interviewMail =
    interviews.length === 0
      ? messages.filter((message) => INTERVIEW_MAIL.has(message.classification))
      : [];

  // Scheduling mail on this pursuit, offered inside a round as the other way
  // to fill it: "add from email" rather than retyping what the invite says.
  const schedulingMail = messages.filter((message) => INTERVIEW_MAIL.has(message.classification));

  // One past the highest round the pursuit has, which is what the next round
  // to be agreed almost always is. A round with no number yet counts for
  // nothing here rather than resetting the sequence.
  const nextRoundNumber =
    interviewGroups.reduce((top, group) => Math.max(top, group.roundNumber ?? 0), 0) + 1;

  return (
    <div className="space-y-3">
      {interviews.length === 0 && interviewGroups.length === 0 ? (
        <div
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-10 text-center text-ui text-ink-muted',
          )}
        >
          {interviewMail.length > 0 ? (
            <>
              <p className="text-ink">
                {interviewMail.length === 1
                  ? 'An email about scheduling is linked to this pursuit, but no interview is recorded.'
                  : `${interviewMail.length} emails about scheduling are linked to this pursuit, but no interview is recorded.`}
              </p>
              <p className="mt-1">
                The mail only ever carries a booking when it arrives with a calendar invite. Add the
                round below, or from the message itself under Linked mail.
              </p>
            </>
          ) : (
            <p>
              No interviews yet. They appear here when a scheduling email arrives, or you can add
              one below.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Rounds that sit on one day and are not yet an occasion. Offered
              rather than done for them: two screens on the same Tuesday for
              two different reasons are not a superday, and only the reader
              knows which this is. */}
          {groupableDays(interviews, timezone).map(({ day, interviewIds }) => (
            <GroupTheseRounds
              key={day}
              applicationId={applicationId}
              day={day}
              interviewIds={interviewIds}
            />
          ))}

          {sectionInterviews(interviews, interviewGroups).map((section) =>
            section.kind === 'group' ? (
              <InterviewGroupCard
                key={section.group.id}
                applicationId={applicationId}
                group={section.group}
                interviews={section.interviews}
                schedulingMail={schedulingMail}
                roleMail={messages}
                timezone={timezone}
                companyContacts={companyContacts}
                focusInterviewId={focusInterviewId}
              />
            ) : (
              <InterviewCard
                key={section.interview.id}
                interview={section.interview}
                timezone={timezone}
                companyContacts={companyContacts}
                focused={section.interview.id === focusInterviewId}
              />
            ),
          )}
        </>
      )}
      {/* Two ways in, because both happen. A round is usually agreed before
          anything in it is booked, so it is made empty and filled as the
          invitations arrive; a single conversation nobody framed as a round
          gets one made around it, because an interview is always in a round. */}
      <AddRound applicationId={applicationId} nextRound={nextRoundNumber} />
      <AddInterview
        applicationId={applicationId}
        triggerLabel="Add an interview in a round of its own"
        seed={seed}
        onSeedUsed={onSeedUsed}
      />
    </div>
  );
}

/**
 * The round itself, before anything is in it.
 *
 * "There will be a technical round, we will send times" is the state a
 * pursuit is in most often, and it had nowhere to be recorded: rounds could
 * only be made out of interviews that already existed, which meant waiting for
 * the mail before the thing everyone had already agreed to could be written
 * down.
 */
function AddRound({ applicationId, nextRound }: { applicationId: string; nextRound: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createInterviewRound({
              applicationId,
              roundNumber: nextRound,
            });
            setError(result.error);
          })
        }
        // The empty slot at the end of the rounds, drawn in the card's own
        // classes with the border dashed -- the same spelling AddInterview
        // below already used for the identical affordance. It was hand-written
        // here, which is how two buttons doing one job ended up with two
        // radii and two edges.
        className={cn(
          cardVariants(),
          'press w-full border-dashed py-2.5 text-center text-ui text-ink-muted hover:border-accent hover:text-accent',
        )}
      >
        {pending ? 'Adding…' : 'Add a round'}
      </button>
      {error && <p className="mt-1 text-small text-danger">{error}</p>}
    </div>
  );
}

/**
 * The offer to read several rounds on one day as one occasion.
 *
 * A one-click action rather than a picker: the set is already known -- it is
 * every ungrouped round on that date -- and anything else can be taken back
 * out of the group afterwards.
 */
function GroupTheseRounds({
  applicationId,
  day,
  interviewIds,
}: {
  applicationId: string;
  day: string;
  interviewIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // `day` is already the date in the reader's zone, so it is formatted as
  // written rather than converted again -- which past ±12 would move it.
  const label = formatDate(`${day}T00:00:00.000Z`, 'UTC');

  return (
    <div
      className={cn(cardVariants(), 'flex flex-wrap items-center gap-3 border-dashed px-4 py-2.5')}
    >
      <p className="text-ui text-ink-muted">
        {interviewIds.length} interviews on {label}, in separate rounds.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await groupInterviews({ applicationId, interviewIds, label });
            setError(result.error);
          })
        }
      >
        Make them one round
      </Button>
      {error && <span className="text-small text-danger">{error}</span>}
    </div>
  );
}
