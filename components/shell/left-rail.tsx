'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { CategoryGlyph } from '@/lib/categories/icons';
import { cn } from '@/lib/cn';

/**
 * Contextual filters. Contents change per section, so each page passes its own
 * children.
 *
 * There were two of these, differing in width and -- more consequentially --
 * in opposite mobile defaults, so the same control opened on one workspace and
 * stayed shut on the other.
 *
 * From lg up it is a column that is always there. Below lg it is a sheet, not
 * a stack of filters shoved above the thing you opened the page to read.
 */
export function LeftRail({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // A sheet that survives a route change is a sheet in the way. Every rail
  // item is a link, so opening one is exactly when it should close.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press mb-3 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-ui font-medium text-ink-muted lg:hidden"
        aria-expanded={open}
      >
        <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
        Filters
      </button>

      {/* The sheet. Rendered only when open so it costs nothing at rest. */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/25"
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-border bg-surface"
            aria-label="Filters"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-ui font-semibold text-ink">Filters</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="press flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
                <span className="sr-only">Close filters</span>
              </button>
            </div>
            <div
              className="flex-1 space-y-6 overflow-y-auto p-4"
              onClick={() => setOpen(false)}
            >
              {children}
            </div>
          </aside>
        </div>
      )}

      <aside className={cn('hidden shrink-0 lg:block lg:w-56', className)} aria-label="Filters">
        <div className="space-y-6 lg:sticky lg:top-20">{children}</div>
      </aside>
    </>
  );
}

export function RailGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="mb-2 px-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function RailItem({
  label,
  active = false,
  count,
  swatch,
  /** Category slug -- resolved to an icon inside this client component. */
  iconSlug,
  onClick,
  href,
}: {
  label: string;
  active?: boolean;
  count?: number;
  swatch?: string;
  iconSlug?: string | null;
  onClick?: () => void;
  href?: string;
}) {
  const className = cn(
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui transition-colors duration-150',
    active
      ? 'bg-accent-tint font-medium text-accent'
      : 'text-ink-muted hover:bg-sunken hover:text-ink',
  );

  const body = (
    <>
      {iconSlug ? (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-md"
          style={
            swatch && !swatch.includes('gradient')
              ? { backgroundColor: `${swatch}22`, color: swatch }
              : undefined
          }
          aria-hidden
        >
          <CategoryGlyph slug={iconSlug} className="size-3.5" />
        </span>
      ) : swatch ? (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={
            swatch.includes('gradient')
              ? { backgroundImage: swatch }
              : { backgroundColor: swatch }
          }
          aria-hidden
        />
      ) : null}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tabular text-ink-muted">{count}</span>}
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-current={active ? 'page' : undefined} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {body}
    </button>
  );
}
