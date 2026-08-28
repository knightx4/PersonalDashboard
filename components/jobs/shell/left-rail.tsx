'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Contextual filters. Contents change per section — source, priority,
 * excitement and stale-only on the pipeline, kind and answered-state on
 * Answers — so each page passes its own children.
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
        className={cn('shrink-0 lg:block lg:w-52', open ? 'block' : 'hidden', className)}
        aria-label="Filters"
      >
        <div className="space-y-5 lg:sticky lg:top-20">{children}</div>
      </aside>
    </>
  );
}

export function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
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
  href,
}: {
  label: string;
  active?: boolean;
  count?: number;
  swatch?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150',
        active
          ? 'bg-brand-tint font-medium text-brand'
          : 'text-ink-muted hover:bg-surface hover:text-ink',
      )}
    >
      {swatch && (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: swatch }}
          aria-hidden
        />
      )}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tabular text-ink-faint">{count}</span>}
    </Link>
  );
}
