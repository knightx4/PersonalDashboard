'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { CategoryGlyph } from '@/lib/categories/icons';
import { cn } from '@/lib/cn';

/**
 * Contextual filters. Contents change per section -- time frames on Dashboard
 * and Orders, category / merchant / price on Inventory -- so each page passes
 * its own children.
 *
 * Collapsible, and collapsed by default under 1024px.
 *
 * The sticky column scrolls on its own above lg: once the filters are taller
 * than the viewport, sticking them without their own overflow means the bottom
 * of the list is only reachable by scrolling the page past the results.
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
        <div className="space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          {children}
        </div>
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

export type RailOption = {
  id: string;
  label: string;
  href: string;
  swatch?: string;
};

/**
 * A one-line stand-in for a RailGroup whose list has grown long enough to push
 * everything below it off the rail — merchants, most obviously.
 *
 * Collapsed it shows only what is selected; opened it is a type-to-filter list.
 * Options stay plain links, so the filter still works the way the rest of the
 * rail does and a middle-click still opens it in a tab.
 */
export function RailPicker({
  label,
  options,
  activeId,
  anyLabel = 'Any',
  anyHref,
  placeholder = 'Type to filter…',
}: {
  label: string;
  options: RailOption[];
  activeId?: string;
  /** Where "no filter" points. */
  anyLabel?: string;
  anyHref: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const active = options.find((option) => option.id === activeId);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </h2>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'press flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-[13px]',
          active ? 'bg-brand-tint font-medium text-brand' : 'bg-surface text-ink-muted',
        )}
      >
        <span className="flex-1 truncate">{active?.label ?? anyLabel}</span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      {open && (
        <div className="mt-1 rounded-lg border border-border bg-surface p-1">
          <div className="relative mb-1">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              aria-label={`Filter ${label.toLowerCase()} options`}
              className="h-8 w-full rounded-md border border-border bg-canvas pl-7 pr-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain">
            <RailItem label={anyLabel} active={!activeId} href={anyHref} />
            {matches.map((option) => (
              <RailItem
                key={option.id}
                label={option.label}
                swatch={option.swatch}
                active={option.id === activeId}
                href={option.href}
              />
            ))}
            {matches.length === 0 && (
              <p className="px-2.5 py-1.5 text-[13px] text-ink-faint">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A selected filter, shown as a chip with a link that removes it. */
export function RailChip({ label, removeHref }: { label: string; removeHref: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-tint py-1 pl-2.5 pr-1 text-[12px] font-medium text-brand">
      <span className="truncate">{label}</span>
      <Link
        href={removeHref}
        aria-label={`Remove filter ${label}`}
        className="press inline-flex size-4 shrink-0 items-center justify-center rounded-full text-brand hover:bg-brand/15"
      >
        <span aria-hidden>×</span>
      </Link>
    </span>
  );
}

export function RailItem({
  label,
  active = false,
  count,
  swatch,
  /** Category slug — resolved to an icon inside this client component. */
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
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150',
    active
      ? 'bg-brand-tint font-medium text-brand'
      : 'text-ink-muted hover:bg-surface hover:text-ink',
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
