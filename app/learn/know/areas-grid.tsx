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
import { dayWords } from '@/lib/learn/graph/last-answered';

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

/**
 * One field. A plain block for now; opening a field to list and move its
 * themes (plan #797) turns this into a link, which is why the field's slug
 * rides on it and the whole cell is one element.
 */
function FieldTile({ cell, day }: { cell: FieldCell; day: Day }) {
  const label = kindLabel(cell);
  const glyph = cell.kind === 'neither' ? null : AREA_KIND_GLYPHS[cell.kind];

  return (
    <li
      data-field={cell.slug}
      className={cn(
        'rounded-control px-3 py-2',
        SHADE[cell.shade],
        // Faded, not flagged: a field you neither write about nor have been
        // tested in is visible and says nothing is wrong with it.
        cell.kind === 'neither' && 'opacity-60',
      )}
    >
      <p className="flex items-start gap-1.5 text-ui font-medium text-ink">
        {glyph && <StatusGlyph glyph={glyph} className="mt-0.5 text-ink-muted" />}
        <span className="min-w-0">{cell.name}</span>
      </p>
      <p className="tabular text-small text-ink-muted">{interestLine(cell.interest, day)}</p>
      {cell.interest.strongest.length > 0 && (
        <p
          className="truncate text-small text-ink-muted"
          title={cell.interest.strongest.join(', ')}
        >
          {cell.interest.strongest.join(', ')}
        </p>
      )}
      <p className="tabular text-small text-ink-muted">{testedLine(cell.tested, day)}</p>
      {label && <p className="text-small font-medium text-ink">{label}</p>}
    </li>
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

export function AreasGrid({
  grid,
  interestFailed,
  timezone,
}: {
  grid: AreaGrid;
  interestFailed: boolean;
  timezone: string;
}) {
  const now = new Date();
  const day: Day = (at) => dayWords(at, now, timezone);

  const unplaced: string[] = [];
  if (grid.unplacedThemes > 0) {
    unplaced.push(
      `${plural(grid.unplacedThemes, 'theme is', 'themes are')} about no field of study`,
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
          return (
            <Group
              key={row.id}
              title={row.name}
              action={<span className="tabular text-small text-ink-muted">{domainTotal(row)}</span>}
            >
              {own && <p className="text-small text-ink-muted">{own}</p>}
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {row.fields.map((cell) => (
                  <FieldTile key={cell.id} cell={cell} day={day} />
                ))}
              </ul>
            </Group>
          );
        })}
      </Card>

      {unplaced.length > 0 && (
        <p className="mt-2 text-small text-ink-muted">
          Not on the grid: {unplaced.join(', and ')}.
        </p>
      )}
    </section>
  );
}
