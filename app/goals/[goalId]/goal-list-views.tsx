'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, List, X } from 'lucide-react';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import Link from '@/components/ui/link';
import { Popover, popoverSurface } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import type { ListRowView, ListView } from '@/lib/goals/goal-lists';
import {
  comingUp,
  dayLine,
  listMonth,
  mapPins,
  monthToOpen,
  shiftMonth,
  type MapPin,
} from '@/lib/goals/list-views';
import { DraftConfirm, RowTitle } from './goal-list-parts';

/**
 * The views over a goal's list besides the table (plan #2330.4): Compare,
 * cards side by side with the picture, the number fields and the link;
 * Gallery, the pictures in a grid; the calendar, a month with what is coming
 * listed under it; and the map, numbered pins on OpenStreetMap tiles.
 * lib/goals/list-views.ts says which a list offers and which it opens on.
 */

/** What the gallery opens the views on. Nothing in the app passes it. */
export type ViewsSeam = {
  /** The calendar on this month, YYYY-MM. */
  month?: string;
  /** The calendar with this day's popover open, YYYY-MM-DD. */
  day?: string;
  /** The map with this pin's popover open, by its number. */
  pin?: number;
  /** The map's tiles refused, so the table stands in for it. */
  tilesFailed?: boolean;
};

/** A label's unit, as a list writes it: "Wide (in)" is "Wide" in inches. */
function splitUnit(label: string): { label: string; unit: string | null } {
  const match = /^(.*?)\s*\(([^)]{1,8})\)$/.exec(label);
  return match ? { label: match[1], unit: match[2] } : { label, unit: null };
}

/** A row's figures for a card: its number columns but the price, the value with its unit over the label. */
function figuresOf(list: ListView, row: ListRowView) {
  return list.columns
    .filter((c) => c.num && !c.money)
    .map((c) => {
      const { label, unit } = splitUnit(c.label);
      const value = row.cells[c.key] ?? null;
      return { key: c.key, label, value: value && unit ? `${value} ${unit}` : value };
    });
}

/** A row's price, from the list's money column. */
function priceOf(list: ListView, row: ListRowView): string | null {
  const money = list.columns.find((c) => c.money);
  return money ? (row.cells[money.key] ?? null) : null;
}

/** The words a status column holds, when the list has one. */
const statusOf = (row: ListRowView) => row.cells.status ?? null;

/** Where a row stands: picked in the accent with a dot, anything else in plain grey words. */
function StatusMark({ row }: { row: ListRowView }) {
  const status = statusOf(row);
  if (!status) return null;
  if (row.picked) {
    return (
      <Chip size="sm" tone="accent">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        {status}
      </Chip>
    );
  }
  return <span className="text-small text-ink-muted">{status}</span>;
}

/** A picture in a fixed frame, or the list mark where the row has none. */
function Picture({ src, className }: { src: string | null; className?: string }) {
  return (
    <span
      className={cn(
        // ui-ok: hand-rolled-box -- a photo's frame, not a grouping
        'flex items-center justify-center overflow-hidden rounded-control border border-border bg-sunken',
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary shop CDNs
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <List className="size-5 text-ink-ghost" strokeWidth={1.75} aria-hidden />
      )}
    </span>
  );
}

/** A card's one link, at its foot: out to the shop's page, or to the row's own page in its workspace. */
function OpenLink({ row }: { row: ListRowView }) {
  if (!row.href) return null;
  if (row.external) {
    return (
      <a
        href={row.href}
        target="_blank"
        rel="noreferrer"
        className="press-area inline-flex shrink-0 items-center gap-1 text-small font-medium text-accent hover:underline"
      >
        Open the page
        <ExternalLink className="size-3.5" strokeWidth={1.75} aria-label="in a new tab" />
      </a>
    );
  }
  return (
    <Link href={row.href} className="press-area shrink-0 text-small font-medium text-accent hover:underline">
      Open
    </Link>
  );
}

/** A card's name: two lines at most, its link at the foot of the card. */
function CardName({ row }: { row: ListRowView }) {
  return (
    <p className={cn('line-clamp-2 text-ui font-semibold', row.gone ? 'text-ink-muted' : 'text-ink')} title={row.title}>
      {row.title}
    </p>
  );
}

/**
 * Cards side by side, two to a row on a phone and three from a wide panel:
 * the picture, the name with where it stands, the number fields with their
 * values first, and the price beside the one link at the foot.
 */
export function CompareView({
  list,
  rows,
  adding = null,
}: {
  list: ListView;
  rows: ListRowView[];
  /** What the add box is reading, drawn as a card waiting at the end. */
  adding?: string | null;
}) {
  return (
    <div className="@container">
      <ul className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @4xl:grid-cols-4" aria-label={`${list.name}, compared`}>
        {rows.map((row) => {
          const figures = figuresOf(list, row);
          const price = priceOf(list, row);
          return (
            <li
              key={row.id}
              className={cn(
                // ui-ok: hand-rolled-box -- one card per row, side by side, is what Compare is
                'flex min-w-0 flex-col gap-2 rounded-card border bg-surface p-2.5',
                row.picked ? 'border-accent' : 'border-border',
              )}
            >
              <Picture src={row.picture} className="aspect-[4/3] w-full" />
              <CardName row={row} />
              {(statusOf(row) || row.draft) && (
                <p className="-mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusMark row={row} />
                  {row.draft && <DraftConfirm recordId={row.id} />}
                </p>
              )}
              {figures.length > 0 && (
                <dl className="flex flex-wrap gap-x-4 gap-y-1">
                  {figures.map((f) => (
                    <div key={f.key} className="min-w-0">
                      <dd className={cn('tabular text-ui font-semibold', f.value ? 'text-ink' : 'text-ink-ghost')}>
                        {f.value ?? '–'}
                      </dd>
                      <dt className="text-micro text-ink-muted">{f.label}</dt>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1">
                {price ? <span className="tabular text-ui font-semibold text-ink">{price}</span> : <span />}
                <OpenLink row={row} />
              </div>
            </li>
          );
        })}
        {adding && (
          <li
            aria-live="polite"
            // ui-ok: hand-rolled-box -- the card a row will fill, drawn as the others are
            className="flex min-w-0 flex-col gap-2 rounded-card border border-dashed border-control p-2.5"
          >
            <span
              // ui-ok: hand-rolled-box -- the photo's place, dashed until the page gives one
              className="block aspect-[4/3] w-full animate-pulse rounded-control border border-dashed border-control"
              aria-hidden
            />
            <span className="text-ui text-ink-muted">{addingLine(adding)}</span>
            {/* Where the figures and the price will land, dashed until the page gives them. */}
            <span className="flex flex-wrap gap-x-4 gap-y-1" aria-hidden>
              {figuresOf(list, { cells: {} } as ListRowView).map((f) => (
                <span key={f.key} className="space-y-0.5">
                  {/* ui-ok: hand-rolled-box -- a figure's place, dashed until the page gives it */}
                  <span className="block h-4 w-10 rounded-control border border-dashed border-control" />
                  <span className="block text-micro text-ink-muted">{f.label}</span>
                </span>
              ))}
            </span>
            {/* ui-ok: hand-rolled-box -- the price's place, dashed until the page gives it */}
            <span className="mt-auto block h-4 w-16 rounded-control border border-dashed border-control" aria-hidden />
          </li>
        )}
      </ul>
    </div>
  );
}

/** What Dash says while it reads a pasted link, naming the site; a typed name is added as typed. */
function addingLine(text: string): string {
  if (!/^https?:/i.test(text)) return `Adding ${text}…`;
  let host = text;
  try {
    host = new URL(text).hostname.replace(/^www\./, '');
  } catch {
    // Not an address after all; say it as typed.
  }
  return `Dash is reading ${host} for the name, picture and price…`;
}

/** The pictures in a grid, each with its name under it and its price or where it stands. */
export function GalleryView({
  list,
  rows,
  adding = null,
}: {
  list: ListView;
  rows: ListRowView[];
  adding?: string | null;
}) {
  return (
    <div className="@container">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4 @lg:grid-cols-3 @4xl:grid-cols-5">
        {rows.map((row) => {
          const price = priceOf(list, row);
          return (
            <li key={row.id} className="min-w-0 space-y-1.5">
              <Picture src={row.picture} className="aspect-square w-full" />
              <p className="line-clamp-2 text-ui">
                <RowTitle row={row} />
              </p>
              {(price || row.picked) && (
                <p className="flex flex-wrap items-center gap-2">
                  {price && <span className="tabular text-small text-ink-muted">{price}</span>}
                  {row.picked && <StatusMark row={row} />}
                </p>
              )}
            </li>
          );
        })}
        {adding && (
          <li className="min-w-0 space-y-1.5" aria-live="polite">
            <span className="block aspect-square w-full animate-pulse rounded-control bg-sunken" aria-hidden />
            <p className="text-ui text-ink-muted">{addingLine(adding)}</p>
          </li>
        )}
      </ul>
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A month grid with the rows on their days, the month's name and the arrows
 * on one line above it, and what is coming listed under it. A day with rows
 * opens a popover naming each with its link. A phone shows a dot per row in
 * the square, a laptop the first name.
 */
export function CalendarView({ list, seam }: { list: ListView; seam?: ViewsSeam }) {
  const today = list.today ?? '1970-01-01';
  const rows = list.rows;
  const [month, setMonth] = useState(seam?.month ?? monthToOpen(rows, today));
  const [open, setOpen] = useState<string | null>(seam?.day ?? null);
  const grid = listMonth(rows, month, today);
  const coming = comingUp(rows, today);
  const undated = rows.filter((r) => !r.day).length;
  const go = (by: number) => {
    setMonth(shiftMonth(month, by));
    setOpen(null);
  };
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-ui font-semibold text-ink">{grid.label}</h3>
          <span className="flex items-center gap-1">
            <IconButton label="The month before" onClick={() => go(-1)}>
              <ChevronLeft strokeWidth={1.75} aria-hidden />
            </IconButton>
            <IconButton label="The month after" onClick={() => go(1)}>
              <ChevronRight strokeWidth={1.75} aria-hidden />
            </IconButton>
          </span>
        </div>
        <div role="table" aria-label={grid.label} className="text-small">
          <div role="row" className="grid grid-cols-7 text-center text-micro text-ink-muted">
            {WEEKDAYS.map((d) => (
              <span key={d} role="columnheader" className="py-1">
                <span className="sm:hidden" aria-hidden>
                  {d[0]}
                </span>
                <span className="max-sm:sr-only">{d}</span>
              </span>
            ))}
          </div>
          {grid.weeks.map((week) => {
            const openDay = week.find((d) => d.day === open && d.rows.length > 0) ?? null;
            const column = openDay ? week.indexOf(openDay) : 0;
            return (
              <div key={week[0].day} role="row" className="relative grid grid-cols-7 border-t border-border">
                {week.map((d) => (
                  <DaySquare
                    key={d.day}
                    day={d}
                    expanded={open === d.day}
                    onOpen={() => setOpen(open === d.day ? null : d.day)}
                  />
                ))}
                {openDay && (
                  <Popover
                    anchor={column > 2 ? 'trigger-below-end' : 'trigger-below'}
                    padding="panel"
                    role="dialog"
                    aria-label={dayLine(openDay.day, today)}
                    className="w-64"
                    style={column > 2 ? undefined : { left: `${(column / 7) * 100}%` }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-small font-semibold text-ink">{dayLine(openDay.day, today)}</p>
                      <IconButton label="Close the day" size="sm" onClick={() => setOpen(null)}>
                        <X strokeWidth={1.75} aria-hidden />
                      </IconButton>
                    </div>
                    <ul className="space-y-2 text-ui">
                      {openDay.rows.map((row) => (
                        <li key={row.id} className="space-y-0.5">
                          <CardName row={row} />
                          {row.place && <p className="text-small text-ink-muted">{row.place.address}</p>}
                          <OpenLink row={row} />
                        </li>
                      ))}
                    </ul>
                  </Popover>
                )}
              </div>
            );
          })}
        </div>
        {grid.count === 0 && (
          <p className="text-small text-ink-muted">Nothing on {list.name} falls in {grid.label}.</p>
        )}
      </div>
      <section className="space-y-1.5">
        <h3 className="text-small font-semibold text-ink-muted">Coming up</h3>
        {coming.length === 0 ? (
          <p className="text-small text-ink-muted">Nothing dated from today on.</p>
        ) : (
          <ul className="divide-y divide-border">
            {coming.map((row) => (
              <li key={row.id} className="flex items-baseline gap-3 py-2 text-ui">
                <span className="tabular w-24 shrink-0 text-small text-ink-muted">{dayLine(row.day, today)}</span>
                <span className="min-w-0">
                  <RowTitle row={row} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {undated > 0 && (
          <p className="text-small text-ink-muted">
            {undated} {undated === 1 ? 'row has' : 'rows have'} no date, so {undated === 1 ? 'it is' : 'they are'} only
            on the table.
          </p>
        )}
      </section>
    </div>
  );
}

function DaySquare({
  day,
  expanded,
  onOpen,
}: {
  day: ReturnType<typeof listMonth>['weeks'][number][number];
  expanded: boolean;
  onOpen: () => void;
}) {
  const number = (
    <span
      className={cn(
        'tabular inline-flex size-6 items-center justify-center rounded-full',
        day.isToday && 'bg-accent font-semibold text-fill-ink',
        !day.inMonth && 'text-ink-ghost',
      )}
    >
      {day.date}
    </span>
  );
  const square = 'flex min-h-12 flex-col items-start gap-0.5 p-1 text-left sm:min-h-16';
  if (day.rows.length === 0) {
    return (
      <span role="cell" className={square}>
        {number}
      </span>
    );
  }
  const first = day.rows[0];
  return (
    <span role="cell" className="min-w-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-label={`${day.rows.length} on ${day.day}: ${day.rows.map((r) => r.title).join(', ')}`}
        onClick={onOpen}
        className={cn(
          square,
          'press w-full rounded-control hover:bg-sunken',
          expanded && 'bg-accent-tint',
        )}
      >
        {number}
        <span className="flex gap-0.5 sm:hidden" aria-hidden>
          {day.rows.slice(0, 3).map((r) => (
            <span key={r.id} className="size-1.5 rounded-full bg-accent" />
          ))}
        </span>
        <span className="w-full truncate text-micro font-medium text-accent max-sm:hidden" aria-hidden>
          {first.title}
        </span>
        {day.rows.length > 1 && (
          <span className="text-micro text-ink-muted max-sm:hidden" aria-hidden>
            +{day.rows.length - 1} more
          </span>
        )}
      </button>
    </span>
  );
}

/** Leaflet reads the window, so the map is drawn in the browser alone. */
const ListMap = dynamic(() => import('./goal-list-map').then((m) => m.ListMap), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-card bg-sunken sm:h-80" aria-hidden />,
});

/**
 * The map: a pin for each row with a point, numbered down the list beside
 * it, and the rows with an address alone listed under it, since nothing
 * turns an address into a point yet. No places at all says how to add one.
 */
export function MapView({
  list,
  seam,
  onFailed,
}: {
  list: ListView;
  seam?: ViewsSeam;
  onFailed: () => void;
}) {
  // One array per set of rows, so the map is not drawn afresh on every press.
  const { pins, unpinned } = useMemo(() => mapPins(list.rows), [list.rows]);
  const [open, setOpen] = useState<number | null>(seam?.pin ?? null);
  if (pins.length === 0 && unpinned.length === 0) {
    return (
      <EmptyState
        size="box"
        align="start"
        title={list.kind === 'own' ? 'Add an address to see it on the map.' : 'None of these has a place yet.'}
      />
    );
  }
  const shown = pins.find((p) => p.n === open) ?? null;
  return (
    <div className="space-y-3">
      {pins.length > 0 ? (
        <ListMap
          pins={pins}
          selected={open}
          onSelect={setOpen}
          onFailed={onFailed}
          card={shown && <PinCard pin={shown} onClose={() => setOpen(null)} />}
        />
      ) : (
        <p className="text-small text-ink-muted">
          {unpinned.length === 1 ? 'This place has' : 'These places have'} an address but no point on the map yet.
        </p>
      )}
      {pins.length > 0 && (
        <ol className="divide-y divide-border">
          {pins.map((pin) => (
            <li key={pin.row.id} className="flex items-start gap-3 py-2 text-ui">
              <PinMark n={pin.n} />
              <span className="min-w-0 space-y-0.5">
                <RowTitle row={pin.row} />
                <span className="block text-small text-ink-muted">{pin.address}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {unpinned.length > 0 && (
        <section className="space-y-1">
          {pins.length > 0 && <h3 className="text-small font-semibold text-ink-muted">No pin yet</h3>}
          <ul className="divide-y divide-border">
            {unpinned.map((row) => (
              <li key={row.id} className="space-y-0.5 py-2 text-ui">
                <RowTitle row={row} />
                <span className="block text-small text-ink-muted">{row.place?.address}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A pin's number in the list beside the map, as the pin draws it. */
function PinMark({ n }: { n: number }) {
  return (
    <span
      className="tabular inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-micro font-semibold text-fill-ink"
      aria-hidden
    >
      {n}
    </span>
  );
}

/** The pressed pin's row, hung beside the pin: its number, name, address and link. */
function PinCard({ pin, onClose }: { pin: MapPin; onClose: () => void }) {
  return (
    <div role="dialog" aria-label={pin.row.title} className={cn(popoverSurface, 'w-64 p-3')}>
      <div className="flex items-start gap-2.5">
        <PinMark n={pin.n} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <CardName row={pin.row} />
          <p className="text-small text-ink-muted">{pin.address}</p>
          <OpenLink row={pin.row} />
        </div>
        <IconButton label="Close the pin" size="sm" onClick={onClose}>
          <X strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
