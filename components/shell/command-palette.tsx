'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Palette, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { score } from '@/lib/search/score';
import { HIT_KINDS, MIN_QUERY, type SearchHit } from '@/lib/search/sources';
import { ModuleMark } from '@/components/ui/module-mark';
import { popoverSurface, scrim } from '@/components/ui/popover';
import { Kbd } from '@/components/shell/key-hints';
import { useCapture } from '@/components/shell/capture';
import { matchCaptureActions } from '@/lib/capture/actions';
import { setTheme } from '@/app/theme-actions';
import { MODULES, type ModuleId } from '@/lib/modules';
import { formatTheme, hueOf, modeOf, THEME_COLOURS, type Theme } from '@/lib/theme';
import { applyTheme } from '@/lib/theme/apply';
import type { NavSection } from '@/components/shell/app-shell';

/**
 * Go anywhere, from anywhere.
 *
 * In a four-workspace app the most repeated action is "get me to the other
 * thing", and it otherwise costs a click into the switcher, a read, and a
 * second click. This is one keystroke and a few letters.
 *
 * Two halves in one box. The places you can go -- workspaces, the sections of
 * the one you are in, the themes -- and the things you own: a company, a role,
 * an order, something on a shelf, a todo, a note, a reading.
 *
 * They share a list rather than sitting in sections under each other, which
 * was decided on the feature. The argument for one list is that you are
 * looking for a thing rather than for a kind of thing, and two lists make you
 * decide which half your quarry is in before you have found it. What keeps
 * that legible is the mark: every row carries the ModuleMark of where it lives,
 * so "which of these is the shopping one" is answered without a label.
 *
 * The navigation half is synchronous and always right. The data half is a
 * fetch, so it arrives later, cannot arrive at all when a workspace is down,
 * and must never hold the first half up: with no query typed this is exactly
 * what it was before any of it existed.
 */

/** A row in the one list: somewhere to go, or something you own. */
type Row = { kind: 'command'; command: Command } | { kind: 'hit'; hit: SearchHit };

type Command = {
  id: string;
  label: string;
  hint?: string;
  module?: ModuleId | null;
  icon?: 'theme';
  run: () => void;
};


/** Applying a theme from the palette: the document first, the account behind it. */
function applying(next: Theme): Command['run'] {
  return () => {
    applyTheme(document.documentElement, next);
    void setTheme(formatTheme(next));
  };
}

/**
 * The theme commands, built from what is on screen.
 *
 * A colour is applied to the polarity you are already in, which is what makes
 * "Theme: Green" one command rather than two: the switch and the swatches are
 * separate choices in the picker and they stay separate here.
 */
function themeCommands(theme: Theme): Command[] {
  const mode = modeOf(theme);
  const hue = hueOf(theme);

  return [
    ...(['light', 'dark'] as const).map((option) => ({
      id: `theme:${option}`,
      label: `Theme: ${option === 'light' ? 'Light' : 'Dark'}`,
      hint: 'Keeps the colour you are in',
      icon: 'theme' as const,
      run: applying({ kind: 'generated', mode: option, hue }),
    })),
    ...THEME_COLOURS.map((colour) => ({
      id: `theme:${colour.id}`,
      label: `Theme: ${colour.label}`,
      hint: mode === 'light' ? 'Light' : 'Dark',
      icon: 'theme' as const,
      run: applying({ kind: 'generated', mode, hue: colour.hue }),
    })),
    {
      id: 'theme:none',
      label: 'Theme: no colour',
      hint: mode === 'light' ? 'Paper' : 'Ink',
      icon: 'theme' as const,
      run: applying({ kind: 'generated', mode, hue: null }),
    },
    {
      id: 'theme:lightbox',
      label: 'Theme: Lightbox',
      hint: 'Lit sheets, blue-black bench',
      icon: 'theme' as const,
      run: applying({ kind: 'written', id: 'lightbox' }),
    },
    {
      id: 'theme:system',
      label: 'Theme: follow the system',
      icon: 'theme' as const,
      run: applying({ kind: 'system' }),
    },
  ];
}

export function CommandPalette({
  module,
  sections,
  enabledModules,
  theme,
}: {
  module: ModuleId | null;
  sections: readonly NavSection[];
  enabledModules?: readonly ModuleId[];
  /** What is on screen now, so a colour can be applied to the mode you are in. */
  theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /**
   * The last answer, and which query it answered.
   *
   * Kept together so both "what to show" and "is something still on its way"
   * are derived rather than stored: an effect that clears state on its way to
   * fetching causes a render for every keystroke, and the rows would blink.
   */
  const [answer, setAnswer] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const router = useRouter();
  const { open: openCapture } = useCapture();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const visible = MODULES.filter(
      (entry) => enabledModules === undefined || enabledModules.includes(entry.id),
    );

    return [
      ...sections.map((section) => ({
        id: `section:${section.href}`,
        label: section.label,
        hint: 'Go to',
        module,
        run: () => router.push(section.href),
      })),
      {
        id: 'workspace:home',
        label: 'Home',
        hint: 'Workspace',
        module: null,
        run: () => router.push('/home'),
      },
      ...visible
        .filter((entry) => entry.id !== module)
        .map((entry) => ({
          id: `workspace:${entry.id}`,
          label: entry.label,
          hint: 'Workspace',
          module: entry.id as ModuleId,
          run: () => router.push(entry.home),
        })),
      {
        id: 'go:account',
        label: 'Account',
        hint: 'Go to',
        module: null,
        run: () => router.push('/account'),
      },
      // The same set the picker offers, one command per control: the two
      // polarities, the five colours applied to whichever polarity you are in,
      // Lightbox, and following the system. A command per combination would be
      // twelve rows of theme in a list you came to for something else.
      ...themeCommands(theme),
    ];
  }, [sections, module, enabledModules, router, theme]);

  /**
   * The things you can make, when what you typed names one.
   *
   * This is the palette's half of capture: it is the picker, and choosing a
   * row here files nothing at all -- it opens the capture panel with whatever
   * else you typed already in the field, and Enter *there* is what writes the
   * task. So "add todo" and Enter gets you an empty panel to dictate into, and
   * "add todo ring the dentist" gets you one with the todo in it.
   *
   * Ranked against the action's own words rather than the whole query, for the
   * reason in lib/capture/actions.ts, and then sorted in with everything else
   * on the same points, so a workspace called Todo still wins on "todo".
   */
  const captures = useMemo(
    () =>
      matchCaptureActions(query).map(({ action, points, seed }) => ({
        points,
        command: {
          id: `capture:${action.id}`,
          label: action.label,
          hint: seed || 'Capture',
          module: action.module,
          run: () => openCapture(action.id, seed),
        } satisfies Command,
      })),
    [query, openCapture],
  );

  const matches = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 8);
    return [
      ...captures,
      ...commands
        .map((command) => ({
          command,
          points: score(`${command.label} ${command.hint ?? ''}`, query.trim()),
        }))
        .filter((entry): entry is { command: Command; points: number } => entry.points !== null),
    ]
      .sort((a, b) => b.points - a.points)
      .slice(0, 8)
      .map((entry) => entry.command);
  }, [captures, commands, query]);

  /**
   * Ask, once the typing settles.
   *
   * Debounced, and every request aborts the one before it -- which is why the
   * endpoint is a route handler rather than a server action. Without the
   * abort, a slow answer to "ac" lands after the answer to "acme" and replaces
   * it with staler results, which is the one bug that makes a palette feel
   * broken rather than slow.
   *
   * The rows already on screen stay put while a newer answer is on its way.
   * Clearing them first would make the list jump on every keystroke, and a
   * list that moves under the cursor is worse than one that is briefly stale.
   */
  const needle = query.trim();
  const searching = open && needle.length >= MIN_QUERY;

  // Stale rows stay on screen while a newer answer is on its way: clearing
  // them first would make the list jump on every keystroke, and a list that
  // moves under the cursor is worse than one that is briefly behind.
  const hits = useMemo<SearchHit[]>(
    () => (searching ? (answer?.hits ?? []) : []),
    [searching, answer],
  );
  const looking = searching && answer?.query !== needle;

  useEffect(() => {
    if (!searching) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { hits: [] }))
        .then((body: { hits?: SearchHit[] }) => setAnswer({ query: needle, hits: body.hits ?? [] }))
        .catch(() => {
          // An aborted request is the normal case rather than a failure: the
          // next keystroke cancelled it. Either way the palette keeps working,
          // because the navigation half never depended on this.
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, searching]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  /**
   * One list. Commands first, then the things you own.
   *
   * The commands are already ranked against the query by the same scorer the
   * server ranks hits with, so the two halves are ordered on the same terms;
   * putting the navigation half first is the tie-break, because it is the half
   * that is always right and always instant.
   */
  const rows = useMemo<Row[]>(
    () => [
      ...matches.map((command) => ({ kind: 'command' as const, command })),
      ...hits.map((hit) => ({ kind: 'hit' as const, hit })),
    ],
    [matches, hits],
  );

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
    setAnswer(null);
  }

  function choose(row: Row | undefined) {
    if (!row) return;
    close();
    if (row.kind === 'command') row.command.run();
    else router.push(row.hit.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className={scrim}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        // The same floating surface as every panel in the shell, lifted
        // further: this one is over a scrim at a twelfth of the way down the
        // window rather than hanging off a button, and a shallow drop there
        // reads as a card that has come loose rather than as a thing in front.
        className={cn(popoverSurface, 'relative w-full max-w-lg overflow-hidden shadow-2xl')}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => (index + 1) % Math.max(rows.length, 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => (index - 1 + rows.length) % Math.max(rows.length, 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(rows[active]);
              }
            }}
            placeholder="Go anywhere, or find anything…"
            aria-label="Command"
            // No focus ring: the palette focuses this field on open, so the
            // global ring was drawn around the search bar permanently rather
            // than ever indicating anything. See globals.css.
            data-focus-ring="none"
            className="h-12 w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-ghost"
          />
          {/* The shell's keycap, not a second drawing of one: this was a
              hairline bigger and a step up the type scale from every other
              cap in the app, which is visible the moment the palette opens
              over a row of them. `always`, because inside an open palette
              there is no modifier being held. */}
          <Kbd always>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui text-ink-muted">
              {/* Only once looking has finished. "Nothing matches" while a
                  request is still out is a lie that corrects itself, which is
                  the most annoying kind. */}
              {looking ? 'Looking…' : `Nothing matches “${query}”.`}
            </p>
          ) : (
            rows.map((row, index) => {
              const key = row.kind === 'command' ? row.command.id : `hit:${row.hit.kind}:${row.hit.id}`;
              const label = row.kind === 'command' ? row.command.label : row.hit.title;
              const hint =
                row.kind === 'command'
                  ? row.command.hint
                  : (row.hit.subtitle ?? HIT_KINDS[row.hit.kind]);
              const where = row.kind === 'command' ? (row.command.module ?? null) : row.hit.module;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => choose(row)}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors',
                    index === active ? 'bg-accent-tint' : 'hover:bg-sunken',
                  )}
                >
                  {row.kind === 'command' && row.command.icon === 'theme' ? (
                    <Palette className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                  ) : (
                    // The mark of wherever it lives, so which workspace a row
                    // belongs to is readable without a label.
                    <ModuleMark module={where} size="sm" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{label}</span>
                  {hint && <span className="shrink-0 truncate text-small text-ink-muted">{hint}</span>}
                  {index === active && (
                    <CornerDownLeft className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
                  )}
                </button>
              );
            })
          )}

          {/* Quiet, and below the rows rather than in place of them, so
              nothing already on screen moves while a newer answer lands. */}
          {looking && rows.length > 0 && (
            <p className="px-3 py-1.5 text-small text-ink-ghost">Looking…</p>
          )}
        </div>
      </div>
    </div>
  );
}
