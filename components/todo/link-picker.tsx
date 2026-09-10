'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePopover } from '@/lib/use-popover';
import { HIT_KINDS, MIN_QUERY, type SearchHit } from '@/lib/search/sources';
import { targetForHit } from '@/lib/todo/links/from-hit';
import type { LinkTarget } from '@/lib/todo/links/model';
import type { ModuleId } from '@/lib/modules';
import { ModuleMark } from '@/components/ui/module-mark';
import { popoverSurface } from '@/components/ui/popover';

/**
 * What a task is about, found by typing.
 *
 * The same search the command palette runs, narrowed by the endpoint to the
 * kinds a task can point at, in a control small enough to sit beside a one
 * line form. It finds a thing and hands back which thing it is; writing the
 * link is the caller's, which is what lets the add form and a task's own row
 * share one control instead of growing two.
 *
 * The hard parts were solved next door in components/shell/command-palette.tsx
 * and are solved the same way here on purpose: debounce, abort the request the
 * next keystroke made stale, keep the rows already on screen while a newer
 * answer lands, and carry the ModuleMark on every row so two things with the
 * same name can be told apart.
 */

/** A thing chosen, in the terms a link is written in. */
export type LinkChoice = {
  target: LinkTarget;
  targetId: string;
  /** What to show on the chip. The picker never looks this up again. */
  label: string;
  module: ModuleId;
};

export function LinkPicker({
  value,
  onChange,
  name = 'linkTarget',
  idName = 'linkTargetId',
}: {
  value: LinkChoice | null;
  onChange: (choice: LinkChoice | null) => void;
  /** The form field the target goes in, for a caller that submits a form. */
  name?: string;
  idName?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  return (
    <div className="relative">
      {/* The answer travels with the form rather than through a second piece
          of state at the caller: a picker beside a title field is submitted
          with it or not at all. */}
      <input type="hidden" name={name} value={value?.target ?? ''} />
      <input type="hidden" name={idName} value={value?.targetId ?? ''} />

      {value ? (
        // The chip is the trigger as well, so picking something does not take
        // the control away from a keyboard: focus returns to a button that is
        // still there, and changing your mind is the same click as making it.
        <span className="inline-flex max-w-xs items-center gap-1.5 rounded-full bg-sunken py-1 pl-2 pr-1 text-small text-ink">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((on) => !on)}
            aria-expanded={open}
            title="Change what this is about"
            className="flex min-w-0 items-center gap-1.5"
          >
            <ModuleMark module={value.module} size="sm" />
            <span className="min-w-0 truncate">{value.label}</span>
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Not about this"
            className="press flex size-5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-accent-tint hover:text-accent"
          >
            <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">Not about this</span>
          </button>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((on) => !on)}
          aria-expanded={open}
          className="press inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-medium text-ink-muted transition-colors duration-150 hover:bg-accent-tint hover:text-accent"
        >
          <Link2 className="size-3.5" strokeWidth={1.75} aria-hidden />
          Link
        </button>
      )}

      {open && (
        <LinkFinder
          ref={panelRef}
          onPick={(choice) => {
            onChange(choice);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The list itself, exported for a caller that wants the search without the
 * chip -- a task row, which already draws its anchor and only needs somewhere
 * to pick a new one.
 *
 * A separate component so that closing it throws the query and the last answer
 * away: a picker reopened a minute later showing what you typed a minute ago
 * is showing something that may no longer exist.
 */
export function LinkFinder({
  ref,
  onPick,
  align = 'left',
}: {
  ref: React.Ref<HTMLDivElement>;
  onPick: (choice: LinkChoice) => void;
  /** Which edge of the trigger it hangs from. Right, at the end of a row. */
  align?: 'left' | 'right';
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /**
   * The last answer and the query it answered, kept together so "is something
   * still on its way" is derived rather than stored. It is also what stops a
   * slow answer to an earlier query replacing a newer one: the answer carries
   * the query it belongs to, and anything but the current one is ignored.
   */
  const [answer, setAnswer] = useState<{ query: string; hits: SearchHit[] } | null>(null);

  const needle = query.trim();
  const searching = needle.length >= MIN_QUERY;
  const looking = searching && answer?.query !== needle;

  // Stale rows stay on screen while a newer answer is on its way, so the list
  // does not jump under the cursor on every keystroke.
  const hits = useMemo<SearchHit[]>(
    () => (searching ? (answer?.hits ?? []) : []),
    [searching, answer],
  );

  useEffect(() => {
    if (!searching) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(needle)}&for=link`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { hits: [] }))
        .then((body: { hits?: SearchHit[] }) => setAnswer({ query: needle, hits: body.hits ?? [] }))
        .catch(() => {
          // An aborted request is the normal case rather than a failure -- the
          // next keystroke cancelled it -- and a workspace that is down is not
          // this control's news to break. Either way the field still works.
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, searching]);

  function choose(hit: SearchHit | undefined) {
    if (!hit) return;
    const target = targetForHit(hit);
    // Belt and braces: the endpoint already refuses to return a kind a task
    // cannot point at, and a row that could not be chosen must not be
    // choosable if that ever changes.
    if (!target) return;
    onPick({ target, targetId: hit.id, label: hit.title, module: hit.module });
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="What is this about?"
      className={cn(
        popoverSurface,
        'absolute top-full z-overlay mt-1.5 w-72 overflow-hidden',
        align === 'right' ? 'right-0' : 'left-0',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5">
        <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => (index + 1) % Math.max(hits.length, 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => (index - 1 + hits.length) % Math.max(hits.length, 1));
            } else if (event.key === 'Enter') {
              // Never a submit: this control usually sits inside somebody
              // else's form, and Enter here means "that one".
              event.preventDefault();
              choose(hits[active]);
            }
          }}
          placeholder="What is this about?"
          aria-label="What is this about?"
          data-focus-ring="none"
          className="h-10 w-full bg-transparent text-ui text-ink outline-none placeholder:text-ink-ghost"
        />
      </div>

      <div className="max-h-64 overflow-y-auto p-1">
        {hits.length === 0 ? (
          <p className="px-2.5 py-4 text-center text-small text-ink-muted">
            {/* Nothing is said about a query too short to ask about, and
                "nothing matches" is not said while an answer is still out. */}
            {!searching ? 'Type a few letters.' : looking ? 'Looking…' : `Nothing matches “${needle}”.`}
          </p>
        ) : (
          hits.map((hit, index) => (
            <button
              key={`${hit.kind}:${hit.id}`}
              type="button"
              onClick={() => choose(hit)}
              onMouseMove={() => setActive(index)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors',
                index === active ? 'bg-accent-tint' : 'hover:bg-sunken',
              )}
            >
              <ModuleMark module={hit.module} size="sm" />
              <span className="min-w-0 flex-1 truncate text-ui text-ink">{hit.title}</span>
              {/* What kind of thing it is, always: two things with the same
                  name in the same workspace are told apart by nothing else. */}
              <span className="shrink-0 text-small text-ink-muted">{HIT_KINDS[hit.kind]}</span>
            </button>
          ))
        )}

        {looking && hits.length > 0 && (
          <p className="px-2.5 py-1.5 text-small text-ink-ghost">Looking…</p>
        )}
      </div>
    </div>
  );
}
