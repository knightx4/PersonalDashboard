import Link from 'next/link';
import { Orbit } from 'lucide-react';
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
  DOMAIN_HUES,
  STATE_MARKS,
  STATE_MARK_LABEL,
  axisEnds,
  domainSlots,
  framePosition,
  hueFill,
  mapHref,
  markOf,
  similarityText,
  type MapParams,
  type StateMark,
} from '@/lib/learn/map/view';
import { ChosenIdea } from './chosen-idea';
import { IdeaPlot, Mark, type PlotArea, type PlotDot } from './idea-plot';
import { PickProvider, TapHint } from './pick';

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
 *
 * The open idea is shared by the map and the rail through `PickProvider`, so
 * a tap shows in both before the address catches up (plan #1883).
 */

const CONCEPT_HREF = (id: string) => `/learn/c/${id}`;

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

  return (
    <PickProvider params={params}>
      <MainRail
        main={
          <>
            {header}
            <MapSection view={view} params={params} />
          </>
        }
        rail={
          <>
            <ChosenIdea ideas={view.ideas} />
            <SameIdeas view={view} nameOf={nameOf} />
            <UntestedNearKnown view={view} nameOf={nameOf} />
          </>
        }
      />
    </PickProvider>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// -- The map -----------------------------------------------------------------

function MapSection({ view, params }: { view: IdeaMapView; params: MapParams }) {
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
      domainId: idea.domain?.id ?? null,
      neighbours: idea.neighbours.map((n) => n.id),
    };
  });

  const areas = params.labels && placed ? areaLabels(view, params) : null;
  const axes = params.layout === 'axes' ? axisEnds(view.ideas) : null;

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
              href: mapHref(params, { colour: 'state', domain: null }),
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
          <IdeaPlot dots={dots} areas={areas} axes={axes} colour={params.colour} />
        </div>
        <div className="card-pad-x pb-(--card-p)">
          <Legend params={params} dots={dots} domains={domains} slots={slots} />
          <MapNotes view={view} params={params} placed={placed} />
        </div>
      </Card>
    </section>
  );
}

/**
 * The caption: what the map shows and how far to trust it (Part 10, rule 7),
 * then what is missing from it. The neighbour layout has no axis, so the
 * caption says so (rule 5).
 */
function MapNotes({
  view,
  params,
  placed,
}: {
  view: IdeaMapView;
  params: MapParams;
  placed: boolean;
}) {
  return (
    <div className="mt-2 space-y-1 text-ui text-ink-muted">
      {params.layout === 'axes' ? (
        <p>
          Ideas sit along the two directions in which your ideas differ most. These keep{' '}
          {Math.round((view.variance.first + view.variance.second) * 100)}% of how they differ, so two
          ideas close here can still be far apart.
        </p>
      ) : (
        <p>
          Close ideas are ones read as being about the same thing. The layout has no axes: up, down,
          left and right mean nothing, and only nearness does.
        </p>
      )}
      <TapHint />
      {params.colour === 'domain' && !params.domain && (
        <p>Press a domain under the map to pick out its ideas.</p>
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

/**
 * The field and domain names. Which of them fit, and where, is worked out on
 * the map itself, which knows the open idea and where every dot is.
 */
function areaLabels(view: IdeaMapView, params: MapParams): PlotArea[] {
  const at = (area: { pca: { x: number; y: number }; neighbourMap: { x: number; y: number } }) =>
    framePosition(params.layout === 'axes' ? area.pca : area.neighbourMap);

  return [
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
  const items: {
    key: string;
    mark: React.ReactNode;
    label: string;
    count: number;
    /** Pressing it picks out the domain's ideas on the map, or lets them go again. */
    href?: string;
    on?: boolean;
  }[] = [];

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
    // Every domain gets its own entry, the three with a colour first and then
    // the ones sharing the gray, so each can be pressed and picked out.
    const ordered = [...domains].sort(
      (a, b) =>
        (slots.get(a.id) ?? DOMAIN_HUES.length) - (slots.get(b.id) ?? DOMAIN_HUES.length) ||
        b.ideaCount - a.ideaCount ||
        a.name.localeCompare(b.name),
    );
    for (const domain of ordered) {
      const slot = slots.get(domain.id);
      const on = params.domain === domain.id;
      items.push({
        key: domain.id,
        mark:
          slot === undefined ? (
            <Mark dot={{ mark: 'known', slot: 'other' }} colour="domain" />
          ) : (
            <circle r={1} style={{ fill: hueFill(slot) }} />
          ),
        label: domain.name,
        count: domain.ideaCount,
        href: mapHref(params, { domain: on ? null : domain.id, idea: null }),
        on,
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
      className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-muted"
      aria-label="What the marks mean"
    >
      {items.map((item) => {
        const body = (
          <>
            <svg viewBox="-2 -2 4 4" className="size-3 shrink-0" aria-hidden>
              <g transform="scale(1.4)">{item.mark}</g>
            </svg>
            {item.label}
            <span className="tabular">{item.count}</span>
          </>
        );
        return (
          <li key={item.key} className="inline-flex items-center">
            {item.href ? (
              <Link
                href={item.href}
                scroll={false}
                aria-pressed={item.on}
                className={cn(
                  'press-area inline-flex items-center gap-1.5 rounded-control hover:text-ink',
                  item.on && 'text-ink underline underline-offset-4',
                )}
              >
                {body}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// -- The rail ----------------------------------------------------------------

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
