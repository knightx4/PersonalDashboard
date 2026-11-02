'use client';

import { useState, useTransition } from 'react';
import { Check, ListTodo, MessageCircle, ThumbsDown, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import { cn } from '@/lib/cn';
import { whenAgo } from '@/lib/core/when';
import type { CouncilNote, Reaction } from '@/lib/you/council-model';
import { MentorMark } from './mentor-mark';

/**
 * One note from a mentor (you 0037): who wrote it and when, what they said,
 * the rows it rests on, and what the person can do with it. Got it reads
 * it; Talk about this opens the mentor's page with the note as the start of
 * the message; Make it a todo puts it on Todo; Disagree asks for a line of
 * why, which the mentor reads before writing again; Not useful tells the
 * round to write less like it. Each saves at once.
 */

export type NoteActions = {
  read: (ids: string[]) => Promise<{ error: string | null }>;
  react: (id: string, reaction: Reaction | null, note?: string | null) => Promise<{ error: string | null }>;
  todo: (id: string) => Promise<{ error: string | null }>;
};

export type NoteAuthor = { key: string; name: string; kind: 'seat' | 'guest' };

const REACTION_LINE: Record<Reaction, string> = {
  useful: 'You found this useful.',
  not_useful: 'You said this was not useful.',
  disagree: 'You disagreed.',
};

export function NoteCard({
  note,
  author,
  timezone,
  now,
  actions,
  showAuthor = true,
  start,
}: {
  note: CouncilNote;
  author: NoteAuthor;
  timezone: string;
  now: number;
  actions: NoteActions;
  /** Off on the mentor's own page, where the header already says who. */
  showAuthor?: boolean;
  /** The gallery opens the Disagree box with this. */
  start?: { disagree?: string; error?: string };
}) {
  const [disagreeing, setDisagreeing] = useState(start?.disagree !== undefined);
  const [why, setWhy] = useState(start?.disagree ?? '');
  const [error, setError] = useState<string | null>(start?.error ?? null);
  const [pending, startTransition] = useTransition();
  const unread = !note.readAt;
  const talkHref = `/you/council/mentors/${author.key}?about=${note.id}#talk`;

  const run = (work: () => Promise<{ error: string | null }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) setError(result.error);
      else after?.();
    });
  };

  return (
    <Card padding="standard" className={cn('space-y-3', unread && 'ring-1 ring-accent/40')}>
      <div className="flex items-center gap-2">
        {showAuthor && <MentorMark mentorKey={author.key} name={author.name} kind={author.kind} size="sm" />}
        {showAuthor ? (
          <Link href={`/you/council/mentors/${author.key}`} className="text-ui font-semibold text-ink hover:underline">
            {author.name}
          </Link>
        ) : null}
        <span className="text-small text-ink-muted">{whenAgo(note.createdAt, { timeZone: timezone, now })}</span>
        {unread && <span className="ml-auto text-small font-medium text-accent">New</span>}
      </div>

      <p className="whitespace-pre-line text-body text-ink">
        <LinkedText text={note.text} refs={false} />
      </p>

      {note.receipts.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-small">
          {note.receipts.map((r) => (
            <li key={r.link + r.label}>
              <Link href={r.link} className={linkVariants({ tone: 'quiet' })}>
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {note.reaction && (
        <p className="text-small text-ink-muted">
          {REACTION_LINE[note.reaction]}
          {note.reactionNote ? ` "${note.reactionNote}"` : ''}{' '}
          <Button type="button" variant="link" onClick={() => run(() => actions.react(note.id, null))}>
            Undo
          </Button>
        </p>
      )}

      {disagreeing && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => actions.react(note.id, 'disagree', why),
              () => setDisagreeing(false),
            );
          }}
        >
          <ComposeBox>
            <ComposeBody
              aria-label={`Why you disagree with ${author.name}`}
              placeholder={`What does ${author.name} have wrong? They read this before writing again.`}
              value={why}
              maxLength={1000}
              rows={2}
              onChange={(event) => setWhy(event.target.value)}
            />
          </ComposeBox>
          <div className="flex gap-2">
            <Button type="submit" size="sm" pending={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDisagreeing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!disagreeing && (
        <div className="flex flex-wrap items-center gap-1.5">
          {unread && (
            <Button type="button" size="sm" variant="secondary" pending={pending} onClick={() => run(() => actions.read([note.id]))}>
              <Check aria-hidden strokeWidth={1.75} className="size-3.5" />
              Got it
            </Button>
          )}
          <Link href={talkHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <MessageCircle aria-hidden strokeWidth={1.75} className="size-3.5" />
            Talk about this
          </Link>
          {note.taskId ? (
            <Link href="/todo" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <ListTodo aria-hidden strokeWidth={1.75} className="size-3.5" />
              On Todo
            </Link>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => actions.todo(note.id))}>
              <ListTodo aria-hidden strokeWidth={1.75} className="size-3.5" />
              Make it a todo
            </Button>
          )}
          {!note.reaction && (
            <>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDisagreeing(true)}>
                <X aria-hidden strokeWidth={1.75} className="size-3.5" />
                Disagree
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => actions.react(note.id, 'not_useful'))}
              >
                <ThumbsDown aria-hidden strokeWidth={1.75} className="size-3.5" />
                Not useful
              </Button>
            </>
          )}
        </div>
      )}
      <FieldError>{error}</FieldError>
    </Card>
  );
}
