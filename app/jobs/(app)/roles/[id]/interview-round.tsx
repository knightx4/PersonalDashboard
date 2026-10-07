'use client';

import { useState, useTransition } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import { EditableProse } from '@/components/ui/editable-prose';
import { RoundPrep } from './prep-note';
import {
  deleteInterviewRound,
  linkRoundMessage,
  saveInterviewGroup,
  unlinkRoundMessage,
} from './interview-actions';
import { InlineInput, Select } from '@/components/ui/field';
import { GmailLink, NoteKindButton, CollapsibleField } from './shared';
import { InterviewCard } from './interview-card';
import { AddInterview } from './add-interview';
import type { PanelProps } from './types';

/**
 * A round: the interviews in it unchanged, inside something that can hold an
 * opinion about the round as a whole.
 *
 * The interviews are not flattened or merged. Each keeps its hour, its
 * interviewers and its own notes, because that is what makes the round worth
 * having rather than one long entry -- what is added is the line above them
 * and the paragraph that belongs to none of them.
 *
 * A round holds anything from nothing to a superday. It can be made empty and
 * filled as invitations arrive, from the inbox or by hand, which is how a
 * round that was agreed before it was booked gets recorded at all.
 */
export function InterviewGroupCard({
  applicationId,
  group,
  interviews,
  schedulingMail,
  roleMail,
  timezone,
  companyContacts,
  focusInterviewId,
  closed = false,
}: {
  applicationId: string;
  group: PanelProps['interviewGroups'][number];
  interviews: PanelProps['interviews'];
  /** Scheduling mail on this pursuit, as a starting point for a new one. */
  schedulingMail: PanelProps['messages'];
  /** Every email linked to this pursuit, to say which ones this round is about. */
  roleMail: PanelProps['messages'];
  timezone: string;
  companyContacts: PanelProps['companyContacts'];
  focusInterviewId?: string | null;
  /** The application has closed: no asking for prep, no adding to the round. */
  closed?: boolean;
}) {
  const [label, setLabel] = useState(group.label ?? '');
  const [roundNumber, setRoundNumber] = useState(
    group.roundNumber === null ? '' : String(group.roundNumber),
  );
  const [notes, setNotes] = useState(group.notes);
  /** A round starts with no note on it, because that is the truth. */
  const [showNotes, setShowNotes] = useState(group.notes.trim() !== '');
  const [saved, setSaved] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  /**
   * The number and the name as last saved. Save the round shows only once
   * one of them has been changed from these: a save control on a round
   * nobody is editing offered to save nothing (law 14).
   */
  const [savedHeading, setSavedHeading] = useState({
    label: group.label ?? '',
    roundNumber: group.roundNumber === null ? '' : String(group.roundNumber),
  });
  const headingChanged =
    label !== savedHeading.label || roundNumber.trim() !== savedHeading.roundNumber.trim();
  /**
   * Open, until you fold it.
   *
   * A pursuit that has been running a while carries five or six rounds, and
   * all of them expanded is a page you scroll past rather than read. Folded
   * away, the header still says which round it is, what it is called and how
   * much is in it -- which is what you are scanning for when you fold one.
   *
   * Open by default all the same: a round you have just opened the tab to look
   * at should be showing, and the one thing anybody wants closed -- an empty
   * note -- is already closed on its own account.
   */
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();

  /**
   * Which conversation of the round carries the note.
   *
   * Whichever already has one, so a note written before a conversation was
   * added stays where it was written; otherwise the earliest scheduled, which
   * is the one the action writes against. Null only for a round with nothing
   * in it yet, which has nothing to prepare from either.
   */
  const prepCarrier =
    interviews.find((interview) => interview.prepNote !== null) ??
    interviews.find((interview) => interview.scheduledAt !== null) ??
    interviews[0];

  /**
   * The round's three fields go together, because they are edited together:
   * the number and the name sit side by side in the header and the note folds
   * out under them, and one Save for all of it is what the card looks like it
   * offers.
   *
   * A blank number is a round nobody has placed yet, not a zero.
   */
  const save = () =>
    startTransition(async () => {
      const trimmed = roundNumber.trim();
      const parsed = trimmed === '' ? null : Number(trimmed);
      if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 99)) {
        setSaved('Rounds are numbered 1 to 99.');
        return;
      }

      const result = await saveInterviewGroup(group.id, {
        label,
        notes,
        roundNumber: parsed,
      });
      setSaved(result.error ?? 'Saved.');
      if (!result.error) setSavedHeading({ label, roundNumber });
    });

  return (
    // A card, in the app's card, rather than a rectangle that happened to look
    // like one. The accent edge and wash stay: a round is the one container on
    // this tab that holds other cards, and the tint is what says which
    // interviews belong to which round without indenting them.
    <Card padding="dense" className="border-accent/40 bg-accent-tint/30">
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Fold this round away' : 'Open this round'}
          className="press flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-accent"
        >
          <ChevronDown
            className={cn('size-4 transition-transform duration-quick', !open && '-rotate-90')}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        <CalendarClock className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
        {/* The number is the round's, not the interviews'. Four conversations
            on one afternoon are all the second round; numbering each of them
            separately was what made a superday read as rounds 1, 3 and 4.

            It is the same heading open or folded. It used to become two
            bordered input boxes the moment the round was opened, so opening a
            round to read what was in it turned its title into a form you had
            not asked to fill in -- and a column of open rounds was a column of
            boxes (law 14).

            Open, the two parts are InlineInputs: set exactly like the heading
            they stand in for, picking up a ground on hover and a border on
            focus, so they are text until they are touched and the value and
            its editor are the same object in the same place (law 12). Folded,
            the round is something you are scanning past and nothing there is
            editable at all.

            On a phone the heading keeps room for "Round 2 · Technical" and
            the count wraps beneath it, rather than the count being drawn over
            the heading. */}
        <h3 className="flex min-w-48 flex-1 items-baseline gap-x-1.5 text-ui font-semibold text-ink">
          {open ? (
            <>
              <span className="text-ink-muted">Round</span>
              <InlineInput
                type="number"
                min={1}
                max={99}
                value={roundNumber}
                onChange={(event) => setRoundNumber(event.target.value)}
                aria-label="Which round of the process this is"
                placeholder="#"
                // Sized to the number rather than to a fixed box, or the
                // heading reads "Round 1      ·  First round" with a hole in
                // it where the empty half of the input is.
                className="field-sizing-content min-h-11 w-auto min-w-11 max-w-14 shrink-0 font-semibold sm:min-h-0 sm:min-w-6"
              />
              <span className="shrink-0 text-ink-ghost">·</span>
              <InlineInput
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                aria-label="What to call this round"
                placeholder="Technical round"
                className="field-sizing-content min-h-11 min-w-0 max-w-56 flex-1 font-semibold sm:min-h-0"
              />
            </>
          ) : (
            <>
              {roundNumber.trim() ? `Round ${roundNumber.trim()}` : 'Unplaced round'}
              {label.trim() && ` · ${label.trim()}`}
            </>
          )}
        </h3>
        <span className="text-small text-ink-muted">
          {interviews.length === 0
            ? 'Nothing booked in yet'
            : interviews.length === 1
              ? '1 interview'
              : `${interviews.length} interviews, together`}
        </span>
        {/* Only while it is empty: a round with conversations in it is
            removed by taking those out first, so nothing is swept away by a
            click on the wrong card. */}
        {interviews.length === 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!removing) {
                setRemoving(true);
                return;
              }
              startTransition(async () => {
                const result = await deleteInterviewRound(group.id);
                if (result.error) {
                  setSaved(result.error);
                  setRemoving(false);
                }
              });
            }}
            className="ml-auto text-small text-ink-muted underline underline-offset-2 hover:text-danger"
          >
            {removing ? 'Really remove it?' : 'Remove this round'}
          </button>
        )}
      </header>

      {!open ? null : (
        <>
          {/* No note until there is one, and foldable once there is -- the same
            way a round's own notes behave one level down. A textarea shown on
            every round whether or not anything had been written in it made an
            empty round take the space of a full one and read as filled in. */}
          <div className="mt-3 space-y-2">
            {showNotes && (
              // The same law one level up: the round's own note was a
              // permanently open textarea holding its value, under a heading,
              // over a Save button. It reads as writing now and opens where it
              // is read.
              <CollapsibleField label="Notes on this round" defaultOpen>
                <EditableProse
                  label="Notes on this round"
                  value={notes}
                  startEditing={notes.trim() === ''}
                  placeholder="How the round went as a whole. Each interview keeps its own notes below."
                  empty="Nothing written about the round as a whole."
                  onSave={async (next) => {
                    const result = await saveInterviewGroup(group.id, { notes: next });
                    if (result.error) return result.error;
                    setNotes(next);
                  }}
                />
              </CollapsibleField>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {!showNotes && (
                <NoteKindButton label="Note on this round" onClick={() => setShowNotes(true)} />
              )}
              {/* The number and the name are saved here whether or not the
                round has a note, and only once one of them has changed. */}
              {headingChanged && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={save}
                  className="text-small text-ink-muted underline underline-offset-2 hover:text-accent"
                >
                  Save the round
                </button>
              )}
              {saved && <span className="text-small text-ink-muted">{saved}</span>}
            </div>
          </div>

          <RoundMail groupId={group.id} messageIds={group.messageIds} roleMail={roleMail} />

          {/* One note for the occasion. It is stored on the round's earliest
            conversation, so the carrier is whichever of them has one and the
            lead otherwise -- which is where the action would write it. A round
            of one conversation shows it inside that conversation's Prep
            instead (plan #1594). */}
          {interviews.length > 1 && prepCarrier && (prepCarrier.prepNote || !closed) && (
            <RoundPrep
              interviewId={prepCarrier.id}
              state={{
                note: prepCarrier.prepNote,
                generatedAt: prepCarrier.prepNoteAt,
                stale: prepCarrier.prepNoteStale,
              }}
              timezone={timezone}
            />
          )}

          <div className="mt-3 space-y-3">
            {interviews.map((interview) => (
              <InterviewCard
                key={interview.id}
                interview={interview}
                timezone={timezone}
                companyContacts={companyContacts}
                focused={interview.id === focusInterviewId}
                grouped
                closed={closed}
                carriesRoundPrep={interviews.length === 1}
              />
            ))}

            {/* The round fills up from here: another conversation in the same
              round is one click, and an invitation that is already in the inbox
              starts from the message rather than from a blank form. */}
            {!closed && (
              <AddInterview
                applicationId={applicationId}
                groupId={group.id}
                mailOptions={schedulingMail}
                triggerLabel={
                  interviews.length === 0
                    ? 'Add an interview'
                    : 'Add another interview to this round'
                }
              />
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The emails this round is about, addable at any point in its life.
 *
 * "Add from email" used to live only on the form that makes an interview, and
 * even there it only copied the kind across — so once a round existed there was
 * no way to say which invitation it came out of, and nothing was written down
 * when there had been. Both halves are fixed here: the list is on the round
 * itself, and each pick is a row rather than a prefilled field.
 *
 * Several are expected. The invite, the reschedule and the panel list are three
 * messages about one round, and all three are worth having on it.
 */
function RoundMail({
  groupId,
  messageIds,
  roleMail,
}: {
  groupId: string;
  messageIds: string[];
  roleMail: PanelProps['messages'];
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const attached = new Set(messageIds);
  const linked = roleMail.filter((message) => attached.has(message.id));
  const available = roleMail.filter((message) => !attached.has(message.id));

  return (
    <div className="mt-3">
      {/* The heading and the way to add one share a line, and a round with no
          mail on it says so by having nothing under that line.
          It used to be three: the heading, then "None named yet.", then "Add
          an email" -- three lines to report an absence, on a tab where a round
          with one phone screen in it already runs past the fold. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
          Emails about this round
        </h4>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-small text-ink-muted underline underline-offset-2 hover:text-accent"
          >
            Add an email
          </button>
        )}
      </div>

      {linked.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {linked.map((message) => (
            <li key={message.id} className="flex items-baseline gap-2 text-small">
              {message.gmailHref ? (
                <GmailLink href={message.gmailHref}>{message.subject ?? '(no subject)'}</GmailLink>
              ) : (
                <span className="text-ink">{message.subject ?? '(no subject)'}</span>
              )}
              <button
                type="button"
                disabled={pending}
                aria-label={`Take ${message.subject ?? 'this email'} off this round`}
                onClick={() =>
                  startTransition(async () => {
                    const result = await unlinkRoundMessage({ groupId, messageId: message.id });
                    setError(result.error);
                  })
                }
                className="text-ink-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding &&
        (available.length > 0 ? (
          <Select
            aria-label="Add an email to this round"
            defaultValue=""
            disabled={pending}
            className="mt-1.5 h-7 w-full max-w-96 py-0 text-small"
            onChange={(event) => {
              const messageId = event.target.value;
              if (!messageId) return;
              startTransition(async () => {
                const result = await linkRoundMessage({ groupId, messageId });
                setError(result.error);
                if (!result.error) setAdding(false);
              });
            }}
          >
            <option value="">Pick a linked email…</option>
            {available.map((message) => (
              <option key={message.id} value={message.id}>
                {message.subject ?? '(no subject)'}
              </option>
            ))}
          </Select>
        ) : (
          // Only mail already linked to this pursuit is offered: a round names
          // which of the role's emails it is about, it does not go fishing in
          // the mailbox. Anything missing is linked under Linked mail first.
          <p className="mt-1.5 text-small text-ink-muted">
            {roleMail.length === 0
              ? 'No mail is linked to this pursuit yet.'
              : 'Every linked email is already on this round.'}
          </p>
        ))}

      {error && <p className="mt-1 text-small text-danger">{error}</p>}
    </div>
  );
}
