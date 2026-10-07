'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { CalendarDays, Video } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EditableProse } from '@/components/ui/editable-prose';
import { FoldingMarkdown } from '@/components/ui/folding-markdown';
import { Textarea, Input, Label, Select } from '@/components/ui/field';
import { formatDate, formatInterviewWhen } from '@/lib/jobs/applications/load';
import { RoundPrep } from './prep-note';
import {
  addInterviewer,
  addInterviewerByName,
  deleteInterview,
  removeInterviewer,
  saveInterview,
  ungroupInterview,
} from './interview-actions';
import { addNote } from './actions';
import {
  INTERVIEW_KIND_LABEL,
  INTERVIEW_KINDS,
  interviewKindLabel,
} from '@/lib/jobs/interview-kinds';
import { CollapsibleField, fieldsFromSchedule, NoteKindButton, scheduleFromFields } from './shared';
import type { PanelProps } from './types';

export function InterviewCard({
  interview,
  timezone,
  companyContacts,
  focused = false,
  grouped = false,
}: {
  focused?: boolean;
  /** Rendered inside a group card, which supplies the surround. */
  grouped?: boolean;
  interview: PanelProps['interviews'][number];
  timezone: string;
  companyContacts: PanelProps['companyContacts'];
}) {
  const [prep, setPrep] = useState(interview.prepNotes);
  const [notes, setNotes] = useState(interview.notes);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLElement>(null);

  /**
   * A round starts with no notes on it, because that is the truth.
   *
   * Two empty boxes headed Prep and Interview notes were shown on every round
   * whether or not anything had been written in either, so a card with nothing
   * to say still took the space of one with plenty and the section read as
   * filled in. A note appears when it exists or when you ask for it.
   */
  const [showPrep, setShowPrep] = useState(interview.prepNotes.trim() !== '');
  const [showDebrief, setShowDebrief] = useState(interview.notes.trim() !== '');
  /** The custom note being written, or null when none is. */
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const needsDebrief = interview.debriefDue && !notes;
  const empty = !showPrep && !showDebrief && draft === null && interview.customNotes.length === 0;

  // Arriving from This week's "click the interview, land on its prep" link:
  // the tab is already switched to Interviews, so what is left is finding
  // the one round among several this role might have.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focused]);

  return (
    <section
      ref={ref}
      className={cn(
        // Inside a round the round's card is the frame, so the interview is
        // marked off by a rule and space rather than a second card (law 11).
        grouped ? 'border-t border-border pt-3' : cardVariants({ padding: 'dense' }),
        focused && 'rounded-control ring-2 ring-accent ring-offset-2 ring-offset-canvas',
      )}
    >
      <InterviewHeading
        interviewId={interview.id}
        kind={interview.kind}
        when={formatInterviewWhen(interview.scheduledAt, interview.timeKnown, timezone)}
        scheduledAt={interview.scheduledAt}
        timeKnown={interview.timeKnown}
      />

      {/* The call and the calendar event, from the invite (note 7b1975cb). */}
      {(interview.meetingUrl || interview.calendarHref) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
          {interview.meetingUrl && (
            <a
              href={interview.meetingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="press-area inline-flex items-center gap-1 text-accent underline underline-offset-2"
            >
              <Video className="size-3.5" strokeWidth={1.75} aria-hidden />
              Join the call
            </a>
          )}
          {interview.calendarHref && (
            <a
              href={interview.calendarHref}
              target="_blank"
              rel="noreferrer noopener"
              className="press-area inline-flex items-center gap-1 text-accent underline underline-offset-2"
            >
              <CalendarDays className="size-3.5" strokeWidth={1.75} aria-hidden />
              Open in Calendar
            </a>
          )}
        </p>
      )}

      <Interviewers interview={interview} companyContacts={companyContacts} />

      {/* A round of one conversation carries its own note. Inside a group the
          round card holds it instead, so a superday reads one note about the
          day rather than four about its quarters. */}
      {!grouped && (
        <RoundPrep
          interviewId={interview.id}
          state={{
            note: interview.prepNote,
            generatedAt: interview.prepNoteAt,
            stale: interview.prepNoteStale,
          }}
          timezone={timezone}
        />
      )}

      {needsDebrief && (
        <p className="mt-2 rounded bg-caution-tint px-2 py-1.5 text-small text-ink">
          Write the debrief tonight. One written three days later is worth very little.{' '}
          {!showDebrief && (
            <button
              type="button"
              onClick={() => setShowDebrief(true)}
              className="font-medium underline underline-offset-2"
            >
              Start it
            </button>
          )}
        </p>
      )}

      {/* One notes section per round, holding whatever has actually been
          written: the prep, the debrief, and any number of loose notes.

          The heading is only drawn over something (law 1). "Notes" above the
          words "Nothing written for this round yet" was a heading and a
          sentence restating it, on the rounds that had least to say -- which is
          most of them. With nothing written, the buttons below are the whole
          of it, and they say what they make. */}
      <div className="mt-3">
        {!empty && (
          <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Notes
          </h4>
        )}

        {!empty && (
          <div className="mt-1 space-y-3">
            {/* Read as writing, edited in place (laws 12 and 14). These were
                two permanently open textareas holding their own values, with a
                Save button under the pair -- so a round you had written up
                showed you an editor rather than the write-up, and four rounds
                on a superday were eight boxes. `EditableProse` is the shape the
                rest of the app already uses for a paragraph, and it saves
                itself, which is what retires the Save button below. */}
            {showPrep && (
              <CollapsibleField label="Prep" defaultOpen>
                <EditableProse
                  label="Prep for this round"
                  markdown
                  expandable
                  value={prep}
                  startEditing={prep.trim() === ''}
                  placeholder="What to go in knowing, and what to ask."
                  empty="Nothing prepped yet."
                  onSave={async (next) => {
                    const result = await saveInterview(interview.id, { prepNotes: next });
                    if (result.error) return result.error;
                    setPrep(next);
                  }}
                />
              </CollapsibleField>
            )}
            {showDebrief && (
              <CollapsibleField label="Interview notes" defaultOpen>
                <EditableProse
                  label="Notes on this interview"
                  markdown
                  expandable
                  value={notes}
                  startEditing={notes.trim() === ''}
                  placeholder="How it went, who was in it, what they pressed on."
                  empty="No debrief written."
                  onSave={async (next) => {
                    const result = await saveInterview(interview.id, { notes: next });
                    if (result.error) return result.error;
                    setNotes(next);
                  }}
                />
              </CollapsibleField>
            )}
            {interview.customNotes.map((note) => (
              <article key={note.id} className="rounded-lg bg-sunken px-3 py-2">
                <FoldingMarkdown markdown={note.body} className="text-ui text-ink" />
                <p className="tabular mt-1 text-small text-ink-muted">
                  {formatDate(note.createdAt, timezone)}
                </p>
              </article>
            ))}
            {draft !== null && (
              <div>
                <Textarea
                  rows={3}
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Anything worth remembering about this round."
                />
                <div className="mt-1.5 flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending || !draft.trim()}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await addNote({
                          interviewId: interview.id,
                          body: draft,
                        });
                        setDraftError(result.error);
                        if (!result.error) setDraft(null);
                      })
                    }
                  >
                    Add note
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setDraftError(null);
                    }}
                    className="text-small text-ink-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                  {draftError && <span className="text-small text-danger">{draftError}</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Prep and the debrief are one each -- they are fields on the round,
            not a list -- so each offers itself only while it is not already
            there. A custom note has no such limit. */}
        {/* No caption over them. "Create note" above three triggers reading
            Prep, Interview and Custom is the heading explained underneath
            itself (law 15) -- it is read once and skipped forever, and the
            triggers already say what they make. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {!showPrep && <NoteKindButton label="Prep" onClick={() => setShowPrep(true)} />}
          {!showDebrief && (
            <NoteKindButton label="Interview" onClick={() => setShowDebrief(true)} />
          )}
          {draft === null && <NoteKindButton label="Custom" onClick={() => setDraft('')} />}
        </div>
      </div>

      {interview.questionsAsked.length > 0 && (
        <div className="mt-3">
          <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Questions they asked
          </h4>
          <ul className="mt-1 space-y-0.5 text-ui text-ink-muted">
            {interview.questionsAsked.map((question, index) => (
              <li key={index}>· {question}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Wrapping, because at 390px this row does not fit and without it the
          links broke mid-phrase instead: "Move it to its own / round" and "Not
          a real round — remove / it", each centred over two lines. A row that
          wraps puts each of them on a line whole. */}
      {/* No Save button. Every note on this round now saves itself -- the prep
          and the debrief through their own editors, a custom note when it is
          added -- so the one at the bottom of the card was a button for a form
          that is no longer here. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {grouped && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => void ungroupInterview(interview.id))}
            className="text-small text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Move it to its own round
          </button>
        )}
        <span className="ml-auto">
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-small text-ink-muted">Delete this round?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void deleteInterview(interview.id))}
                className="press text-small font-medium text-danger"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-small text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-small text-ink-muted underline underline-offset-2 hover:text-danger"
            >
              Not a real round — remove it
            </button>
          )}
        </span>
      </div>
    </section>
  );
}

function InterviewHeading({
  interviewId,
  kind,
  when,
  scheduledAt,
  timeKnown,
}: {
  interviewId: string;
  kind: string;
  when: string;
  scheduledAt: string | null;
  timeKnown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftKind, setDraftKind] = useState(kind);
  const [draftDate, setDraftDate] = useState(fieldsFromSchedule(scheduledAt, timeKnown).date);
  const [draftTime, setDraftTime] = useState(fieldsFromSchedule(scheduledAt, timeKnown).time);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        {/* No round number here. The interview is one conversation inside a
            round, and the round above it is what carries the number. */}
        <h3 className="text-ui font-semibold text-ink">
          {interviewKindLabel(kind)}
          <button
            type="button"
            onClick={() => {
              setDraftKind(kind);
              const fields = fieldsFromSchedule(scheduledAt, timeKnown);
              setDraftDate(fields.date);
              setDraftTime(fields.time);
              setError(null);
              setEditing(true);
            }}
            className="ml-2 align-middle text-small font-normal text-ink-muted underline underline-offset-2 hover:text-accent"
          >
            Edit
          </button>
        </h3>
        <span className={cn('tabular text-small', scheduledAt ? 'text-ink-muted' : 'text-caution')}>
          {when}
        </span>
      </header>
    );
  }

  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`kind-${interviewId}`}>Kind</Label>
          <Select
            id={`kind-${interviewId}`}
            value={draftKind}
            onChange={(event) => setDraftKind(event.target.value)}
            className="w-48"
          >
            {INTERVIEW_KINDS.map((option) => (
              <option key={option} value={option}>
                {INTERVIEW_KIND_LABEL[option]}
              </option>
            ))}
          </Select>
        </div>
        {/* A round can be added before anyone has said when it is, so this is
            where the date arrives once it exists — and where a day agreed
            without an hour gets its hour. */}
        <div>
          <Label htmlFor={`date-${interviewId}`}>Date</Label>
          <Input
            id={`date-${interviewId}`}
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`time-${interviewId}`}>Time</Label>
          <Input
            id={`time-${interviewId}`}
            type="time"
            value={draftTime}
            disabled={!draftDate}
            onChange={(event) => setDraftTime(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await saveInterview(interviewId, {
                kind: draftKind,
                ...scheduleFromFields(draftDate, draftTime),
              });
              if (result.error) setError(result.error);
              else setEditing(false);
            })
          }
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-small text-danger">{error}</p>}
    </header>
  );
}

/**
 * Who is in the room, as people rather than as text.
 *
 * A calendar invite has been recording its attendees as contacts since the
 * invite parser landed; the round just never showed them. Each name is the
 * contact record, so it opens on their title, their LinkedIn and every touch
 * you have had with them — which is the whole reason for storing a person
 * rather than a string.
 */
function Interviewers({
  interview,
  companyContacts,
}: {
  interview: PanelProps['interviews'][number];
  companyContacts: PanelProps['companyContacts'];
}) {
  const [adding, setAdding] = useState(false);
  /** The name being typed for somebody not on file yet, or null when none is. */
  const [newName, setNewName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const named = new Set(interview.participants.map((participant) => participant.contactId));
  const available = companyContacts.filter((contact) => !named.has(contact.id));

  const add = (contactId: string) =>
    startTransition(async () => {
      const result = await addInterviewer({ interviewId: interview.id, contactId });
      setError(result.error);
      if (!result.error) setAdding(false);
    });

  const addByName = () =>
    startTransition(async () => {
      const result = await addInterviewerByName({
        interviewId: interview.id,
        name: newName ?? '',
      });
      setError(result.error);
      if (!result.error) {
        setNewName(null);
        setAdding(false);
      }
    });

  /**
   * The name field, offered from inside the picker and instead of it when the
   * company has nobody on file.
   *
   * An interviewer has by definition never emailed you, so they are exactly
   * the people the contact list does not have yet -- which made "pick a
   * contact" a dead end at the moment it mattered most. The person is created
   * on this company, so the name on the round is a record with a page rather
   * than a string.
   */
  const nameField = (
    <span className="inline-flex items-center gap-1.5">
      <Input
        value={newName ?? ''}
        autoFocus
        placeholder="Their name"
        aria-label="Name of the person to add"
        className="h-7 w-48 py-0 text-small"
        onChange={(event) => setNewName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && newName?.trim()) {
            event.preventDefault();
            addByName();
          }
        }}
      />
      <Button type="button" size="sm" disabled={pending || !newName?.trim()} onClick={addByName}>
        Add
      </Button>
      <button
        type="button"
        onClick={() => {
          setNewName(null);
          setError(null);
        }}
        className="text-small text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </span>
  );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
      <span className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
        Interviewers
      </span>

      {interview.participants.length === 0 && !adding && (
        <span className="text-ink-muted">Nobody named yet</span>
      )}

      {interview.participants.map((participant) => (
        <span
          key={participant.contactId}
          className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5"
        >
          <Link
            href={`/jobs/contacts/${participant.contactId}`}
            className="text-ink underline underline-offset-2 hover:text-accent"
            title={participant.title ?? undefined}
          >
            {participant.name}
          </Link>
          {participant.role !== 'interviewer' && (
            <span className="text-ink-muted">{participant.role}</span>
          )}
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove ${participant.name}`}
            onClick={() =>
              startTransition(
                () =>
                  void removeInterviewer({
                    interviewId: interview.id,
                    contactId: participant.contactId,
                  }),
              )
            }
            className="text-ink-muted hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        newName !== null || available.length === 0 ? (
          nameField
        ) : (
          <Select
            aria-label="Add an interviewer"
            defaultValue=""
            disabled={pending}
            className="h-7 w-56 py-0 text-small"
            onChange={(event) => {
              if (event.target.value === NEW_CONTACT) {
                setNewName('');
                setError(null);
                return;
              }
              if (event.target.value) add(event.target.value);
            }}
          >
            <option value="">Pick a contact…</option>
            {available.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.title ? `${contact.name} — ${contact.title}` : contact.name}
              </option>
            ))}
            <option value={NEW_CONTACT}>+ Someone new…</option>
          </Select>
        )
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-ink-muted underline underline-offset-2 hover:text-accent"
        >
          Add
        </button>
      )}

      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

/**
 * The picker's escape hatch, as a value no contact id can collide with.
 *
 * Contact ids are uuids, so a word is safe; it is named rather than inlined
 * because the option and the branch that reads it are far enough apart to
 * drift.
 */
const NEW_CONTACT = 'new-contact';
