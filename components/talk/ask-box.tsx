'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { chipVariants } from '@/components/ui/chip';
import { ModuleMark } from '@/components/ui/module-mark';
import { menuItemClass, popoverSurface } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import { IconButton } from '@/components/ui/icon-button';
import { useSearchHits } from '@/components/shell/use-search-rows';
import { paletteHits } from '@/lib/search/rank';
import { hitsInScope } from '@/lib/search/scope';
import { MIN_QUERY, type SearchHit } from '@/lib/search/sources';
import { moduleById, type ModuleId } from '@/lib/modules';
import { commandsFor, type BoxTrigger } from '@/lib/talk/box-commands';
import { MAX_MENTIONS, type AskMention } from '@/lib/talk/ask-input';
import type { TalkCitation } from '@/lib/talk/talk';
import type { BoxItem, BoxMenu } from '@/components/thread/thread';

/**
 * What Dash's box adds to the thread's own (plan #1899.5): `@` to add one of
 * your rows for Dash to read, from the search the top bar uses; `/` for the
 * things Dash can already do; and a chip that keeps Dash's lookups to one
 * workspace. AskThread spreads what this returns onto TalkThread, so the
 * sheet and /ask get the same box.
 */

/** The rows added so far, as a question's turn draws them before the server has kept it. */
function asCitations(mentions: readonly AskMention[]): TalkCitation[] {
  return mentions.map((m) => ({ table: m.kind, ref: m.id, title: m.title, href: m.href }));
}

function mentionOf(hit: SearchHit): AskMention {
  return { kind: hit.kind, id: hit.id, title: hit.title, href: hit.href };
}

/** How the box starts, for the gallery. */
export type AskBoxStart = { rows?: readonly AskMention[]; scope?: ModuleId | null; scopeOpen?: boolean };

/** What a question takes from the box when it is sent. */
export type AskBoxSent = { rows: AskMention[]; scope: ModuleId | null };

export function useAskBox({
  account,
  workspaces,
  fixtureHits,
  start,
}: {
  /** For the gallery: rows already added, a workspace already chosen, its menu open. */
  start?: AskBoxStart;
  /** Whose rows @ searches; without one, @ offers nothing. */
  account?: string;
  /** The workspaces the chip offers and the commands are kept to. */
  workspaces?: readonly ModuleId[];
  /** For the gallery: the rows @ searches in place of the account's. */
  fixtureHits?: readonly SearchHit[];
}) {
  const [trigger, setTrigger] = useState<BoxTrigger | null>(null);
  const [mentions, setMentions] = useState<AskMention[]>(() => [...(start?.rows ?? [])]);
  const [scope, setScope] = useState<ModuleId | null>(start?.scope ?? null);
  const taken = useRef<AskMention[]>([]);
  const searchScope = scope ?? 'everything';
  const needle = trigger?.kind === 'row' ? trigger.query.trim() : '';
  const live = useSearchHits({
    account: account ?? '',
    scope: searchScope,
    query: needle,
    active: trigger?.kind === 'row' && Boolean(account) && !fixtureHits,
  });
  const hits = useMemo(() => {
    if (trigger?.kind !== 'row' || needle.length < MIN_QUERY) return [];
    const found = fixtureHits ? paletteHits(hitsInScope([...fixtureHits], searchScope), needle) : live.hits;
    return found.filter((hit) => !mentions.some((m) => m.kind === hit.kind && m.id === hit.id)).slice(0, 8);
  }, [trigger, needle, fixtureHits, searchScope, live.hits, mentions]);

  const menu = useMemo<BoxMenu | null>(() => {
    if (!trigger) return null;
    if (trigger.kind === 'command') {
      return {
        label: 'Things Dash can do',
        empty: 'No command starts with that.',
        items: commandsFor(trigger.query, workspaces).map<BoxItem>((command) => ({
          key: command.name,
          label: `/${command.name}`,
          hint: command.says,
          mark: <ModuleMark module={command.module} size="xs" />,
          insert: command.opens,
        })),
      };
    }
    if (!account && !fixtureHits) return null;
    const full = mentions.length >= MAX_MENTIONS;
    return {
      label: 'Add a row for Dash to read',
      empty: full
        ? `A question takes ${MAX_MENTIONS} rows at most.`
        : needle.length < MIN_QUERY
          ? 'Type a name to find one of your rows.'
          : live.looking && !fixtureHits
            ? 'Looking…'
            : `Nothing of yours is called “${needle}”.`,
      items: full
        ? []
        : hits.map<BoxItem>((hit) => ({
            key: `${hit.kind}:${hit.id}`,
            label: hit.title,
            hint: hit.subtitle,
            mark: <ModuleMark module={hit.module} size="xs" />,
            insert: '',
            onPick: () => setMentions((current) => [...current, mentionOf(hit)]),
          })),
    };
  }, [trigger, workspaces, account, fixtureHits, mentions.length, needle, live.looking, hits]);

  const attached =
    mentions.length > 0 ? (
      <ul className="flex flex-wrap gap-1 pb-1" aria-label="Rows Dash will read">
        {mentions.map((m) => (
          <li key={`${m.kind}:${m.id}`} className={cn(chipVariants({ tone: 'accent' }), 'max-w-full gap-0.5 pr-0.5')}>
            <span className="min-w-0 truncate">@{m.title}</span>
            <Tooltip label="Take it off the question">
              <IconButton
                size="sm"
                label={`Remove ${m.title}`}
                onClick={() => setMentions((current) => current.filter((c) => c !== m))}
                className="size-4 rounded-pill text-accent hover:bg-accent/15 hover:text-accent [&_svg]:size-3"
              >
                <X strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
          </li>
        ))}
      </ul>
    ) : null;

  const boxStart =
    workspaces && workspaces.length > 1 ? <ScopeChip scope={scope} workspaces={workspaces} onScope={setScope} initialOpen={start?.scopeOpen} /> : null;

  return {
    /** For TalkThread. */
    thread: {
      onTrigger: setTrigger,
      menu,
      attached,
      boxStart,
      questionCitations: asCitations(mentions),
    },
    /** What a question sent now carries; the rows are taken off the box. */
    take: (): AskBoxSent => {
      const sent = { rows: mentions, scope };
      taken.current = mentions;
      setMentions([]);
      return sent;
    },
    /** Puts the rows last taken back on the box, for a question that was not kept. */
    restore: () => {
      const rows = taken.current;
      taken.current = [];
      if (rows.length > 0) setMentions((current) => (current.length > 0 ? current : rows));
    },
  };
}

/**
 * The chip in the box's foot that keeps Dash's lookups to one workspace
 * (plan #1899.5): "Everything" until one is chosen, then that workspace's
 * name. The menu opens upwards, since the box sits at the foot of the chat.
 */
function ScopeChip({
  scope,
  workspaces,
  onScope,
  initialOpen = false,
}: {
  initialOpen?: boolean;
  scope: ModuleId | null;
  workspaces: readonly ModuleId[];
  onScope: (scope: ModuleId | null) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const label = scope ? (moduleById(scope)?.label ?? 'Everything') : 'Everything';
  const choices: (ModuleId | null)[] = [null, ...workspaces];
  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Dash looks in: ${label}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={cn(
          chipVariants({ tone: scope ? 'accent' : 'neutral' }),
          'press-area max-w-full hover:text-ink',
        )}
      >
        {scope && <ModuleMark module={scope} size="xs" className="-ml-1" />}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Dash looks in"
          className={cn(popoverSurface, 'absolute bottom-full left-0 z-overlay mb-1.5 w-56 p-1')}
        >
          <p className="px-2.5 pb-0.5 pt-1 text-small text-ink-muted">Dash looks in</p>
          {choices.map((choice) => {
            const on = choice === scope;
            return (
              <button
                key={choice ?? 'everything'}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onScope(choice);
                  setOpen(false);
                }}
                className={cn(menuItemClass(), 'min-h-11 sm:min-h-0')}
              >
                <ModuleMark module={choice} size="xs" />
                <span className="min-w-0 flex-1 truncate">
                  {choice ? (moduleById(choice)?.label ?? choice) : 'Everything'}
                </span>
                {on && <Check className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
