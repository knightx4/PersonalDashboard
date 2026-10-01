import { WatchingSection } from '@/app/home/watching';
import type { WatchingRow } from '@/lib/shell/watching-model';

/**
 * The home page's Watching section (plan #1295) in the surface gallery: one
 * watch that fired, one reporting quietly for a goal, and one whose page
 * stopped reading.
 */

const NOW = new Date('2026-09-30T15:10:00Z');

const ROWS: WatchingRow[] = [
  {
    id: 'w1',
    title: 'Jamie xx at Nowadays',
    url: 'https://www.crowdvolt.com/event/jamie-xx-nowadays',
    latest: 186,
    first: 210,
    readings: 14,
    currency: 'USD',
    checkedAt: '2026-09-30T14:23:00Z',
    failing: null,
    below: 200,
    fired: { value: 186, at: '2026-09-30T14:23:00Z' },
    reportTimes: ['09:00:00', '18:00:00'],
    endsAt: '2026-10-04T03:00:00Z',
    goal: { title: "Sam's birthday", href: '/goals/g1#step-s1' },
    report: {
      title: 'Down $24: Jamie xx at Nowadays',
      body: 'Cheapest is $186, from $210 when the watch started. 11 listings, top offer $150. Still at its low, so waiting has paid so far.',
      at: '2026-09-30T13:23:00Z',
    },
  },
  {
    id: 'w2',
    title: 'Fred again.. at Brooklyn Mirage, GA',
    url: 'https://www.crowdvolt.com/event/fred-again-mirage',
    latest: 142.5,
    first: 130,
    readings: 6,
    currency: 'USD',
    checkedAt: '2026-09-30T14:23:00Z',
    failing: null,
    below: null,
    fired: null,
    reportTimes: ['09:00:00'],
    endsAt: '2026-10-01T02:00:00Z',
    goal: null,
    report: null,
  },
  {
    id: 'w3',
    title: 'Four Tet at Knockdown Center',
    url: 'https://www.crowdvolt.com/event/four-tet-knockdown',
    latest: 95,
    first: 95,
    readings: 1,
    currency: 'USD',
    checkedAt: '2026-09-30T14:23:00Z',
    failing: 'No listings found on the page.',
    below: 80,
    fired: null,
    reportTimes: [],
    endsAt: '2026-10-12T02:00:00Z',
    goal: { title: 'See more live music', href: '/goals/g2' },
    report: null,
  },
];

export function WatchingSurface() {
  return <WatchingSection rows={ROWS} now={NOW} timezone="America/New_York" />;
}
