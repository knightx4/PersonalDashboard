'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ModuleMark } from '@/components/ui/module-mark';
import { usePopover } from '@/lib/use-popover';
import { HOME_MARK, MODULES, moduleById, type ModuleId } from '@/lib/modules';

export type WorkspaceId = ModuleId;

/** Serialised on the server so this file stays free of server-only imports. */
export type SwitcherCounts = Partial<Record<ModuleId, string>>;

const LAST_PATH_KEY = 'pt_last_path';

/**
 * Where you were, per workspace.
 *
 * Switching to Jobs mid-pipeline and landing on "This week" is a small tax
 * paid many times a day. Per-viewer and disposable, so localStorage is the
 * right home -- and every access is guarded, because it throws outright in a
 * private window with site data blocked.
 */
function readLastPaths(): Partial<Record<ModuleId, string>> {
  try {
    const raw = window.localStorage.getItem(LAST_PATH_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<ModuleId, string>>) : {};
  } catch {
    return {};
  }
}

function rememberPath(module: ModuleId, path: string) {
  try {
    const next = { ...readLastPaths(), [module]: path };
    window.localStorage.setItem(LAST_PATH_KEY, JSON.stringify(next));
  } catch {
    /* A viewer who blocks storage simply always lands on the workspace home. */
  }
}

/**
 * Which module you are in, and the way out.
 *
 * One mark, one label, one chevron -- one hit target. It used to be three
 * separate targets inside a 140px cluster, two of them unlabelled gradient
 * squares, and "Home" was the mystery one. Home is now the first row of the
 * menu, which is where a person would look for it anyway.
 *
 * `enabled` is the account's switched-on modules. Omitted means all of them: a
 * switcher rendered before the settings are known must not show an empty menu,
 * because a person whose workspaces vanished cannot tell a bug from a setting
 * they do not remember changing.
 *
 * The module you are currently in is always listed even when switched off. You
 * can only be here by URL, and a menu that will not admit where you are is
 * worse than one showing a module you meant to hide.
 */
export function WorkspaceSwitcher({
  current,
  enabled,
  counts = {},
}: {
  current: WorkspaceId | null;
  enabled?: readonly ModuleId[];
  counts?: SwitcherCounts;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const router = useRouter();
  const pathname = usePathname();

  const workspace = moduleById(current);
  const active = workspace ?? HOME_MARK;

  // A stable key for the visible set, so the memo below does not rebuild on
  // every render of a parent that passes a fresh array.
  const enabledKey = enabled === undefined ? '*' : [...enabled].sort().join(',');

  const visible = useMemo(
    () =>
      MODULES.filter(
        (module) =>
          enabledKey === '*' ||
          enabledKey.split(',').includes(module.id) ||
          module.id === current,
      ),
    [enabledKey, current],
  );

  // Home first, then the modules. One flat list so the arrow keys do not have
  // to know about sections. Memoised because the keyboard effect depends on it.
  const rows = useMemo(
    () => [
      {
        id: null as ModuleId | null,
        href: '/home',
        label: 'Home',
        description: 'Everything, and what needs you today',
      },
      ...visible.map((module) => ({
        id: module.id as ModuleId | null,
        href: module.home,
        label: module.label,
        description: module.description,
      })),
    ],
    [visible],
  );

  // Remember where we are, so switching back returns here.
  useEffect(() => {
    if (current) rememberPath(current, pathname);
  }, [current, pathname]);

  const hrefFor = useCallback((id: ModuleId | null, fallback: string) => {
    if (!id) return fallback;
    const remembered = readLastPaths()[id];
    return remembered ?? fallback;
  }, []);

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  /**
   * Cmd-K opens it; Cmd-1..4 jump straight to a workspace.
   *
   * In a four-workspace app the switcher is the most repeated navigation there
   * is, and it otherwise costs a click, a read and a second click.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setActiveIndex(Math.max(0, rows.findIndex((row) => row.id === current)));
        setOpen((v) => !v);
        return;
      }
      const index = Number(event.key);
      if (!Number.isInteger(index) || index < 1 || index > visible.length) return;
      const target = visible[index - 1];
      event.preventDefault();
      router.push(hrefFor(target.id, target.home));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, router, hrefFor, rows, current]);

  /** A real menu keyboard model, not a list of tab stops wearing role="menu". */
  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % rows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + rows.length) % rows.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(rows.length - 1);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          // Start on the current workspace rather than at the top, so the
          // first arrow press moves somewhere useful.
          if (!open) setActiveIndex(Math.max(0, rows.findIndex((row) => row.id === current)));
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch workspace  ⌘K"
        className={cn(
          'press flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors duration-150',
          open ? 'bg-accent-tint' : 'hover:bg-sunken',
        )}
      >
        <ModuleMark module={current} size="md" />
        <span className="font-display text-lead tracking-tight text-ink">{active.label}</span>
        <ChevronsUpDown className="size-3.5 text-ink-muted" strokeWidth={2} aria-hidden />
        <span className="sr-only">Switch workspace</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          tabIndex={-1}
          aria-label="Workspaces"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-card border border-border bg-raised p-1 shadow-lg"
        >
          {rows.map((row, index) => {
            const isCurrent = row.id === current;
            const count = row.id ? counts[row.id] : undefined;
            return (
              <Link
                key={row.id ?? 'home'}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                href={hrefFor(row.id, row.href)}
                role="menuitem"
                tabIndex={index === activeIndex ? 0 : -1}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => setOpen(false)}
                onFocus={() => setActiveIndex(index)}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors duration-150',
                  isCurrent ? 'bg-accent-tint' : 'hover:bg-sunken',
                )}
              >
                <ModuleMark module={row.id} size="sm" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-ui font-medium',
                      isCurrent ? 'text-accent' : 'text-ink',
                    )}
                  >
                    {row.label}
                  </span>
                  {/* The live count, not the static description: the switcher is
                      the only surface that can answer "is anything happening in
                      the workspaces I am not looking at", so it should. */}
                  <span className="tabular block text-small leading-snug text-ink-muted">
                    {count ?? row.description}
                  </span>
                </span>
                {isCurrent && (
                  <Check className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
