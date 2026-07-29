'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Contextual filters. Contents change per section -- time frames on Dashboard
 * and Orders, category / merchant / price on Inventory -- so each page passes
 * its own children.
 *
 * Collapsible, and collapsed by default under 1024px.
 */
export function LeftRail({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      {/* Under lg the rail is hidden behind a toggle; above it, it is always shown. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press mb-3 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-muted lg:hidden"
        aria-expanded={open}
      >
        {open ? (
          <PanelLeftClose className="size-4" strokeWidth={1.75} />
        ) : (
          <PanelLeftOpen className="size-4" strokeWidth={1.75} />
        )}
        Filters
      </button>

      <aside
        className={cn(
          'shrink-0 lg:block lg:w-56',
          open ? 'block' : 'hidden',
          className,
        )}
        aria-label="Filters"
      >
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
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
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
  icon: Icon,
  onClick,
  href,
}: {
  label: string;
  active?: boolean;
  count?: number;
  swatch?: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  onClick?: () => void;
  href?: string;
}) {
  const className = cn(
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150',
    active
      ? 'bg-brand-tint font-medium text-brand'
      : 'text-ink-muted hover:bg-surface hover:text-ink',
  );

  const body = (
    <>
      {Icon ? (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-md"
          style={
            swatch && !swatch.includes('gradient')
              ? { backgroundColor: `${swatch}22`, color: swatch }
              : undefined
          }
          aria-hidden
        >
          <Icon className="size-3.5" strokeWidth={1.75} />
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
      {count !== undefined && <span className="tabular text-ink-faint">{count}</span>}
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
