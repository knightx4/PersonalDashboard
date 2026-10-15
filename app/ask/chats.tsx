'use client';

import { whenDate } from '@/lib/core/when';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { Search, SquarePen, X } from 'lucide-react';
import Link from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { ToggleChip, toggleChipClass } from '@/components/ui/chip';
import { Disclosure } from '@/components/ui/disclosure';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Input, InlineInput } from '@/components/ui/field';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { ModuleMark } from '@/components/ui/module-mark';
import { useToast } from '@/components/ui/toast';
import { MadeChanges } from '@/components/talk/made-changes';
import type { ChangePresses } from '@/components/talk/dash-changes';
import { cn } from '@/lib/cn';
import { commentWhen, exactTime } from '@/lib/comments/when';
import { moduleById, type ModuleId } from '@/lib/modules';
import {
  chatChips,
  chatGroup,
  chatQuery,
  chatTitleFrom,
  chipsThatFit,
  groupChats,
  splitArchived,
  type AskChat,
} from '@/lib/talk/ask-chats';
import type { MadeChange } from '@/lib/talk/changes';
import { useClockNow } from '@/lib/use-clock-now';

/**
 * The list of Dash's chats beside the open one on /ask (plan #1899.2): New
 * chat, the search box, the workspace chips that narrow the list, then the
 * chats grouped Pinned, Today, Yesterday, This week and Earlier. Each chat
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

/** The ref of the chat open at this address, or null on /ask itself. */
export function openChatRef(pathname: string): string | null {
  const match = pathname.match(/^\/ask\/([^/?#]+)/);
  return match ? match[1] : null;
}

/** The gap between chips, in pixels: Tailwind's gap-1.5. */
const CHIP_GAP = 6;

/**
 * The workspace chips, as many as fit whole on the one line, then a More
 * chip holding the rest. Every chip is measured once in a hidden copy of the
 * row, and the line is re-counted whenever its width changes.
 */
function WorkspaceChips({
  chips,
  only,
  onPick,
}: {
  chips: ModuleId[];
  only: ModuleId | null;
  onPick: (id: ModuleId | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(chips.length);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const count = () => {
      const widths = [...measure.children].map((child) => (child as HTMLElement).offsetWidth);
      const more = widths.pop() ?? 0;
      setFit(chipsThatFit(widths, row.clientWidth, more, CHIP_GAP));
    };
    count();
    const observer = new ResizeObserver(count);
    observer.observe(row);
    return () => observer.disconnect();
  }, [chips]);

  const shown = chips.slice(0, fit);
  const rest = chips.slice(fit);
  const pickedInRest = only !== null && rest.includes(only);

  const chip = (id: ModuleId) => (
    <>
      <WorkspaceDot id={id} className="size-2" />
      {moduleById(id)?.label}
    </>
  );

  return (
    <div className="relative">
      <div ref={rowRef} role="group" aria-label="Show chats that used" className="flex gap-1.5 overflow-hidden">
        {shown.map((id) => (
          <ToggleChip key={id} on={only === id} onClick={() => onPick(only === id ? null : id)}>
            {chip(id)}
          </ToggleChip>
        ))}
        {rest.length > 0 && (
          <ActionMenu
            label="More workspaces"
            align="start"
            trigger={pickedInRest ? chip(only) : <span>More</span>}
            triggerClassName={cn(toggleChipClass(pickedInRest), 'w-auto')}
            items={rest.map((id) => ({
              id,
              label: only === id ? `${moduleById(id)?.label}, shown` : (moduleById(id)?.label ?? id),
              onSelect: () => onPick(only === id ? null : id),
            }))}
          />
        )}
      </div>
      {/* Every chip at its own width, and More last, for counting what fits. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex w-0 gap-1.5 overflow-hidden">
        {chips.map((id) => (
          <span key={id} className={toggleChipClass(false)}>
            {chip(id)}
          </span>
        ))}
        <span className={toggleChipClass(false)}>More</span>
      </div>
    </div>
  );
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
        href={`/ask/${chat.ref}`}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-start gap-2.5 rounded-control py-2 pl-2 pr-9 transition-colors duration-quick',
          on ? 'bg-accent-tint' : 'hover:bg-sunken',
        )}
      >
        {/* The first workspace the chat used, or Dash's own mark for one
            that used none, so a chat is found by its look before its name. */}
        <ModuleMark module={chat.workspaces[0] ?? 'dash'} size="sm" className="mt-px" />
        <span className="block min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-ui', on ? 'font-medium text-accent' : 'text-ink')}>
            {name}
          </span>
          <time dateTime={chat.lastAt} title={exactTime(chat.lastAt)} className="tabular shrink-0 text-small text-ink-muted">
            {when}
          </time>
        </span>
        {snippet && (
          <span className="mt-0.5 line-clamp-2 block text-small text-ink-muted">
            <Marked text={snippet} match={match} />
          </span>
        )}
        {(chat.workspaces.length > 0 || (snippet !== undefined && chat.archivedAt)) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-ink-muted">
            {snippet !== undefined && chat.archivedAt && <span>Archived</span>}
            {chat.workspaces.map((id) => (
              <span key={id} className="inline-flex items-center gap-1">
                <WorkspaceDot id={id} />
                {moduleById(id)?.label}
              </span>
            ))}
          </span>
        )}
        </span>
      </Link>
      <ActionMenu
        label={`More for ${name}`}
        items={items}
        defaultOpen={menuOpen}
        className={cn(
          'absolute right-0.5 top-1.5',
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
  presses,
  edits,
  active: activeOverride,
  initialQuery = '',
  initialHits,
  initialArchivedOpen = false,
  initialRenaming = null,
  initialMenu = null,
}: {
  chats: readonly AskChat[];
  /** Today in the person's timezone, YYYY-MM-DD, for the groups. */
  today: string;
  made: readonly MadeChange[];
  madeFailed?: boolean;
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

  const [only, setOnly] = useState<ModuleId | null>(null);
  const [renaming, setRenaming] = useState<string | null>(initialRenaming);
  const [query, setQuery] = useState(initialQuery);
  // What the server found, kept with the words it was asked for, so a result
  // that comes back after the box has changed is never shown against it.
  const [result, setResult] = useState<{ query: string | null; hits: ChatHit[]; error?: string } | null>(
    initialHits ? { query: chatQuery(initialQuery), hits: initialHits } : null,
  );

  const { listed, archived } = useMemo(() => splitArchived(all), [all]);
  const chips = useMemo(() => chatChips(listed), [listed]);
  const narrowed = (list: AskChat[]) => (only ? list.filter((chat) => chat.workspaces.includes(only)) : list);
  const groups = useMemo(() => groupChats(narrowed(listed), today), [listed, today, only]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return narrowed(all)
      .filter((chat) => said.has(chat.ref) || (chat.title ?? '').toLowerCase().includes(lower))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .map((chat) => ({ chat, snippet: said.get(chat.ref) ?? null }));
  }, [searching, hits, all, only]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const whenOf = (chat: AskChat) =>
    chatGroup(chat.day, today) === 'Earlier' ? shortDay(chat.day) : commentWhen(chat.lastAt, now);

  return (
    <div className="space-y-3">
      <Link href="/ask" className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-start border-border')}>
        <SquarePen strokeWidth={1.75} aria-hidden />
        New chat
      </Link>

      {chats.length > 0 && <ChatSearch value={query} onChange={setQuery} />}

      {chips.length > 1 && <WorkspaceChips chips={chips} only={only} onPick={setOnly} />}

      {chats.length === 0 ? (
        <p className="text-ui text-ink-muted">
          No chats yet. Ask Dash anything about your dashboard and the chat is kept here.
        </p>
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
        <nav aria-label="Chats with Dash" className="space-y-3">
          {groups.map(({ group, chats: inGroup }) => (
            <section key={group} aria-label={group}>
              <h3 className="px-2 text-small font-medium text-ink-muted">{group}</h3>
              <ul className="mt-1 space-y-0.5">{inGroup.map((chat) => row(chat, whenOf(chat)))}</ul>
            </section>
          ))}
          {groups.length === 0 && listed.length > 0 && (
            <p className="px-2 text-ui text-ink-muted">No chat used {moduleById(only)?.label} yet.</p>
          )}
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
          <ul className="mt-1 space-y-0.5">{narrowed(archived).map((chat) => row(chat, whenOf(chat)))}</ul>
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
    </div>
  );
}
