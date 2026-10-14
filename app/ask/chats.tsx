'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SquarePen } from 'lucide-react';
import Link from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { ToggleChip } from '@/components/ui/chip';
import { Disclosure } from '@/components/ui/disclosure';
import { MadeChanges } from '@/components/talk/made-changes';
import type { ChangePresses } from '@/components/talk/dash-changes';
import { cn } from '@/lib/cn';
import { commentWhen, exactTime } from '@/lib/comments/when';
import { moduleById, type ModuleId } from '@/lib/modules';
import { chatChips, groupChats, type AskChat } from '@/lib/talk/ask-chats';
import type { MadeChange } from '@/lib/talk/changes';
import { useClockNow } from '@/lib/use-clock-now';

/**
 * The list of Dash's chats beside the open one on /ask (plan #1899.2): New
 * chat, the workspace chips that narrow the list, then the chats grouped
 * Today, Yesterday, This week and Earlier. The changes Dash made sit folded
 * at the top until the column beside the chat takes them over (#1899.4).
 */

/** A workspace's own colour, as a dot beside its name. */
export function WorkspaceDot({ id, className }: { id: ModuleId; className?: string }) {
  const workspace = moduleById(id);
  return (
    <span
      aria-hidden
      className={cn('inline-block size-1.5 shrink-0 rounded-full', className)}
      style={{ background: workspace ? `var(${workspace.accent})` : undefined }}
    />
  );
}

/** A day as "2 Oct", for chats older than a week; the day is the server's, so both renders agree. */
export function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/** The ref of the chat open at this address, or null on /ask itself. */
export function openChatRef(pathname: string): string | null {
  const match = pathname.match(/^\/ask\/([^/?#]+)/);
  return match ? match[1] : null;
}

export function AskChats({
  chats,
  today,
  made,
  madeFailed = false,
  presses,
  active: activeOverride,
}: {
  chats: readonly AskChat[];
  /** Today in the person's timezone, YYYY-MM-DD, for the groups. */
  today: string;
  made: readonly MadeChange[];
  madeFailed?: boolean;
  presses: ChangePresses;
  /** The open chat's ref, for the gallery; read from the address otherwise. */
  active?: string | null;
}) {
  const pathname = usePathname();
  const active = activeOverride !== undefined ? activeOverride : openChatRef(pathname ?? '');
  const [only, setOnly] = useState<ModuleId | null>(null);
  const chips = useMemo(() => chatChips(chats), [chats]);
  const shown = useMemo(
    () => (only ? chats.filter((chat) => chat.workspaces.includes(only)) : chats),
    [chats, only],
  );
  const groups = useMemo(() => groupChats(shown, today), [shown, today]);
  const now = useClockNow();

  return (
    <div className="space-y-3">
      <Link href="/ask" className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-start')}>
        <SquarePen strokeWidth={1.75} aria-hidden />
        New chat
      </Link>

      {chips.length > 1 && (
        <div
          role="group"
          aria-label="Show chats that used"
          // One line at every width; a phone scrolls the row sideways.
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
        >
          {chips.map((id) => (
            <ToggleChip key={id} on={only === id} onClick={() => setOnly(only === id ? null : id)}>
              <WorkspaceDot id={id} className="size-2" />
              {moduleById(id)?.label}
            </ToggleChip>
          ))}
        </div>
      )}

      {chats.length === 0 ? (
        <p className="text-ui text-ink-muted">
          No chats yet. Ask Dash anything about your dashboard and the chat is kept here.
        </p>
      ) : (
        <nav aria-label="Chats with Dash" className="space-y-3">
          {groups.map(({ group, chats: inGroup }) => (
            <section key={group} aria-label={group}>
              <h3 className="px-2 text-small font-medium text-ink-muted">{group}</h3>
              <ul className="mt-1 space-y-0.5">
                {inGroup.map((chat) => {
                  const on = chat.ref === active;
                  return (
                    <li key={chat.id}>
                      <Link
                        href={`/ask/${chat.ref}`}
                        aria-current={on ? 'page' : undefined}
                        className={cn(
                          'block min-h-11 rounded-control px-2 py-2 transition-colors duration-quick',
                          on ? 'bg-accent-tint' : 'hover:bg-sunken',
                        )}
                      >
                        <span className="flex items-baseline gap-2">
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-ui',
                              on ? 'font-medium text-accent' : 'text-ink',
                            )}
                          >
                            {chat.title ?? 'A question'}
                          </span>
                          <time
                            dateTime={chat.lastAt}
                            title={exactTime(chat.lastAt)}
                            className="tabular shrink-0 text-small text-ink-muted"
                          >
                            {group === 'Earlier' ? shortDay(chat.day) : commentWhen(chat.lastAt, now)}
                          </time>
                        </span>
                        {chat.workspaces.length > 0 && (
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-ink-muted">
                            {chat.workspaces.map((id) => (
                              <span key={id} className="inline-flex items-center gap-1">
                                <WorkspaceDot id={id} />
                                {moduleById(id)?.label}
                              </span>
                            ))}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="px-2 text-ui text-ink-muted">No chat used {moduleById(only)?.label} yet.</p>
          )}
        </nav>
      )}

      {madeFailed && (
        <p className="text-small text-danger">The changes Dash made could not be read. Reload to try again.</p>
      )}
      {made.length > 0 && (
        <Disclosure
          title={<span className="text-ink-muted">Changes Dash made</span>}
          meta={<span className="tabular">{made.length}</span>}
          summaryClassName="px-2 text-small font-medium"
        >
          <div className="mt-2">
            <MadeChanges changes={[...made]} presses={presses} today={today} />
          </div>
        </Disclosure>
      )}
    </div>
  );
}
