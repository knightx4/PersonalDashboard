'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { MessagingPanel, PersonMark } from '@/components/patterns/messaging';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { personInitials, recipientsOf, type PersonRow } from '@/lib/you/chat-threads-model';
import { defaultGroupTitle, GROUP_MAX, GROUP_MIN, GROUP_TITLE_MAX, groupHref, type GroupMember } from '@/lib/you/group-chats-model';
import { GroupMark } from '../../group-parts';

/**
 * A group's settings (plan #2879.1.3), in the thread's place: its name, who
 * is in it (two to eight, ticked from everyone ready to talk), and deleting
 * it. Save renames and changes the members together; Delete asks once more
 * before it takes the group and everything said in it.
 */
export type GroupSettingsActions = {
  save: (chatId: string, input: { name: string; keys: string[] }) => Promise<{ error: string | null }>;
  remove: (chatId: string) => Promise<{ error: string | null }>;
};

export function GroupSettings({
  chatId,
  name: firstName,
  members,
  everyone,
  actions,
  confirming: firstConfirming = false,
  error: firstError = null,
}: {
  chatId: string;
  /** The name it has, or empty for the default. */
  name: string;
  members: readonly GroupMember[];
  /** Everyone on the roster, for adding to the group. */
  everyone: readonly PersonRow[];
  actions?: GroupSettingsActions;
  /** For the gallery: the delete asked about. */
  confirming?: boolean;
  error?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(firstName);
  const [keys, setKeys] = useState<string[]>(members.map((m) => m.key));
  const [confirming, setConfirming] = useState(firstConfirming);
  const [error, setError] = useState<string | null>(firstError);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const inGroup = new Set(members.map((m) => m.key));
  // Members first, as they are, then everyone else who can talk, A to Z.
  const offered = [
    ...members.map((m) => everyone.find((r) => r.key === m.key) ?? null).filter((r): r is PersonRow => r !== null),
    ...recipientsOf(everyone).filter((r) => r.canTalk && !inGroup.has(r.key)),
  ];
  const picked = offered.filter((r) => keys.includes(r.key));
  const ok = keys.length >= GROUP_MIN && keys.length <= GROUP_MAX;

  const toggle = (key: string) => {
    setError(null);
    setKeys((list) => (list.includes(key) ? list.filter((k) => k !== key) : list.length >= GROUP_MAX ? list : [...list, key]));
  };

  const save = () => {
    if (!actions || !ok || busy) return;
    setBusy(true);
    startTransition(async () => {
      const done = await actions.save(chatId, { name, keys });
      setBusy(false);
      if (done.error) return setError(done.error);
      router.push(groupHref(chatId));
    });
  };

  const remove = () => {
    if (!actions || busy) return;
    setBusy(true);
    startTransition(async () => {
      const done = await actions.remove(chatId);
      setBusy(false);
      if (done.error) return setError(done.error);
      router.push('/chat');
    });
  };

  return (
    <MessagingPanel
      title="Group settings"
      avatar={<GroupMark members={picked.length ? picked : members} size="sm" />}
      back={{ href: groupHref(chatId), label: 'Group' }}
      crumbs={[{ label: 'Messages', href: '/chat' }, { label: 'Group', href: groupHref(chatId) }]}
      foot={
        confirming ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-ui text-ink">Delete this group and everything said in it?</p>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </Button>
            <Button type="button" variant="danger" onClick={remove} disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Deleting…' : 'Delete group'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" className="mr-auto text-danger" onClick={() => setConfirming(true)}>
              Delete group
            </Button>
            <Link href={groupHref(chatId)} className={buttonVariants({ variant: 'ghost' })}>
              Cancel
            </Link>
            <Button type="button" onClick={save} disabled={!ok || busy} aria-busy={busy || undefined}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )
      }
    >
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-small text-ink-muted">Name</span>
          <Input
            value={name}
            maxLength={GROUP_TITLE_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultGroupTitle(picked.map((p) => p.name))}
            className="max-sm:min-h-11"
          />
        </label>
        <div>
          <p className="text-small text-ink-muted">
            In the group · {keys.length} of {GROUP_MAX}
            {keys.length < GROUP_MIN && ', pick at least two'}
          </p>
          {error && <p className="mt-1 text-small text-danger">{error}</p>}
          <ul className="-mx-2 mt-1">
            {offered.map((row) => {
              const on = keys.includes(row.key);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => toggle(row.key)}
                    aria-pressed={on}
                    disabled={!on && keys.length >= GROUP_MAX}
                    className={cn(
                      'grid min-h-11 w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-control px-2 py-2 text-left hover:bg-sunken disabled:hover:bg-transparent',
                      on && 'bg-accent-tint hover:bg-accent-tint',
                    )}
                  >
                    <PersonMark initials={personInitials(row.name)} colour={row.colour} photo={row.photo} />
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold text-ink">{row.name}</span>
                      <span className="block truncate text-small text-ink-muted">{row.about}</span>
                    </span>
                    <span aria-hidden className={cn('flex size-5 items-center justify-center rounded-pill', on ? 'bg-accent text-fill-ink' : 'ring-1 ring-border-strong')}>
                      {on && <Check className="size-3.5" strokeWidth={1.75} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </MessagingPanel>
  );
}
