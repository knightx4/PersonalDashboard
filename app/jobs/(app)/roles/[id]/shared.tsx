'use client';

import { useState } from 'react';
import { ExternalLink, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Disclosure } from '@/components/ui/disclosure';
import { GmailAnchor } from '@/components/ui/gmail-anchor';

/**
 * Mail that describes an interview rather than merely mentioning one.
 *
 * These are the classifications the ingest path turns into a booking, so they
 * are the ones worth offering a round against when it did not: a scheduling
 * thread hand-linked from the review queue records its event but no interview,
 * and until now that left the Interviews tab silently empty.
 */
export const INTERVIEW_MAIL = new Set(['interview_invite', 'scheduling']);

/** What the "Add a round" form should be seeded with, and which mail asked. */
export interface InterviewSeed {
  kind: string;
  fromSubject: string | null;
}

/**
 * "Open in Gmail" for anything that came from an email.
 *
 * Message bodies are never stored, so a subject line is as far as this app can
 * take you. Handing the rest off to Gmail is the whole point -- the note asked
 * for an actual link, in both places an email is named.
 */
export function GmailLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  /** `press-area` for a link that stands on its own line rather than in a sentence. */
  className?: string;
}) {
  return (
    <GmailAnchor
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-baseline gap-1 underline decoration-border underline-offset-2 transition-colors duration-quick hover:text-accent hover:decoration-accent',
        className,
      )}
    >
      <span>{children}</span>
      <ExternalLink
        className="size-3.5 shrink-0 self-center text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="sr-only">Open in Gmail</span>
    </GmailAnchor>
  );
}

/**
 * What the round is called, and the way to correct it.
 *
 * The round number and kind are inferred from mail — a "quick chat" invite
 * becomes a recruiter screen, a second thread about one conversation becomes
 * another round. Close enough to be useful, wrong often enough that a card
 * with no way to fix its own name is a dead end.
 */
/**
 * The two form fields as the pair the server takes.
 *
 * A day with no hour is stored at local midnight with `timeKnown` false: the
 * timestamp still sorts and groups on the day it was typed for, and the flag
 * is what stops the card from claiming the interview starts at midnight.
 */
export function scheduleFromFields(
  date: string,
  time: string,
): { scheduledAt: string | null; timeKnown: boolean } {
  if (!date) return { scheduledAt: null, timeKnown: false };
  const parsed = new Date(`${date}T${time || '00:00'}`);
  if (!Number.isFinite(parsed.getTime())) return { scheduledAt: null, timeKnown: false };
  return { scheduledAt: parsed.toISOString(), timeKnown: time !== '' };
}

/** The stored instant back as the two fields, in the browser's own zone. */
export function fieldsFromSchedule(
  iso: string | null,
  timeKnown: boolean,
): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return { date: '', time: '' };
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: timeKnown ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : '',
  };
}

/**
 * One of the kinds of note a round can be given.
 *
 * `AddTrigger`, the same line that opens every other compose surface in this
 * file -- "Add a to-do" on the to-dos panel, "Paste the questions" on the
 * answers one. It was a bordered secondary button with a typed "+" in front of
 * the label, and three of those in a row inside the interview card, inside the
 * round card, read as three little boxes competing with the round itself.
 *
 * That is law 14 rather than a matter of taste: what these open is a compose
 * surface, and a bordered button standing in for one is the empty box again
 * wearing a different shape. The trigger is an offer, so it is drawn as an
 * offer -- ink-ghost, no border, no ground until it is pointed at.
 */
export function NoteKindButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <AddTrigger label={label} onClick={onClick} />;
}

/** A labeled section that opens and closes, stacked rather than side by side. */
export function CollapsibleField({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left text-micro font-semibold uppercase tracking-wider text-ink-muted"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-quick',
            !open && '-rotate-90',
          )}
          strokeWidth={1.75}
          aria-hidden
        />
        {label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

/**
 * Controls a closed application rarely needs, folded under one line rather
 * than taken away (plan #1594). A round that turns up after the rejection
 * still has somewhere to go.
 */
export function ClosedFold({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Disclosure title={label} bodyClassName="mt-2 space-y-3">
      {children}
    </Disclosure>
  );
}
