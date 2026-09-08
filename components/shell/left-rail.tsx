'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { CategoryGlyph } from '@/lib/categories/icons';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

/**
 * Contextual filters. Contents change per section, so each page passes its own
 * children.
 *
 * There were two of these, differing in width and -- more consequentially --
 * in opposite mobile defaults, so the same control opened on one workspace and
 * stayed shut on the other.
 *
 * From lg up it is a column that is always there, scrolling on its own: once
 * the filters are taller than the viewport, sticking them without their own
 * overflow means the bottom of the list is only reachable by scrolling the
 * page past the results. Below lg it is a sheet, not a stack of filters shoved
 * above the thing you opened the page to read.
 */
export function LeftRail({
  children,
  className,
  fill = false,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * The parent already bounds the height -- a page whose results scroll in
   * their own region rather than with the document. The rail then fills that
   * region instead of measuring the viewport itself, which it cannot do
   * correctly from inside a container it does not know the height of.
   */
  fill?: boolean;
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
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mb-3 xl:hidden')}
        aria-expanded={open}
      >
        <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
        Filters
      </button>

      {/* Rendered only when open, so it costs nothing at rest. */}
      {open && (
        <div className="fixed inset-0 z-50 xl:hidden">
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
            <div className="flex-1 space-y-6 overflow-y-auto p-4" onClick={() => setOpen(false)}>
              {children}
            </div>
          </aside>
        </div>
      )}

      <aside
        className={cn('hidden shrink-0 xl:block xl:w-52', fill && 'xl:h-full', className)}
        aria-label="Filters"
      >
        <div
          className={cn(
            'space-y-6 xl:overflow-y-auto xl:overscroll-contain xl:pr-1',
            fill
              ? 'xl:h-full'
              : 'xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)]',
          )}
        >
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
      <h2 className="mb-2 px-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
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
      <h2 className="mb-2 px-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </h2>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'press flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-ui',
          active ? 'bg-accent-tint font-medium text-accent' : 'bg-surface text-ink-muted',
        )}
      >
        <span className="flex-1 truncate">{active?.label ?? anyLabel}</span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      {/* No frame of its own, and no ground. This list drops *into* the rail
          rather than floating over anything, so the trigger's own border and
          a second one four pixels under it were two hairlines arguing about
          the same grouping -- law 11's named mistake, and the one place in
          the shell where it was visible without opening anything. Opened, it
          is simply a RailGroup's list: the same rows, at the same left edge,
          under the control that revealed them. */}
      {open && (
        <div className="mt-1.5">
          <div className="relative mb-1.5">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            {/* The shared control, not a fourth spelling of one. Three things
                come with it that the hand-rolled version had lost: the height
                follows the density dial instead of being nailed to 32px, the
                focus ring matches every other field in the app, and it is
                16px on a phone -- which matters here, because the rail is
                also the mobile filter sheet, and a 13px field is exactly what
                makes Safari zoom the page in when you tap it. Only the left
                inset is ours, for the glyph. */}
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              aria-label={`Filter ${label.toLowerCase()} options`}
              className="pl-7"
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
              <p className="px-2.5 py-1.5 text-ui text-ink-muted">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
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
