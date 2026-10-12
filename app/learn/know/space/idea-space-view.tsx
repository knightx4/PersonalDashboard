import Link from 'next/link';
import { Orbit, X } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { MainRail } from '@/components/patterns/main-rail';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { NEIGHBOURS_PER_IDEA } from '@/lib/learn/map/idea-map';
import type { IdeaMapView, IdeaOnMap } from '@/lib/learn/map/load';
import {
  LABEL_FRAMES,
  STATE_MARKS,
  STATE_MARK_LABEL,
  domainSlots,
  framePosition,
  hueFill,
  labelsThatFit,
  mapHref,
  markOf,
  similarityText,
  type AreaLabel,
  type MapParams,
  type StateMark,
} from '@/lib/learn/map/view';
import { IdeaPlot, Mark, type PlotArea, type PlotDot } from './idea-plot';

/**
 * The Idea Space page (plan #1857): every idea with an embedding on one map,
 * apart from the read so the gallery draws it from fixtures.
 *
 * Main plus rail. The map is what the page is for and sits in the main
 * column with its switches and legend; the rail holds what you glance at
 * beside it: the idea you tapped and its six nearest, then the two lists the
 * map turns up, ideas that are probably one idea twice and untested ideas
 * surrounded by ones you know. The switches are links, so a layout or a
 * colouring survives a reload and a pasted address (law 5).
 */

const CONCEPT_HREF = (id: string) => `/learn/c/${id}`;

/** How far above its dot the open idea's name sits: half its height and the gap (idea-plot.tsx). */
const SELECTED_RAISE_PX = 23;

/** How many rows a rail list shows before the rest fold away. */
const LIST_SHOWN = 5;

export function IdeaSpaceView({
  view,
  params,
}: {
  /** Null when the ideas could not be read, which the page says in place (law 2). */
  view: IdeaMapView | null;
  params: MapParams;
}) {
  const header = (
    <PageHeader
      crumbs={[
        { label: 'Learn', href: '/learn' },
        { label: 'Know', href: '/learn/know' },
        { label: 'Idea Space', href: mapHref(params, { idea: null }) },
      ]}
      title="Idea Space"
      description={
        view && view.ideas.length > 0
          ? params.layout === 'neighbours'
            ? `${plural(view.ideas.length, 'idea')}, each placed near the ideas most like it.`
            : `${plural(view.ideas.length, 'idea')}.`
          : undefined
      }
    />
  );

  if (!view) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        {header}
        <p className="text-body text-ink-muted">
          Your ideas could not be read just now, so the map is missing. Reload to try again.
        </p>
      </div>
    );
  }

  if (view.ideas.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        {header}
        <EmptyState
          icon={Orbit}
          title="No ideas on the map yet"
          description={
            view.missing > 0
              ? `${plural(view.missing, 'idea')} ${view.missing === 1 ? 'is' : 'are'} waiting for the daily run to place ${view.missing === 1 ? 'it' : 'them'}.`
              : 'Ideas land here as Learn writes them, from subjects, lessons and your notes.'
          }
        />
      </div>
    );
  }

  const nameOf = new Map(view.ideas.map((idea) => [idea.id, idea.name]));
  const selected = params.idea
    ? (view.ideas.find((idea) => idea.id === params.idea) ?? null)
    : null;

  return (
    <MainRail
      main={
        <>
          {header}
          <MapSection view={view} params={params} hasSelection={selected !== null} />
        </>
      }
      rail={
        <>
          {selected && <ChosenIdea idea={selected} view={view} params={params} nameOf={nameOf} />}
          <SameIdeas view={view} nameOf={nameOf} />
          <UntestedNearKnown view={view} nameOf={nameOf} />
        </>
      }
    />
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// -- The map -----------------------------------------------------------------

function MapSection({
  view,
  params,
  hasSelection,
}: {
  view: IdeaMapView;
  params: MapParams;
  hasSelection: boolean;
}) {
  // From the ideas rather than the placed domains: colouring by domain needs
  // no field to have been placed, only each idea's own domain.
  const domains = ideaDomains(view.ideas);
  const slots = domainSlots(domains);
  const placed = view.areas.fields.length + view.areas.domains.length > 0;

  const dots: PlotDot[] = view.ideas.map((idea) => {
    const at = framePosition(params.layout === 'axes' ? idea.pca : idea.neighbourMap);
    const slot = idea.domain ? (slots.get(idea.domain.id) ?? 'other') : 'none';
    return {
      id: idea.id,
      name: idea.name,
      left: at.left,
      top: at.top,
      mark: markOf(idea.state),
      slot,
      neighbours: idea.neighbours.map((n) => n.id),
    };
  });

  const selected = params.idea
    ? (view.ideas.find((idea) => idea.id === params.idea) ?? null)
    : null;
  const areas = params.labels && placed ? areaLabels(view, params, selected) : null;

  return (
    <section aria-label="The map">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Switch
          label="Layout"
          options={[
            {
              label: 'Neighbours',
              href: mapHref(params, { layout: 'neighbours' }),
              on: params.layout === 'neighbours',
            },
            {
              label: 'Main axes',
              href: mapHref(params, { layout: 'axes' }),
              on: params.layout === 'axes',
            },
          ]}
        />
        <Switch
          label="Colour"
          options={[
            {
              label: 'What you know',
              href: mapHref(params, { colour: 'state' }),
              on: params.colour === 'state',
            },
            {
              label: 'Domain',
              href: mapHref(params, { colour: 'domain' }),
              on: params.colour === 'domain',
            },
          ]}
        />
        {placed && (
          <Switch
            label="Names"
            options={[
              {
                label: 'Field names',
                href: mapHref(params, { labels: !params.labels }),
                on: params.labels,
              },
            ]}
          />
        )}
      </div>

      <Card padding="none">
        <div className="p-1 sm:p-2">
          <IdeaPlot key={params.idea ?? 'none'} dots={dots} areas={areas} params={params} />
        </div>
        <div className="card-pad-x pb-(--card-p)">
          <Legend params={params} dots={dots} domains={domains} slots={slots} />
          <MapNotes view={view} params={params} placed={placed} hasSelection={hasSelection} />
        </div>
      </Card>
    </section>
  );
}

/** What the map cannot show by itself: what is missing from it, and how far to trust the axes. */
function MapNotes({
  view,
  params,
  placed,
  hasSelection,
}: {
  view: IdeaMapView;
  params: MapParams;
  placed: boolean;
  hasSelection: boolean;
}) {
  return (
    <div className="mt-2 space-y-1 text-ui text-ink-muted">
      {!hasSelection && <p>Tap an idea to see its six nearest.</p>}
      {params.layout === 'axes' && (
        <p>
          These two axes keep {Math.round((view.variance.first + view.variance.second) * 100)}% of
          how your ideas differ, so two ideas close here can still be far apart.
        </p>
      )}
      {!placed && <p>Field and domain names show once the daily run has placed the fields.</p>}
      {placed && params.labels && view.areas.fieldsMissing > 0 && (
        <p>
          {plural(view.areas.fieldsMissing, 'field is', 'fields are')} not placed yet; the daily run
          places them.
        </p>
      )}
      {view.missing > 0 && (
        <p>
          {plural(view.missing, 'idea is', 'ideas are')} not on the map yet. The daily run gives{' '}
          {view.missing === 1 ? 'it' : 'them'} a place.
        </p>
      )}
    </div>
  );
}

/** Each domain the ideas are in, with how many of them. */
function ideaDomains(
  ideas: readonly IdeaOnMap[],
): { id: string; name: string; ideaCount: number }[] {
  const found = new Map<string, { id: string; name: string; ideaCount: number }>();
  for (const idea of ideas) {
    if (!idea.domain) continue;
    const entry = found.get(idea.domain.id) ?? { ...idea.domain, ideaCount: 0 };
    entry.ideaCount += 1;
    found.set(idea.domain.id, entry);
  }
  return [...found.values()];
}

/** The field and domain names, with whether each fits on a phone and wider. */
function areaLabels(view: IdeaMapView, params: MapParams, selected: IdeaOnMap | null): PlotArea[] {
  const at = (area: { pca: { x: number; y: number }; neighbourMap: { x: number; y: number } }) =>
    framePosition(params.layout === 'axes' ? area.pca : area.neighbourMap);

  const labels: (AreaLabel & { visited: boolean })[] = [
    // Domains first: they are fewer and say more.
    ...view.areas.domains.map((domain) => ({
      id: `domain:${domain.id}`,
      text: domain.name,
      kind: 'domain' as const,
      ...at(domain),
      priority: 10_000 + domain.ideaCount,
      visited: domain.ideaCount > 0,
    })),
    ...view.areas.fields.map((field) => ({
      id: `field:${field.id}`,
      text: field.name,
      kind: 'field' as const,
      ...at(field),
      priority: field.ideaCount,
      visited: field.ideaCount > 0,
    })),
  ];
  // The open idea's name goes down first and every other name gives way to
  // it. It is drawn by the map itself, so it is fitted here and left out.
  const fitted: AreaLabel[] = [...labels];
  if (selected) {
    fitted.push({
      id: 'idea',
      text: selected.name,
      kind: 'idea',
      ...at(selected),
      priority: Number.POSITIVE_INFINITY,
      raise: SELECTED_RAISE_PX,
    });
  }
  const phone = labelsThatFit(fitted, LABEL_FRAMES.phone);
  const wide = labelsThatFit(fitted, LABEL_FRAMES.wide);
  return labels.map((label) => ({
    ...label,
    fitsPhone: phone.has(label.id),
    fitsWide: wide.has(label.id),
  }));
}

function Switch({
  label,
  options,
}: {
  label: string;
  options: { label: string; href: string; on: boolean }[];
}) {
  return (
    <span role="group" aria-label={label} className={segmentedFrame}>
      {options.map((option) => (
        <Link
          key={option.label}
          href={option.href}
          scroll={false}
          aria-pressed={options.length === 1 ? option.on : undefined}
          aria-current={options.length > 1 && option.on ? 'true' : undefined}
          className={cn(
            'press inline-flex h-(--control-h) shrink-0 items-center px-2.5 text-ui font-medium whitespace-nowrap',
            'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
            option.on
              ? 'bg-accent-tint text-accent'
              : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
          )}
        >
          {option.label}
        </Link>
      ))}
    </span>
  );
}

/** What each mark means, with how many ideas wear it. */
function Legend({
  params,
  dots,
  domains,
  slots,
}: {
  params: MapParams;
  dots: PlotDot[];
  domains: { id: string; name: string; ideaCount: number }[];
  slots: Map<string, number>;
}) {
  const items: { key: string; mark: React.ReactNode; label: string; count: number }[] = [];

  if (params.colour === 'state') {
    const counts = new Map<StateMark, number>();
    for (const dot of dots) counts.set(dot.mark, (counts.get(dot.mark) ?? 0) + 1);
    for (const mark of STATE_MARKS) {
      const count = counts.get(mark) ?? 0;
      if (count === 0) continue;
      items.push({
        key: mark,
        mark: <Mark dot={{ mark, slot: 'none' }} colour="state" />,
        label: STATE_MARK_LABEL[mark],
        count,
      });
    }
  } else {
    const coloured = domains
      .filter((domain) => slots.has(domain.id))
      .sort((a, b) => slots.get(a.id)! - slots.get(b.id)!);
    for (const domain of coloured) {
      items.push({
        key: domain.id,
        mark: <circle r={1} style={{ fill: hueFill(slots.get(domain.id)!) }} />,
        label: domain.name,
        count: domain.ideaCount,
      });
    }
    const rest = domains.filter((domain) => !slots.has(domain.id));
    if (rest.length > 0) {
      items.push({
        key: 'other',
        mark: <Mark dot={{ mark: 'known', slot: 'other' }} colour="domain" />,
        label: plural(rest.length, coloured.length > 0 ? 'other domain' : 'domain'),
        count: rest.reduce((sum, domain) => sum + domain.ideaCount, 0),
      });
    }
    const none = dots.filter((dot) => dot.slot === 'none').length;
    if (none > 0) {
      items.push({
        key: 'none',
        mark: <Mark dot={{ mark: 'known', slot: 'none' }} colour="domain" />,
        label: 'No domain',
        count: none,
      });
    }
  }

  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-ui text-ink"
      aria-label="What the marks mean"
    >
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <svg viewBox="-2 -2 4 4" className="size-3 shrink-0" aria-hidden>
            <g transform="scale(1.4)">{item.mark}</g>
          </svg>
          {item.label}
          <span className="tabular text-ink-muted">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

// -- The rail ----------------------------------------------------------------

function ChosenIdea({
  idea,
  view,
  params,
  nameOf,
}: {
  idea: IdeaOnMap;
  view: IdeaMapView;
  params: MapParams;
  nameOf: Map<string, string>;
}) {
  const stateOf = new Map(view.ideas.map((other) => [other.id, other.state]));
  const facts: [string, string | null][] = [
    ['State', STATE_MARK_LABEL[markOf(idea.state)]],
    ['Subject', idea.track?.name ?? null],
    ['Field', idea.field?.name ?? null],
    ['Domain', idea.domain?.name ?? null],
  ];

  return (
    <Card padding="standard" id="chosen">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-body font-medium text-ink">
          <Link href={CONCEPT_HREF(idea.id)} className="press-area hover:text-accent">
            {idea.name}
          </Link>
        </h2>
        <Link
          href={mapHref(params, { idea: null })}
          scroll={false}
          aria-label="Close this idea"
          className="press-area -mr-1 shrink-0 rounded-control p-1 text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <X className="size-4" strokeWidth={2} aria-hidden />
        </Link>
      </div>
      <p className="mt-1 line-clamp-4 text-ui text-ink-muted">{idea.claim}</p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-ui">
        {facts.map(([label, value]) =>
          value ? (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>

      {idea.neighbours.length > 0 && (
        <>
          <h3 className="mt-4 text-ui font-semibold text-ink">Nearest ideas</h3>
          <ol className="mt-1 divide-y divide-border">
            {idea.neighbours.map((neighbour) => (
              <li key={neighbour.id}>
                <Link
                  href={mapHref(params, { idea: neighbour.id })}
                  scroll={false}
                  className="flex min-h-11 items-center gap-2 py-1.5 text-ui text-ink hover:text-accent"
                >
                  <svg viewBox="-2 -2 4 4" className="size-3 shrink-0" aria-hidden>
                    <g transform="scale(1.4)">
                      <Mark
                        dot={{ mark: markOf(stateOf.get(neighbour.id) ?? 'unknown'), slot: 'none' }}
                        colour="state"
                      />
                    </g>
                  </svg>
                  <span className="min-w-0 flex-1">{nameOf.get(neighbour.id) ?? 'An idea'}</span>
                  <span className="tabular shrink-0 text-small text-ink-muted">
                    {similarityText(neighbour.similarity)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

function RailList<T>({
  title,
  rows,
  render,
}: {
  title: string;
  rows: readonly T[];
  render: (row: T) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, LIST_SHOWN);
  const rest = rows.slice(LIST_SHOWN);
  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">
        {title}
        <span className="tabular ml-2 font-normal text-ink-muted">{rows.length}</span>
      </h2>
      <ul className="mt-1 divide-y divide-border">{shown.map(render)}</ul>
      {rest.length > 0 && (
        <Disclosure title={`${rest.length} more`} className="mt-1" bodyClassName="pl-0">
          <ul className="divide-y divide-border">{rest.map(render)}</ul>
        </Disclosure>
      )}
    </Card>
  );
}

function SameIdeas({ view, nameOf }: { view: IdeaMapView; nameOf: Map<string, string> }) {
  return (
    <RailList
      title="Probably the same idea"
      rows={view.similarPairs}
      render={(pair) => (
        <li key={`${pair.a}:${pair.b}`} className="flex items-start gap-2 py-2">
          <span className="min-w-0 flex-1 space-y-1">
            <IdeaLink id={pair.a} name={nameOf.get(pair.a)} />
            <IdeaLink id={pair.b} name={nameOf.get(pair.b)} />
          </span>
          <span className="tabular shrink-0 text-small text-ink-muted">
            {similarityText(pair.similarity)}
          </span>
        </li>
      )}
    />
  );
}

function UntestedNearKnown({ view, nameOf }: { view: IdeaMapView; nameOf: Map<string, string> }) {
  return (
    <RailList
      title="Not tested, among ideas you know"
      rows={view.untestedNearKnown}
      render={(row) => (
        <li key={row.id} className="py-2">
          <IdeaLink id={row.id} name={nameOf.get(row.id)} />
          <span className="tabular block text-small text-ink-muted">
            {row.known.length} of its {NEIGHBOURS_PER_IDEA} nearest known
          </span>
        </li>
      )}
    />
  );
}

function IdeaLink({ id, name }: { id: string; name: string | undefined }) {
  return (
    <Link href={CONCEPT_HREF(id)} className="press-area block text-ui text-ink hover:text-accent">
      {name ?? 'An idea'}
    </Link>
  );
}
