'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clapperboard, Square } from 'lucide-react';
import Link from '@/components/ui/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import type { IdeaMapView, IdeaOnMap } from '@/lib/learn/map/load';
import type { Point } from '@/lib/learn/map/layout';
import { ideaGraph, openedFrom, paramsFor, type IdeaGraph } from '@/lib/learn/map/place-graph';
import { TOUR_DWELL_MS, tourScript, type TourScript } from '@/lib/learn/map/tour';
import { dustAt } from '@/lib/learn/map/sky';
import { LIT_DELAY_MS, LIT_MS, lightingUp, litLine, recentlyLit } from '@/lib/learn/map/lights-up';
import { countsOf, mapOn, momentOf, timelineSpan, type LightThen } from '@/lib/learn/map/timeline';
import { DOMAIN_HUES, axisEnds, countText, domainSlots, mapHref, type AxisEnds, type MapParams } from '@/lib/learn/map/view';
import { usePick, viewOnClick } from './pick';
import { StarSky, type SkyName, type Star } from './star-sky';
import { StarSwatch } from './swatch';
import { MapTimeline } from './timeline';

/**
 * Idea Space's map with its layout switch, legend and caption (plan #1857),
 * drawn as a night sky since plan #1997.6.
 *
 * In the browser, so a switch redraws from the ideas already on the page
 * instead of asking the server to work both layouts out again. The address
 * still follows every switch (pick.tsx), so links and reloads keep the view.
 *
 * The timeline under the sky (plan #1997.8) replays how the map grew. Its day
 * is held here and not in the address, since playing it changes the day
 * several times a second. While a place is open as a graph the timeline is
 * put away and the map shows today.
 */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${countText(n)} ${n === 1 ? one : many}`;
}

/** How many domains the legend shows on a phone before the rest wait behind More. */
const DOMAINS_ON_A_PHONE = 1;

export function MapSection({
  view,
  pointingAt,
  daysAgo,
}: {
  view: IdeaMapView;
  pointingAt?: string | null;
  /** The gallery opens the timeline this many days before today. */
  daysAgo?: number;
}) {
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
  const graph = useOpenGraph(view);

  // The timeline: the day shown, and the map relit as it stood then.
  const today = useMemo(() => new Date(view.asOf), [view.asOf]);
  const span = useMemo(() => timelineSpan(view.ideas, today), [view.ideas, today]);
  const [day, setDay] = useState(() => Math.max(0, span.days - (daysAgo ?? 0)));
  const onDay = useCallback((next: number) => setDay(next), []);
  const shownDay = Math.min(day, span.days);
  const tour = useTour({ view, days: span.days, setDay: onDay, set });
  const past = !graph && shownDay < span.days;
  const replay = useMemo(
    () => (past ? mapOn(view.ideas, momentOf(span, shownDay, today)) : null),
    [past, view.ideas, span, shownDay, today],
  );
  const dust = useMemo(() => {
    const at = new Map(view.ideas.map((idea) => [idea.id, layout === 'axes' ? idea.pca : idea.neighbourMap]));
    const out: Point[] = [];
    for (const speck of view.dust) {
      const idea = at.get(speck.conceptId);
      // A note beside an idea not written yet waits with it.
      if (idea && (!replay || replay.has(speck.conceptId))) out.push(dustAt(idea, speck.noteId, speck.similarity));
    }
    return out;
  }, [view.ideas, view.dust, layout, replay]);
  // The legend counts the domains of the ideas on the map that day; colours stay as today's.
  const domainsThen = useMemo(
    () => (replay ? ideaDomains(view.ideas.filter((idea) => replay.has(idea.id))) : domains),
    [replay, view.ideas, domains],
  );
  const lights: readonly (Pick<LightThen, 'strength' | 'haze' | 'state'>)[] = replay ? [...replay.values()] : view.ideas;
  const lighting = useLightsUp(view, !!graph);


  const axes = layout === 'axes' ? axisEnds(view.ideas) : null;

  return (
    <section
      aria-label="The map"
      // Any press on the map, the timeline or the legend takes the tour's hands off.
      onPointerDownCapture={(event) => {
        if (!(event.target as Element).closest('[data-tour]')) tour.stop();
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Tab' && !(event.target as Element).closest('[data-tour]')) tour.stop();
      }}
    >
      {graph ? (
        <GraphBar graph={graph} view={view} params={params} set={set} tour={tour} />
      ) : (
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
          <TourButton tour={tour} />
        </div>
      )}

      <Card padding="none">
        <div className="p-1 sm:p-2">
          {!graph && axes?.top && <AxisName>↑ {axes.top}</AxisName>}
          <StarSky
            stars={stars}
            names={names}
            dust={dust}
            asOf={replay ? momentOf(span, shownDay, today).toISOString() : view.asOf}
            replay={replay ?? lighting.replay}
            label={`A night sky of ${plural(view.ideas.length, 'idea')}, each a star as bright as you know it`}
            pointingAt={pointingAt}
            graph={graph}
          />
          {!graph && <AxisEndsBelow axes={axes} />}
        </div>
        <div className="card-pad-x pb-(--card-p)">
          {!graph && span.days > 0 && (
            <MapTimeline start={span.start} days={span.days} day={shownDay} counts={countsOf(lights)} onDay={onDay} touring={tour.running} />
          )}
          <Legend params={params} set={set} lights={lights} domains={domainsThen} slots={slots} dust={dust.length} />
          <MapNotes view={view} params={params} graph={graph} past={past} litNames={lighting.names} />
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
    return view.places.map((place) => ({
      id: place.id,
      kind: 'place' as const,
      text: place.name,
      at: at(place),
      weight: place.ideaCount,
    }));
  }
  return view.areas.domains
    .filter((domain) => domain.ideaCount > 0)
    .map((domain) => ({
      id: domain.id,
      kind: 'domain' as const,
      text: domain.name,
      at: at(domain),
      weight: domain.ideaCount,
    }));
}

/**
 * The caption: what the map shows and how far to trust it, in two sentences
 * (Part 10, rule 7), then what is missing from it. The neighbour layout has
 * no axis, so the caption says so (rule 5). How to zoom and point is left to
 * the buttons on the map and the card a star shows.
 */
function MapNotes({
  view,
  params,
  graph,
  past,
  litNames,
}: {
  view: IdeaMapView;
  params: MapParams;
  graph: IdeaGraph | null;
  /** The timeline shows a day before today. */
  past: boolean;
  /** The ideas that lit in the last two days, named under the map. */
  litNames: readonly string[];
}) {
  const bright = past
    ? 'A star is as bright as you knew the idea on the day shown.'
    : 'A star is as bright as you know the idea today.';
  if (graph) {
    return (
      <div className="mt-2 space-y-1 text-ui text-ink-muted">
        <p>
          {graph.opened.kind === 'place'
            ? 'Every idea in this place is named in full'
            : 'This idea and its six nearest are named in full'}
          , and lines join the ideas most alike; the thicker the line, the closer the two. Point at or tap an idea
          to see all its links and their scores.
        </p>
        {graph.next.length > 0 && <p>The faint ideas round the edge are next door. Tap one to go there.</p>}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1 text-ui text-ink-muted">
      {params.layout === 'axes' ? (
        <p>
          {bright} Ideas sit along the two directions that keep{' '}
          {Math.round((view.variance.first + view.variance.second) * 100)}% of how they differ, so two close here
          can still be far apart.
        </p>
      ) : (
        <p>
          {bright} Only nearness means anything here: close stars are ideas
          about the same thing.
        </p>
      )}
      {!past && litLine(litNames) && <p className="text-ink">{litLine(litNames)}</p>}
      {view.places.length === 0 ? (
        <p>Your places are named by the daily run; until then the map names domains.</p>
      ) : (
        <p>Tap a place&rsquo;s name on the map, or pick one under Places, to open it as a graph.</p>
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
  lights,
  domains,
  slots,
  dust,
}: {
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
  /** Every idea on the map on the day shown, lit as it was then. */
  lights: readonly Pick<LightThen, 'strength' | 'haze' | 'state'>[];
  domains: { id: string; name: string; ideaCount: number }[];
  slots: Map<string, number>;
  dust: number;
}) {
  const [allDomains, setAllDomains] = useState(false);
  const lit = lights.filter((idea) => idea.strength > 0).length;
  const hazed = lights.filter((idea) => idea.strength <= 0 && idea.haze > 0.02).length;
  const dark = lights.length - lit - hazed;
  const mixedUp = lights.filter((idea) => idea.state === 'misconception').length;

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

/** The place or neighbourhood the address opens, worked out from the ideas on the page. */
export function useOpenGraph(view: IdeaMapView): IdeaGraph | null {
  const { params } = usePick();
  return useMemo(() => {
    const opened = openedFrom(params);
    return opened ? ideaGraph(view.ideas, view.places, opened) : null;
  }, [view.ideas, view.places, params]);
}

/** Above an open graph: the way back to the whole map, and what is open. */
function GraphBar({
  graph,
  view,
  params,
  set,
  tour,
}: {
  graph: IdeaGraph;
  view: IdeaMapView;
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
  tour: Tour;
}) {
  const back = { place: null, around: null };
  const strengthOf = new Map(view.ideas.map((idea) => [idea.id, idea.strength]));
  const known = graph.core.filter((id) => (strengthOf.get(id) ?? 0) > 0).length;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link
        href={mapHref(params, back)}
        scroll={false}
        onClick={viewOnClick(() => set(back))}
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
      >
        <ArrowLeft strokeWidth={1.75} aria-hidden />
        Whole map
      </Link>
      <h2 className="min-w-0 text-body font-medium text-ink">
        {graph.opened.kind === 'place' ? graph.title : `Around \u201c${graph.title}\u201d`}
        <span className="tabular ml-2 text-ui font-normal text-ink-muted">
          {plural(graph.core.length, 'idea')}, {countText(known)} known
        </span>
      </h2>
      <TourButton tour={tour} />
    </div>
  );
}

// -- An idea lights up (plan #1997.10) -----------------------------------------

/**
 * The moment on arrival: the ideas whose state was set in the last two days
 * brighten together from dark to their strength while the rest of the sky
 * holds still. Played once when the map opens on the
 * whole sky. With reduced motion nothing plays: the sky is lit as it stands,
 * and the line under the map still names what lit.
 */
function useLightsUp(view: IdeaMapView, graphOpen: boolean): { replay: Map<string, LightThen> | null; names: string[] } {
  const found = useMemo(() => recentlyLit(view.ideas, new Date(view.asOf)), [view.ideas, view.asOf]);
  const ids = useMemo(() => new Set(found.map((idea) => idea.id)), [found]);
  const [progress, setProgress] = useState<number | null>(null);
  const [startedOpen] = useState(graphOpen);

  useLayoutEffect(() => {
    if (found.length === 0 || startedOpen || reducedMotion()) return;
    // The first frame holds the stars dark and the wait runs from it, so
    // the sky never shows them lit before they go dark.
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const done = Math.min(Math.max(now - began - LIT_DELAY_MS, 0) / LIT_MS, 1);
      setProgress(done >= 1 ? null : done);
      if (done < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Played once for the ideas the page opened with.
  }, [found, startedOpen]);

  const replay = useMemo(
    () => (progress === null || graphOpen ? null : lightingUp(view.ideas, ids, progress)),
    [progress, graphOpen, view.ideas, ids],
  );
  return { replay, names: found.map((idea) => idea.name) };
}

// -- The scripted tour (plan #1997.9) ------------------------------------------

type TourPhase = { at: 'idle' } | { at: 'replay' } | { at: 'stop'; i: number } | { at: 'out' };

type Tour = { running: boolean; start: () => void; stop: () => void };

const SAME_ROUTE = { place: null, around: null, idea: null } as const;
/** A whole replay takes about this long, as the timeline's own play does. */
const TOUR_REPLAY_MS = 6000;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The same camera path every time: replay the map's growth to today, fly into
 * the place you know best, hop next door, pull back out. The route is fixed
 * when the tour starts (lib/learn/map/tour.ts). With reduced motion the
 * replay is skipped to today, and the flights cut, as they do for a press.
 * Pressing anywhere on the map ends it, through `stop`.
 */
function useTour({
  view,
  days,
  setDay,
  set,
}: {
  view: IdeaMapView;
  days: number;
  setDay: (day: number) => void;
  set: (change: Partial<MapParams>) => void;
}): Tour {
  const [phase, setPhase] = useState<TourPhase>({ at: 'idle' });
  const [script, setScript] = useState<TourScript>({ stops: [] });

  const stop = useCallback(() => setPhase((now) => (now.at === 'idle' ? now : { at: 'idle' })), []);
  const start = useCallback(() => {
    setScript(tourScript(view));
    set(SAME_ROUTE);
    setPhase({ at: 'replay' });
  }, [view, set]);

  useEffect(() => {
    if (phase.at === 'idle') return;
    const later = (ms: number, then: () => void) => {
      const timer = setTimeout(then, ms);
      return () => clearTimeout(timer);
    };
    const afterReplay = () => setPhase(script.stops.length > 0 ? { at: 'stop', i: 0 } : { at: 'idle' });

    if (phase.at === 'replay') {
      if (reducedMotion() || days === 0) {
        setDay(days);
        return later(TOUR_DWELL_MS.afterReplay, afterReplay);
      }
      let day = 0;
      let finish: (() => void) | undefined;
      setDay(0);
      const every = Math.min(Math.max(TOUR_REPLAY_MS / days, 40), 600);
      const timer = setInterval(() => {
        day += 1;
        setDay(Math.min(day, days));
        if (day >= days) {
          clearInterval(timer);
          finish = later(TOUR_DWELL_MS.afterReplay, afterReplay);
        }
      }, every);
      return () => {
        clearInterval(timer);
        finish?.();
      };
    }
    if (phase.at === 'stop') {
      const { i } = phase;
      set(paramsFor(script.stops[i]!));
      return later(TOUR_DWELL_MS.perStop, () => setPhase(i + 1 < script.stops.length ? { at: 'stop', i: i + 1 } : { at: 'out' }));
    }
    set(SAME_ROUTE);
    return later(TOUR_DWELL_MS.afterPullOut, () => setPhase({ at: 'idle' }));
  }, [phase, script, days, setDay, set]);

  return { running: phase.at !== 'idle', start, stop };
}

function TourButton({ tour }: { tour: Tour }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      data-tour
      aria-pressed={tour.running}
      onClick={tour.running ? tour.stop : tour.start}
      className="shrink-0"
    >
      {tour.running ? <Square strokeWidth={1.75} aria-hidden /> : <Clapperboard strokeWidth={1.75} aria-hidden />}
      {tour.running ? 'Stop the tour' : 'Take the tour'}
    </Button>
  );
}
