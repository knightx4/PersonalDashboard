'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The two halves of the app, and the switch between them.
 *
 * This sits where each product's wordmark used to. One login, one deployment
 * and one database now carry two unrelated domains, and the thing a person
 * needs top-left is no longer a name -- it is which of the two they are
 * currently in, and the way out.
 *
 * `home` is where switching lands you: the page that answers "what is going on"
 * for that domain, not its settings or its root.
 */
const WORKSPACES = [
  {
    id: 'shopping',
    prefix: '/shopping',
    home: '/shopping/dashboard',
    label: 'Shopping',
    description: 'Orders, inventory, returns and resale',
    gradient:
      'linear-gradient(135deg, var(--color-brand) 0%, var(--color-accent-pink) 100%)',
  },
  {
    id: 'jobs',
    prefix: '/jobs',
    home: '/jobs/today',
    label: 'Job search',
    description: 'Pipeline, roles, companies and interviews',
    gradient:
      'linear-gradient(135deg, var(--color-brand) 0%, var(--color-status-final) 100%)',
  },
] as const;

export type WorkspaceId = (typeof WORKSPACES)[number]['id'];

/**
 * `current: null` is the home page: neither workspace is active, so the
 * button shows a neutral mark and "Home" rather than defaulting to one
 * module's own gradient and name.
 */
const HOME = {
  label: 'Home',
  gradient: 'linear-gradient(135deg, var(--color-brand) 0%, var(--color-ink-muted) 100%)',
} as const;

export function WorkspaceSwitcher({ current }: { current: WorkspaceId | null }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = current === null ? HOME : (WORKSPACES.find((w) => w.id === current) ?? WORKSPACES[0]);

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
            className="size-6 rounded-md bg-brand"
            style={{ backgroundImage: active.gradient }}
            aria-hidden
          />
          <span className="sr-only">Home</span>
        </Link>
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
          {WORKSPACES.map((workspace) => {
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
