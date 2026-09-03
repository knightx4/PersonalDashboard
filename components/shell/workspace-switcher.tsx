'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { HOME_MARK, MODULES, moduleById, type ModuleId } from '@/lib/modules';

/**
 * Which module you are in, and the way out.
 *
 * This sits where each product's wordmark used to. One login, one deployment
 * and one database now carry several unrelated domains, and the thing a person
 * needs top-left is no longer a name -- it is which one they are currently in.
 *
 * The list itself lives in lib/modules.ts, shared with the home page's tiles,
 * so a new module shows up in both without anyone remembering the second one.
 */
export type WorkspaceId = ModuleId;

/**
 * `enabled` is the account's switched-on modules, from core.account_settings.
 * Omitted means all of them -- a switcher rendered before the settings are
 * known must not show an empty menu, because a person whose workspaces
 * vanished cannot tell a bug from a setting they do not remember changing.
 *
 * The module you are currently in is always listed even when switched off. You
 * can only be here by URL, and a page that will not admit where you are is
 * worse than one showing a module you meant to hide.
 */
export function WorkspaceSwitcher({
  current,
  enabled,
}: {
  current: WorkspaceId | null;
  enabled?: readonly ModuleId[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const workspace = moduleById(current);
  const active = workspace ?? HOME_MARK;

  const visible = MODULES.filter(
    (module) => enabled === undefined || enabled.includes(module.id) || module.id === current,
  );

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <div className="flex items-center gap-2 rounded-lg py-1 pl-1.5 pr-1 transition-colors duration-150 hover:bg-canvas">
        <Link href="/home" className="press flex items-center rounded-md" title="Home">
          <span
            className="size-8 rounded-lg bg-brand"
            style={{ backgroundImage: HOME_MARK.gradient }}
            aria-hidden
          />
          <span className="sr-only">Home</span>
        </Link>
        {workspace && (
          <Link
            href={workspace.home}
            className="press flex items-center rounded-md"
            title={workspace.label}
          >
            <span
              className="size-5 rounded-md bg-brand"
              style={{ backgroundImage: workspace.gradient }}
              aria-hidden
            />
            <span className="sr-only">{workspace.label}</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="press flex items-center gap-2"
        >
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
            {active.label}
          </span>
          <ChevronsUpDown className="size-3.5 text-ink-muted" strokeWidth={2} aria-hidden />
          <span className="sr-only">Switch workspace</span>
        </button>
      </div>

      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {visible.map((workspace) => {
            const isCurrent = workspace.id === current;
            return (
              <Link
                key={workspace.id}
                href={workspace.home}
                role="menuitem"
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors duration-150',
                  isCurrent ? 'bg-brand-tint' : 'hover:bg-canvas',
                )}
              >
                <span
                  className="mt-0.5 size-5 shrink-0 rounded bg-brand"
                  style={{ backgroundImage: workspace.gradient }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-[13px] font-medium',
                      isCurrent ? 'text-brand' : 'text-ink',
                    )}
                  >
                    {workspace.label}
                  </span>
                  <span className="block text-[12px] leading-snug text-ink-muted">
                    {workspace.description}
                  </span>
                </span>
                {isCurrent && (
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
