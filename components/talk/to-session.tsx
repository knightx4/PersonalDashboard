'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import type { SessionProjectChoice } from '@/lib/talk/chat-to-session';

/**
 * Taking an Ask Dash chat to a session thread (plan #2789.8): the form that
 * opens under an answer. The project is the one the chat names, which can be
 * changed before sending; "This app" is the first choice. Sending starts the
 * thread with the chat as its first message and leaves a link to it.
 *
 * What it reads and does comes in as props, so the gallery draws it with
 * fixtures and the thread with the server actions.
 */

export type ToSessionSource = {
  options: () => Promise<
    { ok: true; projects: SessionProjectChoice[]; suggested: string | null } | { ok: false; error: string }
  >;
  start: (projectId: string | null) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
};

/** The value of the "This app" choice, since an option's value cannot be null. */
const THIS_APP = '';

export const SESSION_THREAD_HREF = (id: string) => `/chat/dash/session/${id}`;

export function ToSessionForm({
  source,
  onClose,
}: {
  source: ToSessionSource;
  onClose: () => void;
}) {
  const selectId = useId();
  const [choices, setChoices] = useState<SessionProjectChoice[] | null>(null);
  const [project, setProject] = useState(THIS_APP);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  // Read the projects once, when the form first draws.
  useEffect(() => {
    let live = true;
    source
      .options()
      .then((found) => {
        if (!live) return;
        if (found.ok) {
          setChoices(found.projects);
          setProject(found.suggested ?? THIS_APP);
        } else {
          setError(found.error);
          setChoices([]);
        }
      })
      .catch(() => {
        if (!live) return;
        setError('The projects could not be read. Try again.');
        setChoices([]);
      });
    return () => {
      live = false;
    };
  }, [source]);

  if (started) {
    return (
      <p role="status" className="mt-1 text-small text-ink-muted">
        Started.{' '}
        <Link href={SESSION_THREAD_HREF(started)} className={linkVariants({ tone: 'inline' })}>
          Open the thread
        </Link>
      </p>
    );
  }

  const send = () => {
    setError(null);
    startSending(async () => {
      const outcome = await source
        .start(project === THIS_APP ? null : project)
        .catch(() => ({ ok: false as const, error: 'The thread could not be started. Check your connection and try again.' }));
      if (outcome.ok) setStarted(outcome.id);
      else setError(outcome.error);
    });
  };

  return (
    <form
      className="mt-1 flex max-w-prose flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor={selectId} className="text-small text-ink-muted">
        On
      </label>
      <Select
        id={selectId}
        value={project}
        disabled={choices === null || sending}
        onChange={(event) => setProject(event.target.value)}
        className="min-w-0 flex-1 max-sm:min-h-11 max-sm:basis-[calc(100%-2.5rem)]"
      >
        <option value={THIS_APP}>This app</option>
        {(choices ?? []).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="secondary" pending={sending} disabled={choices === null}>
        Start the thread
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={sending}>
        Cancel
      </Button>
      <p className="basis-full text-small text-ink-muted">This chat goes as the first message.</p>
      <FieldError>{error}</FieldError>
    </form>
  );
}
