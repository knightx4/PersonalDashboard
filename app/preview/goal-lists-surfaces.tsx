import { GoalDetail, GoalDoneWhen } from '@/app/goals/[goalId]/goal-detail';
import { DetailCard } from '@/components/patterns/tabbed-detail';
import { GoalListChips, ListBody, type ListsSeam } from '@/app/goals/[goalId]/goal-lists';
import type { CollectionRecord } from '@/lib/goals/collections-store';
import { goalListViews, listTabId, type ListView } from '@/lib/goals/goal-lists';
import type { LinkedEvent, LinkedList, LinkedReading } from '@/lib/goals/links';
import type { GoalList } from '@/lib/goals/lists-store';
import type { GoalProgress } from '@/lib/goals/status';
import type { Goal } from '@/lib/goals/tree';
import { SetTab } from './set-tab';

/**
 * A goal's lists on its page (plan #2330.3), drawn from fixtures: the chips
 * under the done-when, the panel a chip opens with each of its states, and a
 * list's own tab on a goal with three lists.
 *
 * One goal, getting a pantry, with a list of its own of pantries to compare
 * and a linked list of readings from Learn. The pictures are drawn inline, so
 * the shots never wait on a shop's server.
 */

/** A pantry cabinet, as a picture a shop would give. */
function cabinet(fill: string, door: string): string {
  // ui-ok: raw-hex -- the colours of a photographed cabinet, which no theme repaints
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#ece8e1"/><rect x="24" y="8" width="32" height="64" rx="2" fill="${fill}"/><rect x="27" y="12" width="12" height="56" fill="${door}"/><rect x="41" y="12" width="12" height="56" fill="${door}"/><circle cx="37" cy="40" r="1.4" fill="#555"/><circle cx="43" cy="40" r="1.4" fill="#555"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const WHITE = cabinet('#f7f7f5', '#ffffff'); /* ui-ok: raw-hex -- a photographed cabinet's own colours */
const OAK = cabinet('#b98a57', '#c99c69'); /* ui-ok: raw-hex -- a photographed cabinet's own colours */

const pantry: Goal = {
  id: 'g-pantry',
  areaId: 'a-home',
  title: 'Get a pantry',
  acceptance: 'A pantry stands in its spot with the food in it.',
  status: 'open',
  position: 10,
  unit: null,
  target: null,
};

const PLACES = [
  { id: 'a-home', name: 'Home' },
  { id: 'a-money', name: 'Money' },
];

const PROGRESS: GoalProgress = {
  live: 4,
  done: 1,
  bands: { on_you: 2, waiting: 0, with_dash: 1, done: 1 },
  move: 'on_you',
  moves: { on_you: 2, with_dash: 1, waiting: 0, settled: 0 },
  questions: 0,
};

function record(id: string, data: CollectionRecord['data'], extra: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id,
    collectionId: 'l-pantries',
    data,
    version: 1,
    position: 0,
    source: 'typed',
    sourceRef: null,
    draft: false,
    asOf: null,
    updatedAt: '2026-10-17T09:00:00Z',
    ...extra,
  };
}

const PANTRY_FIELDS: GoalList['fields'] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'picture', label: 'Picture', type: 'image' },
  { key: 'width', label: 'Wide (in)', type: 'number' },
  { key: 'depth', label: 'Deep (in)', type: 'number' },
  { key: 'price', label: 'Price', type: 'money' },
  { key: 'status', label: 'Status', type: 'choice', options: ['Considering', 'Picked', 'Ruled out'] },
  { key: 'link', label: 'Link', type: 'link' },
];

const pantries: GoalList = {
  id: 'l-pantries',
  goalId: pantry.id,
  name: 'Pantry options',
  position: 0,
  version: 1,
  fields: PANTRY_FIELDS,
  rows: [
    record('r-homcom', {
      name: 'HOMCOM 72 inch kitchen pantry with four doors and adjustable shelves',
      picture: WHITE,
      width: 30,
      depth: 15.75,
      price: 189.99,
      status: 'Picked',
      link: 'https://shop.example.com/homcom-72',
    }),
    record('r-oak', { name: 'Oak freestanding larder', picture: OAK, width: 24, depth: 16, price: 239, status: 'Considering', link: 'https://shop.example.com/oak-larder' }),
    record('r-tall', { name: 'Tall narrow cabinet', width: 12, depth: 12, price: 74.5, status: 'Ruled out' }),
  ],
};

/** The same list with a row a pasted link filled in, waiting to be confirmed. */
const pantriesWithDraft: GoalList = {
  ...pantries,
  rows: [
    ...pantries.rows,
    record(
      'r-draft',
      { name: 'Sauder Select pantry cabinet', picture: OAK, price: 152 },
      { draft: true, source: 'pasted', sourceRef: 'https://shop.example.com/sauder-select' },
    ),
  ],
};

const groups: GoalList = {
  id: 'l-groups',
  goalId: pantry.id,
  name: 'Shops to look at',
  position: 1,
  version: 1,
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'link', label: 'Link', type: 'link' },
    { key: 'notes', label: 'Notes', type: 'long_text' },
  ],
  rows: [],
};

function reading(id: string, title: string | null, status: string, extra: Partial<LinkedReading> = {}): LinkedReading {
  return {
    kind: 'reading',
    linkId: `link-${id}`,
    targetId: id,
    listName: 'Reading',
    gone: false,
    href: `/learn/r/${id}`,
    title,
    status,
    startedAt: null,
    finishedAt: null,
    ...extra,
  };
}

const readings: LinkedList = {
  name: 'Reading',
  kinds: ['reading'],
  rows: [
    reading('rd-1', 'How to measure a wall for freestanding furniture', 'read'),
    reading('rd-2', 'Kitchen storage that does not need a contractor', 'reading'),
    reading('rd-3', 'Anchoring tall furniture to a plaster wall', 'queued'),
    reading('rd-4', 'The case against open shelving', 'abandoned'),
    reading('rd-5', null, 'queued', { gone: true, href: null }),
  ],
};

/** Comments on the readings, as Learn's threads hold them. */
const COMMENTS = new Map([
  ['link-rd-1', 2],
  ['link-rd-2', 1],
]);

/** Shops to see a pantry in before buying, with a place for each and the day to go. */
const SHOP_FIELDS: GoalList['fields'] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'where', label: 'Where', type: 'place' },
  { key: 'visit', label: 'Visit on', type: 'date' },
  { key: 'link', label: 'Link', type: 'link' },
];

const shops: GoalList = {
  id: 'l-shops',
  goalId: pantry.id,
  name: 'Shops to visit',
  position: 1,
  version: 1,
  fields: SHOP_FIELDS,
  rows: [
    record('s-habitat', {
      name: 'Habitat Tottenham Court Road',
      where: { address: '121 Tottenham Court Rd, London W1T 5AZ', lat: 51.5219, lng: -0.1344 },
      visit: '2026-10-24',
      link: 'https://shop.example.com/habitat',
    }),
    record('s-heals', {
      name: 'Heals furniture store',
      where: { address: '196 Tottenham Court Rd, London W1T 7LQ', lat: 51.5207, lng: -0.1338 },
      link: 'https://shop.example.com/heals',
    }),
    record('s-ikea', {
      name: 'IKEA Tottenham',
      where: { address: '6 Glover Dr, London N18 3HF', lat: 51.6106, lng: -0.0466 },
      visit: '2026-10-31',
    }),
    record('s-camden', { name: 'Camden reclaim yard', where: { address: 'Chalk Farm Rd, Camden' } }),
  ],
};

/** The same shops before any has an address. */
const shopsNoPlaces: GoalList = {
  ...shops,
  rows: [
    record('s-a', { name: 'The reclaim yard Dan mentioned' }),
    record('s-b', { name: 'A second-hand shop near work' }),
  ],
};

function event(id: string, title: string, extra: Partial<LinkedEvent>): LinkedEvent {
  return {
    kind: 'event',
    linkId: `link-${id}`,
    targetId: id,
    listName: 'Furniture fairs',
    gone: false,
    href: `/todo/calendar?event=${id}`,
    title,
    location: null,
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    ...extra,
  };
}

/** Events from the Todo calendar: two on one day, one next month, one past. */
const fairs: LinkedList = {
  name: 'Furniture fairs',
  kinds: ['event'],
  rows: [
    event('e-1', 'Vintage furniture flea at Spitalfields', { startsOn: '2026-10-24', location: 'Old Spitalfields Market' }),
    event('e-2', 'Measure the alcove with Sam', { startsAt: '2026-10-24T10:00:00Z' }),
    event('e-3', 'London Design Fair late opening', { startsAt: '2026-10-29T18:00:00Z', location: 'Old Truman Brewery' }),
    event('e-4', 'Kitchen show at Olympia', { startsOn: '2026-11-07', location: 'Olympia London' }),
    event('e-5', 'Car boot sale', { startsOn: '2026-10-04' }),
  ],
};

const views = (own: GoalList[], linked: LinkedList[] = [readings]): ListView[] =>
  goalListViews(own, linked, { today: '2026-10-17', timeZone: 'UTC', comments: COMMENTS });

function Frame({ lists, children }: { lists?: ListView[]; children: React.ReactNode }) {
  return (
    <GoalDetail goal={pantry} areaName="Home" places={PLACES} review={null} progress={PROGRESS} timeZone="UTC" lists={lists}>
      {children}
    </GoalDetail>
  );
}

function Overview({ lists, seam }: { lists: ListView[]; seam?: ListsSeam }) {
  return (
    <Frame lists={lists}>
      <div className="space-y-6">
        <GoalDoneWhen goal={pantry}>
          <GoalListChips goalId={pantry.id} goalTitle={pantry.title} lists={lists} seam={seam} />
        </GoalDoneWhen>
      </div>
    </Frame>
  );
}

/** The Overview with two lists: the pantries to compare and the readings from Learn. */
export function GoalListsSurface() {
  return <Overview lists={views([pantries])} />;
}

/** The pantry chip pressed: the panel over the page, a draft from a pasted link waiting to be confirmed. */
export function GoalListsPanelSurface() {
  return <Overview lists={views([pantriesWithDraft])} seam={{ open: 'pantry-options' }} />;
}

/** The readings chip pressed: each row from Learn, two with comments, one gone, and the fold of one put down, open. */
export function GoalListsLinkedSurface() {
  return <Overview lists={views([pantries])} seam={{ open: 'reading', ruledOutOpen: true }} />;
}

/** A pasted link the reader refused, said under the add box. */
export function GoalListsErrorSurface() {
  return (
    <Overview
      lists={views([pantries])}
      seam={{
        open: 'pantry-options',
        typed: 'https://intranet.local/pantry',
        addState: { error: 'That page could not be opened. Type its name instead, or try another link.' },
      }}
    />
  );
}

/** A list just started, with nothing in it yet. */
export function GoalListsEmptySurface() {
  return <Overview lists={views([pantries, groups])} seam={{ open: 'shops-to-look-at' }} />;
}

/** A pasted link being read: the row waiting at the foot of the table. */
export function GoalListsLoadingSurface() {
  return (
    <Overview lists={views([pantries])} seam={{ open: 'pantry-options', adding: 'https://shop.example.com/sauder-select' }} />
  );
}

/** Three lists, so each has a tab after Steps; the pantries' tab open. */
export function GoalListsTabSurface() {
  const lists = views([pantriesWithDraft, groups]);
  const list = lists[0];
  return (
    <>
      <SetTab tab={listTabId(list.key)} />
      <Frame lists={lists}>
        <DetailCard>
          <ListBody goalId={pantry.id} list={list} />
        </DetailCard>
      </Frame>
    </>
  );
}

/** The pantries open on Gallery: every picture in a grid. */
export function GoalListsGallerySurface() {
  return <Overview lists={views([pantries])} seam={{ open: 'pantry-options', view: 'gallery' }} />;
}

/** The fairs from the calendar: this month with two on one day, and what is coming listed under it. */
export function GoalListsCalendarSurface() {
  return <Overview lists={views([pantries], [fairs])} seam={{ open: 'furniture-fairs' }} />;
}

/** A day pressed: its popover names each row on it with its link. */
export function GoalListsCalendarDaySurface() {
  return (
    <Overview lists={views([pantries], [fairs])} seam={{ open: 'furniture-fairs', views: { day: '2026-10-24' } }} />
  );
}

/** A month with nothing in it, stepped to with the arrows. */
export function GoalListsCalendarEmptySurface() {
  return (
    <Overview lists={views([pantries], [fairs])} seam={{ open: 'furniture-fairs', views: { month: '2026-12' } }} />
  );
}

/** The shops on the map: three pins, and one with an address but no point listed under it. */
export function GoalListsMapSurface() {
  return <Overview lists={views([pantries, shops])} seam={{ open: 'shops-to-visit', view: 'map' }} />;
}

/** A pin pressed: its row's name, link and address over the foot of the map. */
export function GoalListsMapPinSurface() {
  return (
    <Overview lists={views([pantries, shops])} seam={{ open: 'shops-to-visit', view: 'map', views: { pin: 1 } }} />
  );
}

/** A list with a place field and no address in it yet. */
export function GoalListsMapEmptySurface() {
  return <Overview lists={views([pantries, shopsNoPlaces])} seam={{ open: 'shops-to-visit', view: 'map' }} />;
}

/** The tiles would not load, so the table stands in for the map. */
export function GoalListsMapFailedSurface() {
  return (
    <Overview
      lists={views([pantries, shops])}
      seam={{ open: 'shops-to-visit', view: 'map', views: { tilesFailed: true } }}
    />
  );
}
