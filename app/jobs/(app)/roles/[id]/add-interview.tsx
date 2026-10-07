'use client';

import { useId, useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { AddTrigger } from '@/components/ui/add-trigger';
import { addInterview } from './interview-actions';
import { INTERVIEW_KIND_LABEL, INTERVIEW_KINDS } from '@/lib/jobs/interview-kinds';
import { Input, Label, Select } from '@/components/ui/field';
import { scheduleFromFields, type InterviewSeed } from './shared';
import type { PanelProps } from './types';

/**
 * The other half of "I don't know why it says 2 separate rounds": the inbox
 * sometimes reads one scheduling back-and-forth as two, and the fix used to
 * require filing a bug. Now it's the button above. This is its mirror --
 * adding a round the inbox never saw at all, a phone screen nobody emailed
 * about.
 */
export function AddInterview({
  applicationId,
  groupId = null,
  mailOptions = [],
  triggerLabel = 'Add an interview',
  seed,
  onSeedUsed,
}: {
  applicationId: string;
  /** The round this goes in. Null means a new round holding just this one. */
  groupId?: string | null;
  /** Scheduling mail on this pursuit, offered as a starting point. */
  mailOptions?: PanelProps['messages'];
  triggerLabel?: string;
  /** Set when the round is being added from a specific email. */
  seed?: InterviewSeed | null;
  onSeedUsed?: () => void;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('recruiter_screen');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [usedSeed, setUsedSeed] = useState<InterviewSeed | null>(null);
  /** A message picked from the list below, as opposed to one passed in. */
  const [fromMail, setFromMail] = useState<InterviewSeed | null>(null);
  const startedFrom = usedSeed ?? fromMail;

  // Arriving from a message in Linked mail: open already filled in. The time
  // is deliberately not guessed from the mail -- the mail's arrival is not the
  // appointment, and a wrong hour on the board is worse than an empty field.
  if (seed && seed !== usedSeed) {
    setUsedSeed(seed);
    setKind(seed.kind);
    setError(null);
    setOpen(true);
  }

  const close = () => {
    setOpen(false);
    setUsedSeed(null);
    setFromMail(null);
    onSeedUsed?.();
  };

  if (!open) {
    // Inside a round, a plain add line: the round's card is already the frame
    // (law 11). On its own it is the dashed card that starts a new round.
    if (groupId) {
      return <AddTrigger label={triggerLabel} onClick={() => setOpen(true)} />;
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          cardVariants(),
          'press w-full border-dashed py-2.5 text-center text-ui text-ink-muted hover:border-accent hover:text-accent',
        )}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <section
      className={groupId ? 'border-t border-border pt-3' : cardVariants({ padding: 'dense' })}
    >
      {startedFrom ? (
        <p className="mb-3 text-small text-ink-muted">
          From <span className="text-ink">{startedFrom.fromSubject ?? 'the linked message'}</span> —
          that mail says when it is; put the time in below.
        </p>
      ) : (
        // Add from email, in the round rather than off in the mail tab: the
        // subject is the whole reason you remember which conversation this is.
        //
        // A dropdown rather than the subjects laid out in a row. Subject lines
        // are long and there are as many of them as the pursuit has scheduling
        // mail, so spread out they wrapped over several lines and pushed the
        // form itself out of sight -- and read as a paragraph of links rather
        // than as a list of one thing to choose.
        mailOptions.length > 0 && (
          <div className="mb-3">
            <Label htmlFor={`${fieldId}-mail`}>Add from email</Label>
            <Select
              id={`${fieldId}-mail`}
              defaultValue=""
              className="w-full max-w-96"
              onChange={(event) => {
                const message = mailOptions.find((option) => option.id === event.target.value);
                if (!message) return;
                setFromMail({ kind: 'recruiter_screen', fromSubject: message.subject });
                setError(null);
              }}
            >
              <option value="">Start from a scheduling email…</option>
              {mailOptions.map((message) => (
                <option key={message.id} value={message.id}>
                  {message.subject ?? '(no subject)'}
                </option>
              ))}
            </Select>
          </div>
        )
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`${fieldId}-kind`}>Kind</Label>
          <Select
            id={`${fieldId}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="w-48"
          >
            {INTERVIEW_KINDS.map((option) => (
              <option key={option} value={option}>
                {INTERVIEW_KIND_LABEL[option]}
              </option>
            ))}
          </Select>
        </div>
        {/* Date and time as two fields rather than one datetime-local,
            because the second is often not settled when the first is: an
            onsite is agreed for the 15th days before anyone says at what
            hour, and both empty is its own real answer — "they said yes,
            dates to follow". The hour can be filled in from the heading
            later. */}
        <div>
          <Label htmlFor={`${fieldId}-date`}>Date</Label>
          <Input
            id={`${fieldId}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${fieldId}-time`}>Time</Label>
          <Input
            id={`${fieldId}-time`}
            type="time"
            value={time}
            disabled={!date}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await addInterview({
                applicationId,
                kind,
                groupId,
                ...scheduleFromFields(date, time),
              });
              if (result.error) {
                setError(result.error);
              } else {
                setDate('');
                setTime('');
                close();
              }
            })
          }
        >
          {groupId ? 'Add it to this round' : 'Add it in a round of its own'}
        </Button>
        <button type="button" onClick={close} className="text-small text-ink-muted hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-small text-danger">{error}</span>}
      </div>
    </section>
  );
}
