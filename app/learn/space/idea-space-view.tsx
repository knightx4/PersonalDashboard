import Link from '@/components/ui/link';
import { Orbit } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { MainRail } from '@/components/patterns/main-rail';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { NEIGHBOURS_PER_IDEA } from '@/lib/learn/map/idea-map';
import type { IdeaMapView } from '@/lib/learn/map/load';
import { mapHref, similarityText, type MapParams } from '@/lib/learn/map/view';
import { ChosenIdea } from './chosen-idea';
import { MapSection } from './map-section';
import { PickProvider } from './pick';

/**
 * The Idea Space page (plan #1857): every idea with an embedding on one map,
 * apart from the read so the gallery draws it from fixtures.
 *
 * Main plus rail. The map is what the page is for and sits in the main
 * column with its switches and legend; the rail holds what you glance at
 * beside it: the idea you tapped and its six nearest, then the two lists the
 * map turns up, ideas that are probably one idea twice and untested ideas
 * surrounded by ones you know.
 *
 * The view (layout, colour, names, the open idea) is held by `PickProvider`
 * in the browser and changes at once; the address follows, so a reload and a
 * pasted link still open the same view (law 5).
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
      description={view && view.ideas.length > 0 ? `${plural(view.ideas.length, 'idea')}.` : undefined}
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
            <MapSection view={view} />
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
