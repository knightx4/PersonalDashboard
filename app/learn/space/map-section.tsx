'use client';

import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import type { IdeaMapView, IdeaOnMap } from '@/lib/learn/map/load';
import {
  DOMAIN_HUES,
  STATE_MARKS,
  STATE_MARK_LABEL,
  axisEnds,
  domainSlots,
  hueFill,
  mapHref,
  markOf,
  type MapParams,
  type StateMark,
} from '@/lib/learn/map/view';
import { IdeaPlot, Mark, type PlotArea, type PlotDot } from './idea-plot';
import { TapHint, usePick, viewOnClick } from './pick';

/**
 * Idea Space's map with its switches, legend and caption (plan #1857).
 *
 * In the browser, so a switch redraws from the ideas already on the page
 * instead of asking the server to work both layouts out again. The address
 * still follows every switch (pick.tsx), so links and reloads keep the view.
 */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function MapSection({ view }: { view: IdeaMapView }) {
  const { params, set } = usePick();
  // From the ideas rather than the placed domains: colouring by domain needs
  // no field to have been placed, only each idea's own domain.
  const domains = ideaDomains(view.ideas);
  const slots = domainSlots(domains);
  const placed = view.areas.fields.length + view.areas.domains.length > 0;

  const dots: PlotDot[] = view.ideas.map((idea) => {
    const slot = idea.domain ? (slots.get(idea.domain.id) ?? 'other') : 'none';
    return {
      id: idea.id,
      name: idea.name,
      at: params.layout === 'axes' ? idea.pca : idea.neighbourMap,
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
          params={params}
          set={set}
          label="Layout"
          options={[
            {
              label: 'Neighbours',
              change: { layout: 'neighbours' },
              on: params.layout === 'neighbours',
            },
            {
              label: 'Main axes',
              change: { layout: 'axes' },
              on: params.layout === 'axes',
            },
          ]}
        />
        <Switch
          params={params}
          set={set}
          label="Colour"
          options={[
            {
              label: 'What you know',
              change: { colour: 'state', domain: null },
              on: params.colour === 'state',
            },
            {
              label: 'Domain',
              change: { colour: 'domain' },
              on: params.colour === 'domain',
            },
          ]}
        />
        {placed && (
          <Switch
            params={params}
            set={set}
            label="Names"
            options={[
              {
                label: 'Field names',
                change: { labels: !params.labels },
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
          <Legend params={params} set={set} dots={dots} domains={domains} slots={slots} />
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
          {Math.round((view.variance.first + view.variance.second) * 100)}% of how they differ, so
          two ideas close here can still be far apart.
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
    params.layout === 'axes' ? area.pca : area.neighbourMap;

  return [
    // Domains first: they are fewer and say more.
    ...view.areas.domains.map((domain) => ({
      id: `domain:${domain.id}`,
      text: domain.name,
      kind: 'domain' as const,
      at: at(domain),
      priority: 10_000 + domain.ideaCount,
      visited: domain.ideaCount > 0,
    })),
    ...view.areas.fields.map((field) => ({
      id: `field:${field.id}`,
      text: field.name,
      kind: 'field' as const,
      at: at(field),
      priority: field.ideaCount,
      visited: field.ideaCount > 0,
    })),
  ];
}

function Switch({
  params,
  set,
  label,
  options,
}: {
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
  label: string;
  options: { label: string; change: Partial<MapParams>; on: boolean }[];
}) {
  return (
    <span role="group" aria-label={label} className={segmentedFrame}>
      {options.map((option) => (
        <Link
          key={option.label}
          href={mapHref(params, option.change)}
          scroll={false}
          onClick={viewOnClick(() => set(option.change))}
          aria-pressed={options.length === 1 ? option.on : undefined}
          aria-current={options.length > 1 && option.on ? 'true' : undefined}
          className={cn(segmentClass(option.on), 'shrink-0 whitespace-nowrap')}
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
  set,
  dots,
  domains,
  slots,
}: {
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
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
    change?: Partial<MapParams>;
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
        change: { domain: on ? null : domain.id, idea: null },
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
            {item.change ? (
              <Link
                href={mapHref(params, item.change)}
                scroll={false}
                onClick={viewOnClick(() => set(item.change!))}
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
