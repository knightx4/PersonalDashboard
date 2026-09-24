'use client';

/**
 * The generated prep note, on the round it was written for.
 *
 * It sits beside the prep you typed rather than inside it: two different
 * things with two different owners, and the box you wrote in is never read or
 * written by any of this (see the migration in 0024 and the decision on #64).
 *
 * The note is a set of sections rather than one blob of prose, so this renders
 * headed blocks and follows the card's existing rule that a block appears when
 * it has something to say. A note with no interviewers on file shows no
 * interviewers heading; what it did not have is said once, quietly, at the
 * bottom.
 */
import Link from 'next/link';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRef, useState, useTransition } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/jobs/applications/load';
import type { MatchVerdict } from '@/lib/jobs/evidence/match-payload';
import type { PrepNote } from '@/lib/jobs/interview/prep-payload';

import { writeRoundPrepNote } from './actions';
import { PaidHint } from '@/components/ui/paid-hint';

const PREP_HINT = {
  action: 'app/jobs/(app)/roles/[id]/actions.ts#writeRoundPrepNote',
  what: 'Cost of writing the prep note',
} as const;

/** What the page knows about one round's note before anything is pressed. */
export type PrepNoteState = {
  note: PrepNote | null;
  generatedAt: string | null;
  /** The facts it was written against have changed since. */
  stale: boolean;
};

const VERDICT_LABEL: Record<MatchVerdict, string> = {
  strong: 'Strong',
  partial: 'Partial',
  gap: 'Gap',
};

const VERDICT_TEXT: Record<MatchVerdict, string> = {
  strong: 'text-positive',
  partial: 'text-caution',
  gap: 'text-danger',
};

/**
 * A sentence or two of the note's own prose.
 *
 * `rehype-raw` is absent here for the same reason it is absent from the vault
 * note body, and its absence is the sanitizer: with raw HTML off,
 * react-markdown will not render embedded markup at all.
 */
function Prose({ children }: { children: string }) {
  return (
    <div className="jobs-prose">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
        {heading}
      </h5>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Points({
  heading,
  points,
}: {
  heading: string;
  points: PrepNote['strengths'];
}) {
  if (points.length === 0) return null;
  return (
    <Section heading={heading}>
      <ul className="space-y-1.5">
        {points.map((point, index) => (
          <li key={`${point.requirement}-${index}`} className="text-ui text-ink">
            {point.requirement}
            <span className={cn('ml-2 text-small font-medium', VERDICT_TEXT[point.verdict])}>
              {VERDICT_LABEL[point.verdict]}
            </span>
            <div className="mt-0.5 text-small text-ink-muted">
              <Prose>{point.note}</Prose>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * One round's prep note, and the button that writes it.
 *
 * The note belongs to the round rather than to a conversation, so a superday
 * renders this once for the day rather than four times over. The id passed in
 * is the round's lead conversation; the action stores against the round
 * whichever of its conversations the press came from.
 */
export function RoundPrep({
  interviewId,
  state,
  timezone,
}: {
  interviewId: string;
  state: PrepNoteState;
  timezone: string;
}) {
  const [note, setNote] = useState(state.note);
  const [generatedAt, setGeneratedAt] = useState(state.generatedAt);
  const [stale, setStale] = useState(state.stale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const foldRef = useRef<HTMLDetailsElement>(null);

  const prepare = (regenerate: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await writeRoundPrepNote({ interviewId, regenerate });
      if (result.error || !result.note) {
        setError(result.error ?? 'The prep note came back empty.');
        return;
      }
      setNote(result.note);
      // A fresh note is opened, even if the old one had been folded away.
      if (foldRef.current) foldRef.current.open = true;
      setGeneratedAt(new Date().toISOString());
      setStale(false);
    });

  const heading = (
    <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">Prep note</h4>
  );

  const staleLine = stale && (
    <p className="mt-1 text-small text-caution">
      The description, your bank or who you are meeting has changed since this was written.
    </p>
  );

  if (!note) {
    return (
      <div className="mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {heading}
          <div className="flex items-center gap-2">
            <PaidHint {...PREP_HINT} align="end" />
            <Button type="button" size="sm" disabled={pending} onClick={() => prepare(false)}>
              {pending ? 'Preparing…' : 'Prepare me'}
            </Button>
          </div>
        </div>

        {!error && (
          <p className="mt-1 text-small text-ink-muted">
            What this job asks for against your record, who you are meeting, what earlier rounds
            here asked, and the stories to have ready — from what the app already holds. Your own
            prep note is untouched.
          </p>
        )}

        {error && <p className="mt-1 text-small text-danger">{error}</p>}
      </div>
    );
  }

  return (
    // Note ad736ea2: a written note is long, so it folds by its own heading.
    // A native <details> so it folds before JavaScript loads (law 6), open to
    // begin with because it was asked for. Regenerate sits beside the summary
    // rather than in it, so pressing it never folds the note as well.
    <div className="relative mt-3">
      <details ref={foldRef} open className="group/prep">
        <summary
          className={cn(
            'press flex cursor-pointer list-none items-center gap-1.5 rounded-control pr-24',
            'hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2',
            '[&::-webkit-details-marker]:hidden',
          )}
        >
          <ChevronRight
            aria-hidden
            strokeWidth={2}
            className="size-3.5 shrink-0 text-ink-muted transition-transform duration-150 group-open/prep:rotate-90"
          />
          {heading}
          {/* Law 10: the closed line says whether the note is still current. */}
          <span className="text-small text-ink-muted group-open/prep:hidden">
            {stale
              ? 'Out of date'
              : generatedAt
                ? `Written ${formatDateTime(generatedAt, timezone)}`
                : null}
          </span>
        </summary>

        {staleLine}

        {error && <p className="mt-1 text-small text-danger">{error}</p>}

        {/* A well rather than a frame, the same as the answer draft: this is
            the one block on the card that the app wrote rather than you. */}
        <div className="mt-2 space-y-3 rounded-card bg-canvas p-3">
          <Prose>{note.roundSummary}</Prose>

          {note.interviewers.length > 0 && (
            <Section heading="Who you are meeting">
              <ul className="space-y-1.5">
                {note.interviewers.map((person) => (
                  <li key={person.contactId} className="text-ui text-ink">
                    <span className="font-medium">{person.name}</span>
                    <div className="mt-0.5 text-small text-ink-muted">
                      <Prose>{person.note}</Prose>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Points heading="Where you are strong" points={note.strengths} />
          <Points heading="Where you are thin" points={note.gaps} />

          {note.stories.length > 0 && (
            <Section heading="Stories to have ready">
              <ul className="space-y-1.5">
                {note.stories.map((story) => (
                  <li key={story.evidenceItemId} className="text-ui text-ink">
                    {/* The bank is edited in Settings, so the story links back
                        to the item it came from rather than restating it. */}
                    <Link
                      href={`/jobs/settings#evidence-${story.evidenceItemId}`}
                      className="font-medium underline underline-offset-2 hover:text-accent"
                    >
                      {story.title}
                    </Link>
                    <div className="mt-0.5 text-small text-ink-muted">
                      <Prose>{story.note}</Prose>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(note.priorRoundsNote || note.priorQuestions.length > 0) && (
            <Section heading="Earlier rounds here">
              {note.priorRoundsNote && (
                <div className="text-small text-ink-muted">
                  <Prose>{note.priorRoundsNote}</Prose>
                </div>
              )}
              {note.priorQuestions.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-ui text-ink-muted">
                  {note.priorQuestions.map((question, index) => (
                    <li key={index}>· {question}</li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {note.questionsToAsk.length > 0 && (
            <Section heading="Worth asking them">
              <ul className="space-y-0.5 text-ui text-ink">
                {note.questionsToAsk.map((question, index) => (
                  <li key={index}>· {question}</li>
                ))}
              </ul>
            </Section>
          )}

          {/* Quiet, not a warning: an absent job description is an ordinary
              state, and the point is that the note says so rather than
              writing around it. */}
          {note.missing.length > 0 && (
            <p className="text-small text-ink-muted">
              Written without: {note.missing.join(' ')}
            </p>
          )}

          {note.bannedFound.length > 0 && (
            <p className="text-small text-caution">
              Uses {note.bannedFound.map((phrase) => `“${phrase}”`).join(', ')} — on your banned
              list.
            </p>
          )}

          {generatedAt && (
            <p className="tabular text-small text-ink-muted">
              Written {formatDateTime(generatedAt, timezone)}.
            </p>
          )}
        </div>
      </details>

      <div className="absolute right-0 top-0 flex items-center gap-2">
        <PaidHint {...PREP_HINT} align="end" />
        <button
          type="button"
          disabled={pending}
          onClick={() => prepare(true)}
          className="text-small text-ink-muted underline underline-offset-2 hover:text-accent"
        >
          {pending ? 'Preparing…' : 'Regenerate'}
        </button>
      </div>
    </div>
  );
}
