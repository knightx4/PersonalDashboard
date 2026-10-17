'use client';

import { useMemo, useState } from 'react';
import Link from '@/components/ui/link';
import { Orbit } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { MainRail } from '@/components/patterns/main-rail';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { NEIGHBOURS_PER_IDEA } from '@/lib/learn/map/idea-map';
import type { IdeaMapView } from '@/lib/learn/map/load';
import { countText, mapHref, type MapParams } from '@/lib/learn/map/view';
import { ChosenIdea } from './chosen-idea';
import { MapSection, useOpenGraph } from './map-section';
import { PickProvider } from './pick';
import { PageColumn } from '@/components/shell/page-width';
import { PlaceRail } from './place-rail';
import { RecordingCard } from './recording-card';
import { TopicRail } from './topic-rail';
import { GoalRail } from './goal-rail';
import { NextTopicsCard } from './next-topics-card';
import type { NextTopic } from '@/lib/learn/map/next-topics';
import { NOT_RECORDING, viewFor, type Recording } from '@/lib/learn/map/recording';
import { ALL_LAYERS, layeredView, type Layers } from '@/lib/learn/map/layers';

/**
 * The Idea Space page (plan #1857): every topic of a subject you prepared on
 * one map (plan #2317.2), apart from the read so the gallery draws it from
 * fixtures.
 *
 * Main plus rail. The map is what the page is for and sits in the main
 * column with its switches and legend; the rail holds what you glance at
 * beside it: the topic you tapped and its six nearest, your subjects, and
 * the untested topics surrounded by ones you know.
 *
 * The view (layout, the open topic, the domain picked out) is held by `PickProvider`
 * in the browser and changes at once; the address follows, so a reload and a
 * pasted link still open the same view (law 5).
 */

const TOPIC_HREF = (id: string) => `/learn/topics/${id}`;

/** How many rows a rail list shows before the rest fold away. */
const LIST_SHOWN = 5;

export function IdeaSpaceView({
  view: whole,
  params,
  pointingAt,
  daysAgo,
  recording: saved = NOT_RECORDING,
  save,
  chooseOpen,
  zoomOn,
  nextTopics,
  holdNext,
  layersOn = ALL_LAYERS,
  holdQuote,
  holdMore,
  pickThen,
}: {
  /** Null when the ideas could not be read, which the page says in place (law 2). */
  view: IdeaMapView | null;
  params: MapParams;
  /** The gallery holds the card open over this idea, as a pointer would. */
  pointingAt?: string | null;
  /** The gallery opens the timeline this many days before today. */
  daysAgo?: number;
  /** Recording mode as the person last left it (plan #1997.9). */
  recording?: Recording;
  /** Remembers a change to it; the gallery passes none and keeps it in the page. */
  save?: (recording: Recording) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The gallery draws the recording card's list of places open. */
  chooseOpen?: boolean;
  /** The gallery opens the map flown into this topic (plan #2016.5). */
  zoomOn?: string | null;
  /**
   * The topics next to what you know (plan #2016.6): null when they could not
   * be read, undefined where nothing loads them.
   */
  nextTopics?: NextTopic[] | null;
  /** The gallery holds this goal's next rung open in the rail (plan #2187.2). */
  holdNext?: string | null;
  /** The gallery draws the layers as they were left: answers, courses and work, writing (plan #2187.5). */
  layersOn?: Layers;
  /** The gallery draws the open topic's quote open, as a tap would. */
  holdQuote?: boolean;
  /** The gallery draws the open idea's fold of further evidence open. */
  holdMore?: boolean;
  /** The gallery draws the then and now tab's day picker open (plan #2187.6). */
  pickThen?: boolean;
}) {
  const [recording, setRecording] = useState(saved);
  const [layers, setLayers] = useState(layersOn);
  // Names are made private here, once, so nothing below can draw one. The
  // layers are applied after, so a layer off hides what it drew under the
  // stand-in names too.
  const view = useMemo(() => (whole ? layeredView(viewFor(whole, recording), layers) : null), [whole, recording, layers]);
  const header = (
    <PageHeader
      subject={{
        ref: null,
        path: [
          { label: 'Learn', href: '/learn' },
          { label: 'Know', href: '/learn/know' },
          { label: 'Idea Space', href: mapHref(params, { idea: null, place: null, around: null, topic: null }) },
        ],
      }}
      title="Idea Space"
      description={
        view && view.ideas.length > 0
          ? `${plural(view.ideas.length, 'topic')}${view.missing > 0 ? `, and ${countText(view.missing)} waiting for the daily run to place ${view.missing === 1 ? 'it' : 'them'}` : ''}.`
          : undefined
      }
    />
  );

  if (!view) {
    return (
      <PageColumn>
        {header}
        <p className="text-body text-ink-muted">
          Your topics could not be read just now, so the map is missing. Reload to try again.
        </p>
      </PageColumn>
    );
  }

  if (view.ideas.length === 0) {
    return (
      <PageColumn>
        {header}
        <EmptyState
          icon={Orbit}
          title="No topics on the map yet"
          description={
            view.missing > 0
              ? `${plural(view.missing, 'topic')} ${view.missing === 1 ? 'is' : 'are'} waiting for the daily run to place ${view.missing === 1 ? 'it' : 'them'}.`
              : 'Topics land here when Learn prepares a subject for you.'
          }
        />
      </PageColumn>
    );
  }

  const nameOf = new Map(view.ideas.map((idea) => [idea.id, idea.name]));

  return (
    <PickProvider params={params}>
      <MainRail
        main={
          <>
            {header}
            <MapSection view={view} pointingAt={pointingAt} daysAgo={daysAgo} zoomOn={zoomOn} pickThen={pickThen} />
          </>
        }
        rail={
          <>
            <ChosenIdea ideas={view.ideas} places={view.places} asOf={view.asOf} layers={layers} onLayers={setLayers} moreOpen={holdMore} />
            <PlaceRail view={view} layers={layers} onLayers={setLayers} holdQuote={holdQuote} />
            <GoalRail goals={view.goals} holdNext={holdNext} />
            <TopicRail frame={view.topics} />
            <NextTopicsCard topics={nextTopics} />
            <RecordingCard places={whole?.places ?? []} recording={recording} onChange={setRecording} save={save} chooseOpen={chooseOpen} />
            <UntestedNearKnown view={view} nameOf={nameOf} />
          </>
        }
      />
    </PickProvider>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${countText(n)} ${n === 1 ? one : many}`;
}

// -- The rail ----------------------------------------------------------------

function RailList<T>({
  title,
  rows,
  render,
  foot,
}: {
  title: string;
  rows: readonly T[];
  render: (row: T) => React.ReactNode;
  /** A line under the list, such as where to act on it. */
  foot?: React.ReactNode;
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
      {foot}
    </Card>
  );
}

function UntestedNearKnown({ view, nameOf }: { view: IdeaMapView; nameOf: Map<string, string> }) {
  // With a subject or a neighbourhood open, only its own topics.
  const graph = useOpenGraph(view);
  const open = graph ? new Set(graph.core) : null;
  return (
    <RailList
      title="Not tested, among topics you know"
      rows={open ? view.untestedNearKnown.filter((row) => open.has(row.id)) : view.untestedNearKnown}
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
    <Link href={TOPIC_HREF(id)} className="press-area block text-ui text-ink hover:text-accent">
      {name ?? 'A topic'}
    </Link>
  );
}
