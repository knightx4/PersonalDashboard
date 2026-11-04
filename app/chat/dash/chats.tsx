'use client';

import { whenDate } from '@/lib/core/when';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { Search, SquareTerminal, X } from 'lucide-react';
import Link from '@/components/ui/link';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Input, InlineInput } from '@/components/ui/field';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { MadeChanges } from '@/components/talk/made-changes';
import type { ChangePresses } from '@/components/talk/dash-changes';
import { cn } from '@/lib/cn';
import { commentWhen, exactTime } from '@/lib/comments/when';
import { moduleById, type ModuleId } from '@/lib/modules';
import {
  chatGroup,
  chatQuery,
  chatTitleFrom,
  groupChats,
  splitArchived,
  type AskChat,
} from '@/lib/talk/ask-chats';
import type { MadeChange } from '@/lib/talk/changes';
import { useClockNow } from '@/lib/use-clock-now';
import {
  newSessionThreadHref,
  openSessionRef,
  sessionThreadPath,
  stateWord,
  type SessionThread,
} from '@/lib/core/session-threads-model';

/**
 * The list of Dash's chats beside the open one on Chat's Dash tab (plans
 * #1899.2, #2748.1): New chat, the search box, then one list of chats, with no
 * chips narrowing it to a workspace, grouped Pinned, Today, Yesterday, This week and Earlier. Each chat
 * can be pinned, renamed or archived from its menu (#1899.6); archived
 * chats are kept under Archived at the foot, beside every change Dash made
 * across all chats. One chat's changes are in the column beside it (#1899.4).
 */

/** What the list's presses do: the server actions on the page, fixtures in the gallery. */
export type ChatEdits = {
  pin: (ref: string, pinned: boolean) => Promise<{ ok: true } | { ok: false; error: string }>;
  rename: (ref: string, title: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  archive: (ref: string, archived: boolean) => Promise<{ ok: true } | { ok: false; error: string }>;
  search: (text: string) => Promise<{ hits: ChatHit[]; error?: string }>;
};

type ChatHit = { ref: string; snippet: string };

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
  return whenDate(day, { timeZone: 'UTC', year: 'never' });
}

/** The ref of the chat open at this address, or null on /chat/dash itself. */
export function openChatRef(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/dash\/([^/?#]+)/);
  return match ? match[1] : null;
}

/** The search box above the list: finds a chat by its name or by anything said in it. */
function ChatSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div role="search" className="relative">
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search your chats"
        aria-label="Search your chats"
        className="min-h-11 border-transparent bg-sunken pl-8 pr-8 sm:min-h-0 [&::-webkit-search-cancel-button]:hidden"
      />
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      {value && (
        <Tooltip label="Clear search" align="end" className="absolute right-1 top-1/2 -translate-y-1/2">
          <button type="button" onClick={() => onChange('')} className={iconButtonVariants({ size: 'sm' })}>
            <X strokeWidth={1.75} aria-hidden />
            <span className="sr-only">Clear search</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/** The snippet with each place the search matched set in the text's own ink. */
function Marked({ text, match }: { text: string; match: string | null }) {
  if (!match) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = match.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="bg-transparent font-medium text-ink">
        {text.slice(at, at + match.length)}
      </mark>,
    );
    from = at + match.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** One chat in the list: its name and when, the workspaces it used, and its menu. */
function ChatRow({
  chat,
  on,
  when,
  snippet,
  match = null,
  renaming,
  menuOpen,
  onRename,
  onRenamed,
  items,
}: {
  chat: AskChat;
  on: boolean;
  when: string;
  /** The words around what the search found, under the name. */
  snippet?: string | null;
  /** What was searched for, picked out in the snippet. */
  match?: string | null;
  renaming: boolean;
  menuOpen?: boolean;
  onRename: (open: boolean) => void;
  onRenamed: (title: string) => void;
  items: ActionMenuItem[];
}) {
  const name = chat.title ?? 'A question';
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!renaming) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft starts from the name each time renaming opens
    setDraft(name);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming, name]);

  if (renaming) {
    const finish = (save: boolean) => {
      const next = chatTitleFrom(draft);
      onRename(false);
      if (save && next && next !== name) onRenamed(next);
    };
    return (
      <li className="rounded-control bg-sunken py-1">
        <InlineInput
          ref={inputRef}
          value={draft}
          maxLength={120}
          aria-label="Name this chat"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              finish(true);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              finish(false);
            }
          }}
          className="min-h-11 border-transparent bg-transparent px-2 hover:bg-transparent focus:border-transparent focus:bg-transparent focus:ring-0 sm:min-h-0"
        />
        <p className="px-2 text-small text-ink-muted">Enter or tap away keeps the name. Esc leaves it as it was.</p>
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={`/chat/dash/${chat.ref}`}
        aria-current={on ? 'page' : undefined}
        title={snippet === undefined ? exactTime(chat.lastAt) : undefined}
        className={cn(
          // Close-set, as Claude's sidebar is (plan #2863); a finger keeps its 44 pixels.
          'flex min-h-11 items-center gap-2.5 rounded-control py-1.5 pl-2 pr-9 transition-colors duration-quick sm:min-h-8',
          snippet !== undefined && 'items-start',
          on ? 'bg-accent-tint' : 'hover:bg-sunken',
        )}
      >
        {/* The name alone in the list, under the day it falls in (plan
            #2863); a found chat carries its day, since the search mixes them. */}
        <span className="block min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-ui', on ? 'font-medium text-accent' : 'text-ink')}>
            {name}
          </span>
          {snippet !== undefined && (
            <time dateTime={chat.lastAt} title={exactTime(chat.lastAt)} className="tabular shrink-0 text-small text-ink-muted">
              {when}
            </time>
          )}
        </span>
        {snippet && (
          <span className="mt-0.5 line-clamp-2 block text-small text-ink-muted">
            <Marked text={snippet} match={match} />
          </span>
        )}
        {snippet !== undefined && chat.archivedAt && (
          <span className="mt-0.5 block text-small text-ink-muted">Archived</span>
        )}
        </span>
      </Link>
      <ActionMenu
        label={`More for ${name}`}
        items={items}
        defaultOpen={menuOpen}
        className={cn(
          'absolute right-0.5 top-1/2 -translate-y-1/2',
          // A pointer that hovers finds it on the row; a finger always sees it.
          !menuOpen &&
            '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:has-[[aria-expanded=true]]:opacity-100 [@media(hover:hover)]:focus-within:opacity-100',
        )}
      />
    </li>
  );
}

export function AskChats({
  chats,
  today,
  made,
  madeFailed = false,
  failed = false,
  presses,
  edits,
  active: activeOverride,
  initialQuery = '',
  initialHits,
  initialArchivedOpen = false,
  initialRenaming = null,
  initialMenu = null,
  sessions = [],
  sessionsFailed = false,
}: {
  chats: readonly AskChat[];
  /** Conversations with Claude Code sessions (plan #2789.7), listed above the chats. */
  sessions?: readonly SessionThread[];
  /** The session threads could not be read: said under their heading. */
  sessionsFailed?: boolean;
  /** Today in the person's timezone, YYYY-MM-DD, for the groups. */
  today: string;
  made: readonly MadeChange[];
  madeFailed?: boolean;
  /** The chats could not be read: said in place of the empty list's line. */
  failed?: boolean;
  presses: ChangePresses;
  edits: ChatEdits;
  /** The open chat's ref, for the gallery; read from the address otherwise. */
  active?: string | null;
  /** For the gallery: a search already typed, and what it found. */
  initialQuery?: string;
  initialHits?: ChatHit[];
  /** For the gallery: Archived drawn open. */
  initialArchivedOpen?: boolean;
  /** For the gallery: the chat being renamed. */
  initialRenaming?: string | null;
  /** For the gallery: the chat whose menu is open. */
  initialMenu?: string | null;
}) {
  const pathname = usePathname();
  const active = activeOverride !== undefined ? activeOverride : openChatRef(pathname ?? '');
  const activeSession = activeOverride !== undefined ? activeOverride : openSessionRef(pathname ?? '');
  const toast = useToast();
  const now = useClockNow();
  const [, startTransition] = useTransition();

  // Each press shows at once; the page's own re-read then catches up.
  const [overrides, setOverrides] = useState<Record<string, Partial<AskChat>>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server's list replaces what was drawn ahead of it
    setOverrides({});
  }, [chats]);
  const all = useMemo(
    () => chats.map((chat) => (overrides[chat.ref] ? { ...chat, ...overrides[chat.ref] } : chat)),
    [chats, overrides],
  );

  const [renaming, setRenaming] = useState<string | null>(initialRenaming);
  const [query, setQuery] = useState(initialQuery);
  // What the server found, kept with the words it was asked for, so a result
  // that comes back after the box has changed is never shown against it.
  const [result, setResult] = useState<{ query: string | null; hits: ChatHit[]; error?: string } | null>(
    initialHits ? { query: chatQuery(initialQuery), hits: initialHits } : null,
  );

  const { listed, archived } = useMemo(() => splitArchived(all), [all]);
  const groups = useMemo(() => groupChats(listed, today), [listed, today]);

  const searching = chatQuery(query);
  const hits = result && result.query === searching ? result.hits : null;
  const searchError = result && result.query === searching ? (result.error ?? null) : null;
  useEffect(() => {
    if (!searching || initialHits) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      void edits.search(searching).then((found) => {
        if (!stale) setResult({ query: searching, hits: found.hits, error: found.error });
      });
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [searching, edits, initialHits]);

  /** The chats the search found: by name here, by what was said on the server. */
  const found = useMemo(() => {
    if (!searching) return [];
    const said = new Map((hits ?? []).map((hit) => [hit.ref, hit.snippet]));
    const lower = searching.toLowerCase();
    return all
      .filter((chat) => said.has(chat.ref) || (chat.title ?? '').toLowerCase().includes(lower))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .map((chat) => ({ chat, snippet: said.get(chat.ref) ?? null }));
  }, [searching, hits, all]);

  function press(ref: string, change: Partial<AskChat>, run: () => ReturnType<ChatEdits['pin']>, done?: string, undo?: () => void) {
    const before = chats.find((chat) => chat.ref === ref);
    setOverrides((current) => ({ ...current, [ref]: { ...current[ref], ...change } }));
    startTransition(async () => {
      const outcome = await run();
      if (!outcome.ok) {
        setOverrides((current) => ({ ...current, [ref]: { ...before } }));
        toast({ text: outcome.error });
      } else if (done) {
        toast({ text: done, undo });
      }
    });
  }

  function itemsFor(chat: AskChat): ActionMenuItem[] {
    const at = new Date().toISOString();
    const name = chat.title ?? 'A question';
    const items: ActionMenuItem[] = [];
    if (!chat.archivedAt) {
      items.push({
        id: 'pin',
        label: chat.pinnedAt ? 'Unpin' : 'Pin to the top',
        onSelect: () => press(chat.ref, { pinnedAt: chat.pinnedAt ? null : at }, () => edits.pin(chat.ref, !chat.pinnedAt)),
      });
    }
    items.push({ id: 'rename', label: 'Rename', onSelect: () => setRenaming(chat.ref) });
    items.push(
      chat.archivedAt
        ? {
            id: 'restore',
            label: 'Put back in the list',
            onSelect: () => press(chat.ref, { archivedAt: null }, () => edits.archive(chat.ref, false)),
          }
        : {
            id: 'archive',
            label: 'Archive',
            onSelect: () =>
              press(
                chat.ref,
                { archivedAt: at, pinnedAt: null },
                () => edits.archive(chat.ref, true),
                `Archived “${name}”. It is under Archived at the foot of the list.`,
                () => press(chat.ref, { archivedAt: null }, () => edits.archive(chat.ref, false)),
              ),
          },
    );
    return items;
  }

  function row(chat: AskChat, when: string, snippet?: string | null) {
    return (
      <ChatRow
        key={chat.id}
        chat={chat}
        on={chat.ref === active}
        when={when}
        snippet={snippet}
        match={searching}
        renaming={renaming === chat.ref}
        menuOpen={initialMenu === chat.ref}
        onRename={(open) => setRenaming(open ? chat.ref : null)}
        onRenamed={(title) => press(chat.ref, { title }, () => edits.rename(chat.ref, title))}
        items={itemsFor(chat)}
      />
    );
  }

  // "3h ago" within the week, then "2 Oct": one short form down the column.
  // commentWhen answers a bare 2026-10-02 past a week, or before the clock is
  // read, and that is drawn as the short day too (plan #2748.1).
  const whenOf = (chat: AskChat) => {
    if (chatGroup(chat.day, today) === 'Earlier') return shortDay(chat.day);
    const since = commentWhen(chat.lastAt, now);
    return since === chat.lastAt.slice(0, 10) ? shortDay(chat.day) : since;
  };

  return (
    // On a phone the list is the page, so it sits on the surface its pane
    // gives it from laptop width (plan #2748.1).
    <div className="space-y-3 rounded-card bg-surface p-2 min-[720px]:rounded-none min-[720px]:bg-transparent min-[720px]:p-0">
      {chats.length > 0 && <ChatSearch value={query} onChange={setQuery} />}

      {!searching && (
        <SessionThreads
          sessions={sessions}
          failed={sessionsFailed}
          active={activeSession}
          whenOf={(at) => {
            const since = commentWhen(at, now);
            return since === at.slice(0, 10) ? shortDay(at.slice(0, 10)) : since;
          }}
        />
      )}

      {chats.length === 0 ? (
        // From laptop width the list has no card of its own (plan #2863), so
        // the line saying it is empty sits on a quiet panel, as on a phone.
        <div className="px-2 min-[720px]:rounded-card min-[720px]:bg-surface min-[720px]:p-3">
          {failed ? (
            <p className="text-ui text-danger">Your chats could not be read. Reload to try again.</p>
          ) : (
            <p className="text-ui text-ink-muted">
              No chats yet. Ask Dash anything about your dashboard and the chat is kept here.
            </p>
          )}
        </div>
      ) : searching ? (
        <section aria-label="Chats found" aria-live="polite" className={cn(cardVariants(), 'p-1.5')}>
          <h3 className="px-2 text-small font-medium text-ink-muted">
            {hits === null ? 'Searching…' : found.length === 1 ? '1 chat' : `${found.length} chats`}
          </h3>
          {searchError && <p className="px-2 text-small text-danger">{searchError}</p>}
          {found.length > 0 ? (
            <ul className="mt-1 space-y-0.5">{found.map(({ chat, snippet }) => row(chat, whenOf(chat), snippet))}</ul>
          ) : (
            hits !== null && <p className="px-2 text-ui text-ink-muted">No chat says “{searching}”.</p>
          )}
        </section>
      ) : (
        <nav aria-label="Chats with Dash" className="space-y-4">
          {groups.map(({ group, chats: inGroup }) => (
            <section key={group} aria-label={group}>
              <h3 className="px-2 text-small font-medium text-ink-muted">{group}</h3>
              <ul className="mt-0.5">{inGroup.map((chat) => row(chat, whenOf(chat)))}</ul>
            </section>
          ))}
          {listed.length === 0 && (
            <p className="px-2 text-ui text-ink-muted">Every chat is archived. They are kept below.</p>
          )}
        </nav>
      )}

      {!searching && archived.length > 0 && (
        <Disclosure
          title={<span className="text-ink-muted">Archived</span>}
          meta={<span className="tabular">{archived.length}</span>}
          defaultOpen={initialArchivedOpen}
          summaryClassName="px-2 text-small font-medium"
        >
          <ul className="mt-0.5">{archived.map((chat) => row(chat, whenOf(chat)))}</ul>
        </Disclosure>
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

      {!searching && sessions.length === 0 && !sessionsFailed && <TalkToASession />}
    </div>
  );
}

/**
 * The threads with Claude Code sessions (plan #2789.7), above the chats with
 * Dash: each under its name, with the project it is on and where it stands,
 * and the way to start one at the head.
 */
function SessionThreads({
  sessions,
  failed,
  active,
  whenOf,
}: {
  sessions: readonly SessionThread[];
  failed: boolean;
  active: string | null;
  whenOf: (at: string) => string;
}) {
  // An empty group is not drawn: with no threads, the way in is the quiet
  // line at the foot of the list (TalkToASession).
  if (sessions.length === 0 && !failed) return null;
  return (
    <section aria-label="Sessions">
      <div className="flex items-center justify-between gap-2 px-2">
        <h3 className="text-small font-medium text-ink-muted">Sessions</h3>
        <Link
          href={newSessionThreadHref()}
          className="inline-flex min-h-11 items-center text-small font-medium text-accent hover:underline sm:min-h-0"
        >
          Talk to a session
        </Link>
      </div>
      {failed ? (
        <p className="px-2 text-small text-danger">Your session threads could not be read. Reload to try again.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {sessions.map((thread) => {
            const on = thread.id === active;
            const word = stateWord(thread.state);
            return (
              <li key={thread.id}>
                <Link
                  href={sessionThreadPath(thread.id)}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'block min-h-11 rounded-control px-2 py-2 transition-colors duration-quick',
                    on ? 'bg-accent-tint' : 'hover:bg-sunken',
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-ui', on ? 'font-medium text-accent' : 'text-ink')}>
                      {thread.title}
                    </span>
                    <time dateTime={thread.lastAt} title={exactTime(thread.lastAt)} className="tabular shrink-0 text-small text-ink-muted">
                      {whenOf(thread.lastAt)}
                    </time>
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-small text-ink-muted">
                    <span className="min-w-0 truncate">{thread.projectLabel}</span>
                    {word && (
                      <span className={cn('shrink-0', thread.state === 'waiting' && 'font-medium text-accent')}>
                        · {word}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** With no session threads yet, the way to start one: one quiet line at the foot of the list. */
function TalkToASession() {
  return (
    <Link
      href={newSessionThreadHref()}
      className="inline-flex min-h-11 items-center gap-1.5 px-2 text-small font-medium text-ink-muted transition-colors duration-quick hover:text-accent sm:min-h-0"
    >
      <SquareTerminal className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      Talk to a session about a project&rsquo;s code
    </Link>
  );
}
