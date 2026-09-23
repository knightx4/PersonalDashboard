import Link from 'next/link';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { cn } from '@/lib/cn';
import {
  AREA_KIND_GLYPHS,
  interestLine,
  kindLabel,
  testedLine,
  type AreaGrid,
  type DomainRow,
  type FieldCell,
  type InterestShade,
} from '@/lib/learn/areas/grid';
import type { DestinationGroup, OpenedPlace } from '@/lib/learn/areas/move';
import { dayWords } from '@/lib/learn/graph/last-answered';
import { PlacedThemes, type ThemeRow } from './placed-themes';

/**
 * Every field of study, by domain, with what you write about and what you
 * have been tested on side by side (LEARN-AREAS-SPEC, "The dashboard").
 *
 * Interest is the cell's ground: darker where the vault's themes are
 * stronger. Ink, not the workspace accent, because the accent means "you are
 * here" and a colour for "you write about this" would be a claim none of the
 * colours makes (law 4). The kind is a status hexagon and its name, so it
 * reads with the shade taken away.
 */

/** Ink at a rising strength over the card. Level 0 is the card's own canvas. */
const SHADE: Record<InterestShade, string> = {
  0: 'bg-canvas',
  1: 'bg-ink/5',
  2: 'bg-ink/10',
  3: 'bg-ink/15',
};

type Day = (at: string | null) => string | null;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Where the opened place is drawn, and what a tile's link scrolls to. */
const OPENED_ID = 'opened';

/**
 * One field, as a link that opens it. Opening the field that is already open
 * closes it, so the tile is a toggle and the URL stays the one source of what
 * is open (law 5).
 */
function FieldTile({ cell, day, open }: { cell: FieldCell; day: Day; open: boolean }) {
  const label = kindLabel(cell);
  const glyph = cell.kind === 'neither' ? null : AREA_KIND_GLYPHS[cell.kind];

  return (
    <li data-field={cell.slug}>
      <Link
        href={open ? '/learn/know#areas-heading' : `/learn/know?field=${cell.slug}#${OPENED_ID}`}
        aria-current={open ? 'true' : undefined}
        aria-expanded={open}
        className={cn(
          'block h-full rounded-control px-3 py-2 hover:outline hover:outline-1 hover:outline-control',
          SHADE[cell.shade],
          // Faded, not flagged: a field you neither write about nor have been
          // tested in is visible and says nothing is wrong with it.
          cell.kind === 'neither' && !open && 'opacity-60',
          open && 'outline outline-2 outline-accent',
        )}
      >
        <span className="flex items-start gap-1.5 text-ui font-medium text-ink">
          {glyph && <StatusGlyph glyph={glyph} className="mt-0.5 text-ink-muted" />}
          <span className="min-w-0">{cell.name}</span>
        </span>
        <span className="tabular block text-small text-ink-muted">
          {interestLine(cell.interest, day)}
        </span>
        {cell.interest.strongest.length > 0 && (
          <span
            className="block truncate text-small text-ink-muted"
            title={cell.interest.strongest.join(', ')}
          >
            {cell.interest.strongest.join(', ')}
          </span>
        )}
        <span className="tabular block text-small text-ink-muted">
          {testedLine(cell.tested, day)}
        </span>
        {label && <span className="block text-small font-medium text-ink">{label}</span>}
      </Link>
    </li>
  );
}

/** The opened place: its themes, why each is there, and a way to move one. */
export type OpenedThemes = {
  place: OpenedPlace;
  /** Null when the read failed, which the panel says in place (law 2). */
  themes: ThemeRow[] | null;
  groups: DestinationGroup[];
};

function openedTitle(place: OpenedPlace): string {
  switch (place.kind) {
    case 'field':
      return place.name;
    case 'domain':
      return `${place.name} as a whole`;
    default:
      return 'Themes about no field of study';
  }
}

function OpenedPanel({ opened }: { opened: OpenedThemes }) {
  const { place, themes, groups } = opened;
  return (
    <div
      id={OPENED_ID}
      className="mt-3 scroll-mt-16 rounded-control border border-border bg-surface p-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ui font-semibold text-ink">
          {openedTitle(place)}
          {themes && (
            <span className="tabular ml-2 font-normal text-ink-muted">
              {plural(themes.length, 'theme', 'themes')}
            </span>
          )}
        </h3>
        <Link
          href="/learn/know#areas-heading"
          className="text-small text-ink-muted hover:text-accent"
        >
          Close
        </Link>
      </div>
      <p className="mb-2 text-small text-ink-muted">
        Each line says why the placement pass put the theme here. A theme you move stays where you
        put it; the hourly pass never moves it back.
      </p>
      {themes === null ? (
        <p className="text-small text-ink-muted">The themes placed here could not be read.</p>
      ) : themes.length === 0 ? (
        <p className="text-small text-ink-muted">No themes are placed here.</p>
      ) : (
        <PlacedThemes themes={themes} groups={groups} />
      )}
    </div>
  );
}

function domainTotal(row: DomainRow): string {
  const { interest, tested } = row.total;
  const parts = [plural(interest.themes, 'theme', 'themes')];
  if (tested.total > 0)
    parts.push(`${tested.known} of ${plural(tested.total, 'idea', 'ideas')} known`);
  return parts.join(' · ');
}

/**
 * What was placed at the domain as a whole. It shows here and in none of the
 * cells, so the domain's total is its fields plus this and nothing is counted
 * twice.
 */
function domainOwn(row: DomainRow, day: Day): string | null {
  const { interest, tested } = row.own;
  const parts: string[] = [];
  if (interest.themes > 0) {
    parts.push(`${interestLine(interest, day)} (${interest.strongest.join(', ')})`);
  }
  if (tested.tracks.length > 0)
    parts.push(`${tested.tracks.join(', ')}: ${testedLine(tested, day)}`);
  return parts.length > 0 ? `About the domain as a whole: ${parts.join('; ')}` : null;
}

function isOpen(opened: OpenedThemes | null, kind: OpenedPlace['kind'], slug?: string): boolean {
  if (!opened || opened.place.kind !== kind) return false;
  return kind === 'unplaced' || ('slug' in opened.place && opened.place.slug === slug);
}

export function AreasGrid({
  grid,
  interestFailed,
  timezone,
  opened,
}: {
  grid: AreaGrid;
  interestFailed: boolean;
  timezone: string;
  opened: OpenedThemes | null;
}) {
  const now = new Date();
  const day: Day = (at) => dayWords(at, now, timezone);

  const unplacedOpen = isOpen(opened, 'unplaced');
  const unplaced: React.ReactNode[] = [];
  if (grid.unplacedThemes > 0) {
    unplaced.push(
      <Link
        key="themes"
        href={unplacedOpen ? '/learn/know#areas-heading' : `/learn/know?unplaced=1#${OPENED_ID}`}
        aria-expanded={unplacedOpen}
        className="text-ink underline decoration-control underline-offset-2 hover:text-accent"
      >
        {plural(grid.unplacedThemes, 'theme is', 'themes are')} about no field of study
      </Link>,
    );
  }
  if (grid.unplacedTracks > 0) {
    unplaced.push(
      grid.unplacedTracks === 1
        ? '1 track is not placed yet or spans more than one domain'
        : `${grid.unplacedTracks} tracks are not placed yet or span more than one domain`,
    );
  }

  return (
    <section className="mt-8" aria-labelledby="areas-heading">
      <h2 id="areas-heading" className="text-body font-medium text-ink">
        By field
      </h2>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <StatusGlyph glyph={AREA_KIND_GLYPHS.strong} /> Strong
        </span>
        <span className="inline-flex items-center gap-1">
          <StatusGlyph glyph={AREA_KIND_GLYPHS['getting-there']} /> Getting there
        </span>
        <span className="inline-flex items-center gap-1">
          <StatusGlyph glyph={AREA_KIND_GLYPHS.untested} /> Not tested yet
        </span>
        <span>Darker means you write about it more.</span>
      </p>

      {interestFailed && (
        <Banner tone="warn" className="mt-3">
          Your vault’s themes could not be read, so no field shows what you write about.
        </Banner>
      )}

      <Card padding="standard" className="mt-3 space-y-5">
        {grid.domains.map((row) => {
          const own = domainOwn(row, day);
          const domainOpen = isOpen(opened, 'domain', row.slug);
          const fieldOpen = row.fields.some((cell) => isOpen(opened, 'field', cell.slug));
          return (
            <Group
              key={row.id}
              title={row.name}
              action={<span className="tabular text-small text-ink-muted">{domainTotal(row)}</span>}
            >
              {own && (
                <p className="text-small text-ink-muted">
                  {row.own.interest.themes > 0 ? (
                    <Link
                      href={
                        domainOpen
                          ? '/learn/know#areas-heading'
                          : `/learn/know?domain=${row.slug}#${OPENED_ID}`
                      }
                      aria-expanded={domainOpen}
                      className="underline decoration-control underline-offset-2 hover:text-accent"
                    >
                      {own}
                    </Link>
                  ) : (
                    own
                  )}
                </p>
              )}
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {row.fields.map((cell) => (
                  <FieldTile
                    key={cell.id}
                    cell={cell}
                    day={day}
                    open={isOpen(opened, 'field', cell.slug)}
                  />
                ))}
              </ul>
              {opened && (domainOpen || fieldOpen) && <OpenedPanel opened={opened} />}
            </Group>
          );
        })}
      </Card>

      {unplaced.length > 0 && (
        <p className="mt-2 text-small text-ink-muted">
          Not on the grid:{' '}
          {unplaced.map((part, index) => (
            <span key={index}>
              {index > 0 && ', and '}
              {part}
            </span>
          ))}
          .
        </p>
      )}
      {opened && unplacedOpen && <OpenedPanel opened={opened} />}
    </section>
  );
}
