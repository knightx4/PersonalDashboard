'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MessagingPanel, PersonMark } from '@/components/patterns/messaging';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { filterRecipients, personInitials, recipientsOf, type PersonRow } from '@/lib/you/chat-threads-model';
import { ADD_HREF } from '@/lib/you/people-cards-model';

/**
 * New message on the Messages tab (plan #2879.2), in the thread's place: a
 * To box over everyone you can message, A to Z, and picking one starts the
 * chat with them (or opens the one there is) and goes to it. Someone not
 * ready to talk is listed but cannot be picked. Adding someone new is at the
 * foot until the Bots tab takes it over.
 */
export function NewMessage({
  everyone,
  start,
  starting: startingAt = null,
  error: firstError = null,
}: {
  /** Everyone on the roster, with a chat or not. */
  everyone: readonly PersonRow[];
  start?: (key: string) => Promise<{ href: string } | { error: string }>;
  /** The gallery's way to draw a pick mid-start. */
  starting?: string | null;
  /** The gallery's way to draw a start that failed. */
  error?: string | null;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<string | null>(startingAt);
  const [error, setError] = useState<string | null>(firstError);
  const [, startTransition] = useTransition();
  const shown = filterRecipients(recipientsOf(everyone), typed);

  const pick = (row: PersonRow) => {
    if (!start || picked) return;
    setPicked(row.key);
    setError(null);
    startTransition(async () => {
      const done = await start(row.key);
      if ('error' in done) {
        setError(done.error);
        setPicked(null);
        return;
      }
      router.push(done.href);
    });
  };

  return (
    <MessagingPanel
      title="New message"
      back={{ href: '/chat', label: 'Messages' }}
      crumbs={[{ label: 'Messages', href: '/chat' }]}
      foot={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={ADD_HREF} className={buttonVariants({ variant: 'ghost' })}>
            Add someone new
          </Link>
          <Link href="/chat" className={buttonVariants({ variant: 'ghost' })}>
            Cancel
          </Link>
        </div>
      }
    >
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <label className="flex items-center gap-2">
          <span className="text-ui text-ink-muted">To</span>
          <Input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Who to message"
            placeholder="A name"
            autoComplete="off"
            className="max-sm:min-h-11"
          />
        </label>
        {error && <p className="text-small text-danger">{error}</p>}
        {everyone.length === 0 ? (
          <p className="text-ui text-ink-muted">No one to message yet. Add someone new, or put mentors on your council.</p>
        ) : shown.length === 0 ? (
          <p className="text-ui text-ink-muted">No one called “{typed.trim()}”.</p>
        ) : (
          <ul className="-mx-2">
            {shown.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => pick(row)}
                  disabled={!row.canTalk || Boolean(picked)}
                  aria-busy={picked === row.key || undefined}
                  className={cn(
                    'grid min-h-11 w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-control px-2 py-2 text-left',
                    row.canTalk ? 'hover:bg-sunken disabled:hover:bg-transparent' : 'cursor-not-allowed',
                    picked === row.key && 'bg-accent-tint disabled:hover:bg-accent-tint',
                  )}
                >
                  <PersonMark initials={personInitials(row.name)} colour={row.colour} />
                  <span className="min-w-0">
                    <span className={cn('block truncate text-body font-semibold', row.canTalk ? 'text-ink' : 'text-ink-muted')}>{row.name}</span>
                    <span className="block truncate text-small text-ink-muted">
                      {row.canTalk ? row.about || (row.chatId ? 'Open your chat' : 'Start a chat') : 'Not ready to talk yet'}
                    </span>
                  </span>
                  <span className="text-small text-ink-muted">{picked === row.key ? 'Opening…' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MessagingPanel>
  );
}
