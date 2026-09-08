'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Palette, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ModuleMark } from '@/components/ui/module-mark';
import { setTheme } from '@/app/theme-actions';
import { MODULES, type ModuleId } from '@/lib/modules';
import { THEMES } from '@/lib/theme';
import type { NavSection } from '@/components/shell/app-shell';

/**
 * Go anywhere, from anywhere.
 *
 * In a four-workspace app the most repeated action is "get me to the other
 * thing", and it otherwise costs a click into the switcher, a read, and a
 * second click. This is one keystroke and a few letters.
 *
 * Deliberately not a search over your data -- that is the page's own field,
 * and conflating "where do I go" with "what do I own" makes a palette that
 * answers neither well. This is navigation and preferences: workspaces, the
 * sections of the one you are in, and the themes.
 */

type Command = {
  id: string;
  label: string;
  hint?: string;
  module?: ModuleId | null;
  icon?: 'theme';
  run: () => void;
};

/**
 * Subsequence match, not substring: "jbp" finds "Job search · Pipeline".
 *
 * Ranked so that a match at the start of a word beats one in the middle, which
 * is what makes two letters usually enough.
 */
function score(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const target = haystack.toLowerCase();
  const query = needle.toLowerCase();

  let position = 0;
  let points = 0;
  for (const character of query) {
    const found = target.indexOf(character, position);
    if (found === -1) return null;
    const atWordStart = found === 0 || target[found - 1] === ' ' || target[found - 1] === '·';
    points += atWordStart ? 3 : 1;
    if (found === position) points += 1;
    position = found + 1;
  }
  return points;
}

export function CommandPalette({
  module,
  sections,
  enabledModules,
}: {
  module: ModuleId | null;
  sections: readonly NavSection[];
  enabledModules?: readonly ModuleId[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const router = useRouter();
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
      ...THEMES.map((theme) => ({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.label}`,
        hint: theme.mood,
        icon: 'theme' as const,
        run: () => {
          document.documentElement.setAttribute('data-theme', theme.id);
          void setTheme(theme.id);
        },
      })),
      {
        id: 'theme:system',
        label: 'Theme: follow the system',
        icon: 'theme' as const,
        run: () => {
          document.documentElement.removeAttribute('data-theme');
          void setTheme(null);
        },
      },
    ];
  }, [sections, module, enabledModules, router]);

  const matches = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 8);
    return commands
      .map((command) => ({
        command,
        points: score(`${command.label} ${command.hint ?? ''}`, query.trim()),
      }))
      .filter((entry): entry is { command: Command; points: number } => entry.points !== null)
      .sort((a, b) => b.points - a.points)
      .slice(0, 8)
      .map((entry) => entry.command);
  }, [commands, query]);

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

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  function choose(command: Command | undefined) {
    if (!command) return;
    close();
    command.run();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg overflow-hidden rounded-card border border-border bg-raised shadow-2xl"
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
                setActive((index) => (index + 1) % Math.max(matches.length, 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => (index - 1 + matches.length) % Math.max(matches.length, 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(matches[active]);
              }
            }}
            placeholder="Go to a workspace, a section, or a theme…"
            aria-label="Command"
            className="h-12 w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-ghost"
          />
          <kbd className="shrink-0 rounded border border-border-strong border-b-2 px-1.5 py-0.5 font-mono text-small text-ink-muted">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui text-ink-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            matches.map((command, index) => (
              <button
                key={command.id}
                type="button"
                onClick={() => choose(command)}
                onMouseMove={() => setActive(index)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  index === active ? 'bg-accent-tint' : 'hover:bg-sunken',
                )}
              >
                {command.icon === 'theme' ? (
                  <Palette className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                ) : (
                  <ModuleMark module={command.module ?? null} size="sm" />
                )}
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
                  {command.label}
                </span>
                {command.hint && (
                  <span className="shrink-0 text-small text-ink-muted">{command.hint}</span>
                )}
                {index === active && (
                  <CornerDownLeft className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
