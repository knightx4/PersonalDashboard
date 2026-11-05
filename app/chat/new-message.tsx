'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { MessagingPanel, PersonMark } from '@/components/patterns/messaging';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { filterRecipients, personInitials, recipientsOf, type PersonRow } from '@/lib/you/chat-threads-model';
import { defaultGroupTitle, firstName, GROUP_MAX, GROUP_TITLE_MAX } from '@/lib/you/group-chats-model';

/**
 * New message on the Messages tab (plan #2879.2; several at once since
 * #2879.1.3), in the thread's place: a To box over everyone you can message,
 * A to Z. Tapping someone adds them to the To line and tapping again takes
 * them off. One picked opens the chat with them (or the one there is); two
 * to eight start a group, with a name of your own or their first names.
 * Someone not ready to talk is listed but cannot be picked. Adding a bot is
 * on the Bots tab (plan #2879.3).
 */
export function NewMessage({
  everyone,
  start,
  startGroup,
  picked: firstPicked = [],
  name: firstName_ = '',
  starting: startingAt = false,
  error: firstError = null,
}: {
  /** Everyone on the roster, with a chat or not. */
  everyone: readonly PersonRow[];
  start?: (key: string) => Promise<{ href: string } | { error: string }>;
  startGroup?: (keys: string[], name: string) => Promise<{ href: string } | { error: string }>;
  /** The gallery's way to draw some already picked. */
  picked?: readonly string[];
  /** The gallery's way to draw a group name typed. */
  name?: string;
  /** The gallery's way to draw a start in progress. */
  starting?: boolean;
  /** The gallery's way to draw a start that failed. */
  error?: string | null;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<string[]>([...firstPicked]);
  const [groupName, setGroupName] = useState(firstName_);
  const [starting, setStarting] = useState(startingAt);
  const [error, setError] = useState<string | null>(firstError);
  const [, startTransition] = useTransition();
  const shown = filterRecipients(recipientsOf(everyone), typed);
  const byKey = new Map(everyone.map((r) => [r.key, r]));
  const chosen = picked.flatMap((k) => byKey.get(k) ?? []);
  const full = picked.length >= GROUP_MAX;

  const toggle = (row: PersonRow) => {
    if (starting || !row.canTalk) return;
    setError(null);
    setPicked((list) => (list.includes(row.key) ? list.filter((k) => k !== row.key) : list.length >= GROUP_MAX ? list : [...list, row.key]));
    setTyped('');
  };

  const go = () => {
    if (starting || chosen.length === 0) return;
    setStarting(true);
    setError(null);
    startTransition(async () => {
      const done =
        chosen.length === 1
          ? start
            ? await start(chosen[0].key)
            : { error: 'Not in the gallery.' }
          : startGroup
            ? await startGroup(chosen.map((c) => c.key), groupName)
            : { error: 'Not in the gallery.' };
      if ('error' in done) {
        setError(done.error);
        setStarting(false);
        return;
      }
      router.push(done.href);
    });
  };

  const label =
    chosen.length === 0 ? 'Message' : chosen.length === 1 ? `Message ${firstName(chosen[0].name)}` : `Start group of ${chosen.length}`;

  return (
    <MessagingPanel
      title="New message"
      back={{ href: '/chat', label: 'Messages' }}
      crumbs={[{ label: 'Messages', href: '/chat' }]}
      foot={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/chat" className={buttonVariants({ variant: 'ghost' })}>
            Cancel
          </Link>
          <Button type="button" onClick={go} disabled={chosen.length === 0 || starting} aria-busy={starting || undefined}>
            {starting ? (chosen.length > 1 ? 'Starting…' : 'Opening…') : label}
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ui text-ink-muted">To</span>
          {chosen.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-pill bg-accent-tint py-0.5 pr-0.5 pl-2.5 text-ui text-ink">
              {c.name}
              <IconButton size="sm" label={`Take ${c.name} off`} onClick={() => toggle(c)} className="rounded-pill">
                <X strokeWidth={1.75} aria-hidden />
              </IconButton>
            </span>
          ))}
          <Input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Who to message"
            placeholder={chosen.length ? 'Add someone' : 'A name'}
            autoComplete="off"
            className="min-w-32 flex-1 max-sm:min-h-11"
          />
        </div>
        {chosen.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="text-small text-ink-muted">Group name, if you want one</span>
            <Input
              value={groupName}
              maxLength={GROUP_TITLE_MAX}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={defaultGroupTitle(chosen.map((c) => c.name))}
              className="max-sm:min-h-11"
            />
          </label>
        )}
        {error && <p className="text-small text-danger">{error}</p>}
        {full && <p className="text-small text-ink-muted">A group holds {GROUP_MAX} at most.</p>}
        {everyone.length === 0 ? (
          <p className="text-ui text-ink-muted">No one to message yet. Add a bot on the Bots tab, or put mentors on your council.</p>
        ) : shown.length === 0 ? (
          <p className="text-ui text-ink-muted">No one called “{typed.trim()}”.</p>
        ) : (
          <ul className="-mx-2">
            {shown.map((row) => {
              const on = picked.includes(row.key);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => toggle(row)}
                    disabled={!row.canTalk || starting || (full && !on)}
                    aria-pressed={on}
                    className={cn(
                      'grid min-h-11 w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-control px-2 py-2 text-left',
                      row.canTalk ? 'hover:bg-sunken disabled:hover:bg-transparent' : 'cursor-not-allowed',
                      on && 'bg-accent-tint hover:bg-accent-tint disabled:hover:bg-accent-tint',
                    )}
                  >
                    <PersonMark initials={personInitials(row.name)} colour={row.colour} photo={row.photo} />
                    <span className="min-w-0">
                      <span className={cn('block truncate text-body font-semibold', row.canTalk ? 'text-ink' : 'text-ink-muted')}>{row.name}</span>
                      <span className="block truncate text-small text-ink-muted">
                        {row.canTalk ? row.about || (row.chatId ? 'You have a chat' : 'No chat yet') : 'Not ready to talk yet'}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-5 items-center justify-center rounded-pill',
                        on ? 'bg-accent text-fill-ink' : row.canTalk ? 'ring-1 ring-border-strong' : '',
                      )}
                    >
                      {on && <Check className="size-3.5" strokeWidth={1.75} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </MessagingPanel>
  );
}
