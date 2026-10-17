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
import {
  ideaGraph,
  openedFrom,
  paramsFor,
  territoryGraph,
  type IdeaGraph,
  type Ladder,
} from '@/lib/learn/map/place-graph';
import { TOUR_DWELL_MS, tourScript, type TourScript } from '@/lib/learn/map/tour';
import { dustAt, FAINTEST_MARK } from '@/lib/learn/map/sky';
import { LIT_DELAY_MS, LIT_MS, lightingUp, litLine, recentlyLit } from '@/lib/learn/map/lights-up';
import { countsOf, mapOn, momentOf, timelineSpan, type LightThen } from '@/lib/learn/map/timeline';
import { DOMAIN_HUES, axisEnds, countText, domainSlots, mapHref, type AxisEnds, type MapParams } from '@/lib/learn/map/view';
import { usePick, viewOnClick } from './pick';
import { StarSky, type Constellation, type SkyName, type SkyTopic, type Star } from './star-sky';
import { ringRadius } from '@/lib/learn/map/goals';
import { StarSwatch, TopicSwatch } from './swatch';
import { MapTimeline } from './timeline';
import { MapPanels } from './map-panels';
import { backedByText } from '@/lib/learn/evidence/model';

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
  zoomOn,
  pickThen,
}: {
  view: IdeaMapView;
  pointingAt?: string | null;
  /** The gallery opens the timeline this many days before today. */
  daysAgo?: number;
  /** The gallery opens the sky flown into this topic. */
  zoomOn?: string | null;
  /** The gallery draws the day picker under the map open (plan #2187.6). */
  pickThen?: boolean;
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
        exposure: idea.exposure,
        slot: idea.domain ? (slots.get(idea.domain.id) ?? 'other') : 'none',
        domainId: idea.domain?.id ?? null,
        neighbours: idea.neighbours.map((n) => n.id),
        backedBy: backedByText(idea.evidence),
        levels: idea.levels,
      })),
    [view.ideas, layout, slots],
  );

  const names = useMemo(() => skyNames(view, layout), [view, layout]);
  const topics: SkyTopic[] = useMemo(
    () =>
      (view.topics?.topics ?? []).map((topic) => ({
        ...topic,
        at: layout === 'axes' ? topic.pca : topic.neighbourMap,
      })),
    [view.topics, layout],
  );
  const graph = useOpenGraph(view);
  // The goal chosen in the rail, as lines and rings (plan #2187.2).
  const constellation: Constellation | null = useMemo(() => {
    const goal = params.goal ? view.goals?.find((g) => g.id === params.goal) : undefined;
    if (!goal) return null;
    const at = (star: (typeof goal.stars)[number]) => (layout === 'axes' ? star.pca : star.neighbourMap);
    const byId = new Map(goal.stars.map((star) => [star.topicId, at(star)]));
    return {
      stars: goal.stars.map((star) => ({ id: star.topicId, name: star.name, at: at(star), ring: ringRadius(star.targetLevel) })),
      lines: goal.links.flatMap((link) => {
        const from = byId.get(link.from);
        const to = byId.get(link.to);
        return from && to ? [{ from, to }] : [];
      }),
    };
  }, [params.goal, view.goals, layout]);

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
  const lights: readonly (Pick<LightThen, 'strength' | 'haze' | 'exposure' | 'state'>)[] = replay ? [...replay.values()] : view.ideas;
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
            topics={topics}
            zoomOn={zoomOn}
            dust={dust}
            asOf={replay ? momentOf(span, shownDay, today).toISOString() : view.asOf}
            replay={replay ?? lighting.replay}
            label={`A night sky of ${plural(view.ideas.length, 'topic')}, each a star as bright as your answers say you know it`}
            pointingAt={pointingAt}
            graph={graph}
            constellation={constellation}
          />
          {!graph && <AxisEndsBelow axes={axes} />}
        </div>
        <div className="card-pad-x pb-(--card-p)">
          {!graph && span.days > 0 && (
            <MapTimeline start={span.start} days={span.days} day={shownDay} counts={countsOf(lights)} onDay={onDay} touring={tour.running} />
          )}
          <Legend params={params} set={set} lights={lights} domains={domainsThen} slots={slots} dust={dust.length} />
          {!graph && view.topics && <TopicLegend counts={view.topics.counts} />}
          <MapNotes view={view} params={params} graph={graph} past={past} litNames={lighting.names} />
        </div>
      </Card>
      <MapPanels view={view} params={params} set={set} pickOpen={pickThen} />
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
    ? 'A star is as bright as your answers said you knew the topic on the day shown. A gold ring is one met in a course or your writing, or one you said you know.'
    : 'A star is as bright as your answers say you know the topic today. A gold ring is one met in a course or your writing, or one you said you know.';
  if (graph?.ladders) {
    const requires = graph.edges.some((edge) => edge.requires);
    const missed = [...graph.ladders.values()].some((ladder) => ladder.missed.length > 0);
    return (
      <div className="mt-2 space-y-1 text-ui text-ink-muted">
        <p>
          {requires
            ? 'Every topic of this subject is a star, and each line points at a topic it requires.'
            : 'Every topic of this subject is a star. None of them requires another yet, so no line joins them.'}{' '}
          The arc round a star is how far up its ladder you are, solid as far as an answer showed and faint where you
          hold it without one; the dashed ring is its target
          {missed ? ', and a red ring marks a level you missed.' : '.'}
          {requires && ' Point at or tap a star to see everything it requires and the level each needs.'}
        </p>
        {graph.route && graph.route.length > 0 ? (
          <p>
            A pulsing gold ring marks a star you are ready for now. The numbers and the dotted line are the order to
            take them in, and Start here opens the first.
          </p>
        ) : (
          <p>Nothing in this subject is ready to practise yet.</p>
        )}
        {graph.next.length > 0 && <p>The faint topics round the edge are next door. Tap one to go there.</p>}
      </div>
    );
  }
  if (graph) {
    return (
      <div className="mt-2 space-y-1 text-ui text-ink-muted">
        <p>
          {graph.opened.kind === 'place'
            ? 'Every topic in this subject is named in full'
            : 'This topic and its six nearest are named in full'}
          , and lines join the topics most alike; the thicker the line, the closer the two. Point at or tap a topic
          to see all its links and their scores.
        </p>
        {graph.next.length > 0 && <p>The faint topics round the edge are next door. Tap one to go there.</p>}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1 text-ui text-ink-muted">
      {params.layout === 'axes' ? (
        <p>
          {bright} Topics sit along the two directions that keep{' '}
          {Math.round((view.variance.first + view.variance.second) * 100)}% of how they differ, so two close here
          can still be far apart.
        </p>
      ) : (
        <p>
          {bright} Only nearness means anything here: close stars are topics
          about the same thing.
        </p>
      )}
      {!past && litLine(litNames) && <p className="text-ink">{litLine(litNames)}</p>}
      {view.places.length === 0 ? (
        <p>No subject has its topics placed yet, so the map names domains.</p>
      ) : (
        <p>Tap a subject&rsquo;s name to open its topics with the levels you hold, or a Wikipedia topic&rsquo;s name to fly into it.</p>
      )}
      {!view.topics && <p>The Wikipedia topics could not be read just now, so the map shows your topics without them.</p>}
    </div>
  );
}

/**
 * The topics' three states, with how many of each (plan #2016.5): lit by
 * what you know, unlocked by something that touches it, and the Level 4
 * topics still hidden, which are not drawn. Level 3 landmarks nothing touches
 * yet have a mark of their own.
 */
function TopicLegend({ counts }: { counts: NonNullable<IdeaMapView['topics']>['counts'] }) {
  const marks: { key: string; swatch: React.ReactNode; label: string; count: number }[] = [
    { key: 'lit', swatch: <TopicSwatch kind="lit" />, label: 'Wikipedia topic lit', count: counts.lit },
    { key: 'unlocked', swatch: <TopicSwatch kind="unlocked" />, label: 'Wikipedia topic unlocked', count: counts.unlocked },
    { key: 'landmark', swatch: <TopicSwatch kind="landmark" />, label: 'Level 3 Wikipedia topic, not touched yet', count: counts.untouched },
    { key: 'hidden', swatch: null, label: 'Level 4 Wikipedia topics hidden until something touches them', count: counts.hidden },
  ];
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-muted" aria-label="What the diamonds mean">
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
 * What the sky shows, with how many of each: brightness for what answers
 * lit, the gold halo for what you met untested, haze for what sits near what
 * you know (plan #2187.1), the ring for an idea held wrongly, the dust, and
 * every domain's colour, which can be pressed to pick out its ideas.
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
  lights: readonly Pick<LightThen, 'strength' | 'haze' | 'exposure' | 'state'>[];
  domains: { id: string; name: string; ideaCount: number }[];
  slots: Map<string, number>;
  dust: number;
}) {
  const [allDomains, setAllDomains] = useState(false);
  const lit = lights.filter((idea) => idea.strength > 0).length;
  const hazed = lights.filter((idea) => idea.strength <= 0 && idea.haze > FAINTEST_MARK).length;
  const dark = lights.length - lit - hazed;
  const met = lights.filter((idea) => idea.exposure > FAINTEST_MARK).length;
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
      label: 'Tested, dim to bright',
      count: lit,
    },
    {
      key: 'halo',
      swatch: <StarSwatch strength={0} exposure={1} />,
      label: 'Met, not tested yet',
      count: met,
    },
    { key: 'haze', swatch: <StarSwatch strength={0} haze={1} />, label: 'Near what you know', count: hazed },
    { key: 'dark', swatch: <StarSwatch strength={0} />, label: 'Not tested yet', count: dark },
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
          aria-label="Domains, by colour; press one to pick out its topics"
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
    if (opened?.kind === 'territory') {
      const territory = view.territories?.find((t) => t.id === opened.id);
      return territory ? territoryGraph(territory, opened.topic, view.ideas, view.places, params.layout) : null;
    }
    // A subject's place is its territory (plan #2317.2): it opens on the first
    // topic you are ready for, or its first topic.
    const territory = opened?.kind === 'place' ? view.territories?.find((t) => t.id === opened.id) : undefined;
    if (territory) {
      const first = territory.ready?.find((cell) => territory.topics.some((t) => t.id === cell.topicId))?.topicId;
      const topic = first ?? territory.topics[0]?.id;
      return topic ? territoryGraph(territory, topic, view.ideas, view.places, params.layout) : null;
    }
    return opened ? ideaGraph(view.ideas, view.places, opened) : null;
  }, [view.ideas, view.places, view.territories, params]);
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
  const back = { place: null, around: null, topic: null };
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
        {graph.opened.kind === 'around' ? `Around \u201c${graph.title}\u201d` : graph.title}
        <span className="tabular ml-2 text-ui font-normal text-ink-muted">
          {graph.ladders
            ? `${plural(graph.core.length, 'topic')}, ${countText(atTarget(graph.ladders))} at target`
            : `${plural(graph.core.length, 'topic')}, ${countText(known)} known`}
        </span>
      </h2>
      <TourButton tour={tour} />
    </div>
  );
}

/** How many of a territory's topics hold their target level; a topic with no target is not counted. */
function atTarget(ladders: ReadonlyMap<string, Ladder>): number {
  let n = 0;
  for (const ladder of ladders.values()) if (ladder.target !== null && ladder.held >= ladder.target) n += 1;
  return n;
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
