'use client';

import { useMemo, useState } from 'react';
import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import type { IdeaMapView, IdeaOnMap } from '@/lib/learn/map/load';
import type { Point } from '@/lib/learn/map/layout';
import { dustAt } from '@/lib/learn/map/sky';
import { DOMAIN_HUES, axisEnds, countText, domainSlots, mapHref, type AxisEnds, type MapParams } from '@/lib/learn/map/view';
import { usePick, viewOnClick } from './pick';
import { StarSky, type SkyName, type Star } from './star-sky';
import { StarSwatch } from './swatch';

/**
 * Idea Space's map with its layout switch, legend and caption (plan #1857),
 * drawn as a night sky since plan #1997.6.
 *
 * In the browser, so a switch redraws from the ideas already on the page
 * instead of asking the server to work both layouts out again. The address
 * still follows every switch (pick.tsx), so links and reloads keep the view.
 */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${countText(n)} ${n === 1 ? one : many}`;
}

/** How many domains the legend shows on a phone before the rest wait behind More. */
const DOMAINS_ON_A_PHONE = 1;

export function MapSection({ view, pointingAt }: { view: IdeaMapView; pointingAt?: string | null }) {
  const { params, set } = usePick();
  const domains = useMemo(() => ideaDomains(view.ideas), [view.ideas]);
  const slots = useMemo(() => domainSlots(domains), [domains]);
  const layout = params.layout;

  const stars: Star[] = useMemo(
    () =>
      view.ideas.map((idea) => ({
        id: idea.id,
        name: idea.name,
        at: layout === 'axes' ? idea.pca : idea.neighbourMap,
        state: idea.state,
        stateRow: idea.stateRow,
        strength: idea.strength,
        haze: idea.haze,
        slot: idea.domain ? (slots.get(idea.domain.id) ?? 'other') : 'none',
        domainId: idea.domain?.id ?? null,
        neighbours: idea.neighbours.map((n) => n.id),
      })),
    [view.ideas, layout, slots],
  );

  const names = useMemo(() => skyNames(view, layout), [view, layout]);

  const dust = useMemo(() => {
    const at = new Map(view.ideas.map((idea) => [idea.id, layout === 'axes' ? idea.pca : idea.neighbourMap]));
    const out: Point[] = [];
    for (const speck of view.dust) {
      const idea = at.get(speck.conceptId);
      if (idea) out.push(dustAt(idea, speck.noteId, speck.similarity));
    }
    return out;
  }, [view.ideas, view.dust, layout]);

  const axes = layout === 'axes' ? axisEnds(view.ideas) : null;

  return (
    <section aria-label="The map">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span role="group" aria-label="Layout" className={segmentedFrame}>
          {(
            [
              { label: 'Neighbours', value: 'neighbours' },
              { label: 'Main axes', value: 'axes' },
            ] as const
          ).map((option) => (
            <Link
              key={option.value}
              href={mapHref(params, { layout: option.value })}
              scroll={false}
              onClick={viewOnClick(() => set({ layout: option.value }))}
              aria-current={layout === option.value ? 'true' : undefined}
              className={cn(segmentClass(layout === option.value), 'shrink-0 whitespace-nowrap')}
            >
              {option.label}
            </Link>
          ))}
        </span>
      </div>

      <Card padding="none">
        <div className="p-1 sm:p-2">
          {axes?.top && <AxisName>↑ {axes.top}</AxisName>}
          <StarSky
            stars={stars}
            names={names}
            dust={dust}
            asOf={view.asOf}
            label={`A night sky of ${plural(view.ideas.length, 'idea')}, each a star as bright as you know it`}
            pointingAt={pointingAt}
          />
          <AxisEndsBelow axes={axes} />
        </div>
        <div className="card-pad-x pb-(--card-p)">
          <Legend params={params} set={set} view={view} domains={domains} slots={slots} dust={dust.length} />
          <MapNotes view={view} params={params} />
        </div>
      </Card>
    </section>
  );
}

function AxisName({ children }: { children: React.ReactNode }) {
  return <p className="truncate px-2 pb-1 text-center text-small text-ink-muted">{children}</p>;
}

function AxisEndsBelow({ axes }: { axes: AxisEnds | null }) {
  if (!axes || !(axes.left || axes.right || axes.bottom)) return null;
  return (
    <div className="px-2 pt-1 pb-2 text-small text-ink-muted">
      {axes.bottom && <p className="truncate text-center">↓ {axes.bottom}</p>}
      {(axes.left || axes.right) && (
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-1/2 text-balance">{axes.left && <>← {axes.left}</>}</p>
          <p className="max-w-1/2 text-right text-balance">{axes.right && <>{axes.right} →</>}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The names the zoomed-out sky shows: its places, or its domains while the
 * daily run has named no place yet.
 */
function skyNames(view: IdeaMapView, layout: MapParams['layout']): SkyName[] {
  const at = (area: { pca: Point; neighbourMap: Point }) => (layout === 'axes' ? area.pca : area.neighbourMap);
  if (view.places.length > 0) {
    return view.places.map((place) => ({ id: place.id, text: place.name, at: at(place), weight: place.ideaCount }));
  }
  return view.areas.domains
    .filter((domain) => domain.ideaCount > 0)
    .map((domain) => ({ id: domain.id, text: domain.name, at: at(domain), weight: domain.ideaCount }));
}

/**
 * The caption: what the map shows and how far to trust it, in two sentences
 * (Part 10, rule 7), then what is missing from it. The neighbour layout has
 * no axis, so the caption says so (rule 5). How to zoom and point is left to
 * the buttons on the map and the card a star shows.
 */
function MapNotes({ view, params }: { view: IdeaMapView; params: MapParams }) {
  return (
    <div className="mt-2 space-y-1 text-ui text-ink-muted">
      {params.layout === 'axes' ? (
        <p>
          A star is as bright as you know the idea today. Ideas sit along the two directions that keep{' '}
          {Math.round((view.variance.first + view.variance.second) * 100)}% of how they differ, so two close here
          can still be far apart.
        </p>
      ) : (
        <p>
          A star is as bright as you know the idea today. Only nearness means anything here: close stars are ideas
          about the same thing.
        </p>
      )}
      {view.places.length === 0 && <p>Your places are named by the daily run; until then the map names domains.</p>}
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
function ideaDomains(ideas: readonly IdeaOnMap[]): { id: string; name: string; ideaCount: number }[] {
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
 * What the sky shows, with how many of each: brightness, haze, the ring for
 * an idea held wrongly, the dust, and every domain's colour, which can be
 * pressed to pick out its ideas.
 */
function Legend({
  params,
  set,
  view,
  domains,
  slots,
  dust,
}: {
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
  view: IdeaMapView;
  domains: { id: string; name: string; ideaCount: number }[];
  slots: Map<string, number>;
  dust: number;
}) {
  const [allDomains, setAllDomains] = useState(false);
  const lit = view.ideas.filter((idea) => idea.strength > 0).length;
  const hazed = view.ideas.filter((idea) => idea.strength <= 0 && idea.haze > 0.02).length;
  const dark = view.ideas.length - lit - hazed;
  const mixedUp = view.ideas.filter((idea) => idea.state === 'misconception').length;

  const marks: { key: string; swatch: React.ReactNode; label: string; count: number }[] = [
    {
      key: 'lit',
      swatch: (
        <span className="inline-flex">
          <StarSwatch strength={0.2} />
          <StarSwatch strength={0.55} />
          <StarSwatch strength={1} />
        </span>
      ),
      label: 'Known, dim to bright',
      count: lit,
    },
    { key: 'haze', swatch: <StarSwatch strength={0} haze={1} />, label: 'Not known, beside ideas you know', count: hazed },
    { key: 'dark', swatch: <StarSwatch strength={0} />, label: 'Not known yet', count: dark },
    { key: 'mixed', swatch: <StarSwatch strength={0} mixedUp />, label: 'Mixed up', count: mixedUp },
    { key: 'dust', swatch: <StarSwatch strength={0} dust />, label: 'Vault notes', count: dust },
  ];

  const ordered = [...domains].sort(
    (a, b) =>
      (slots.get(a.id) ?? DOMAIN_HUES.length) - (slots.get(b.id) ?? DOMAIN_HUES.length) ||
      b.ideaCount - a.ideaCount ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-muted" aria-label="What the stars mean">
        {marks
          .filter((mark) => mark.count > 0)
          .map((mark) => (
            <li key={mark.key} className="inline-flex items-center gap-1.5">
              {mark.swatch}
              {mark.label}
              <span className="tabular">{countText(mark.count)}</span>
            </li>
          ))}
      </ul>
      {ordered.length > 0 && (
        <ul
          className={cn(
            'flex gap-x-4 gap-y-1 text-small text-ink-muted sm:flex-wrap',
            allDomains ? 'flex-wrap' : 'flex-nowrap overflow-hidden',
          )}
          aria-label="Domains, by colour; press one to pick out its ideas"
        >
          {ordered.map((domain, i) => {
            const on = params.domain === domain.id;
            const change = { domain: on ? null : domain.id, idea: null };
            // On a phone the row stays on one line and ends in More: the
            // domain picked out shows, or the first when none is.
            const shownOnAPhone = params.domain ? on : i < DOMAINS_ON_A_PHONE;
            const folded = !allDomains && !shownOnAPhone;
            return (
              <li
                key={domain.id}
                className={cn('shrink-0 items-center whitespace-nowrap', folded ? 'hidden sm:inline-flex' : 'inline-flex')}
              >
                <Link
                  href={mapHref(params, change)}
                  scroll={false}
                  onClick={viewOnClick(() => set(change))}
                  aria-pressed={on}
                  className={cn(
                    'press-area inline-flex items-center gap-1.5 rounded-control hover:text-ink',
                    on && 'text-ink underline underline-offset-4',
                  )}
                >
                  <StarSwatch strength={1} slot={slots.get(domain.id) ?? 'other'} />
                  {domain.name}
                  <span className="tabular">{countText(domain.ideaCount)}</span>
                </Link>
              </li>
            );
          })}
          {!allDomains && ordered.length > DOMAINS_ON_A_PHONE && (
            <li className="inline-flex shrink-0 items-center whitespace-nowrap sm:hidden">
              <button
                type="button"
                onClick={() => setAllDomains(true)}
                className="press-area rounded-control text-ink hover:text-accent"
              >
                {`More (${ordered.length - 1})`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
