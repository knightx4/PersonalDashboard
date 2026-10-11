'use client';

import { QuickNoteTriage, type TriageActions, type TriageNote } from '@/app/vault/triage/triage';

/*
 * Quick note triage in the gallery (plan #1729). Client-side because the
 * filing and search actions are functions, which a server render cannot hand
 * across.
 */

/** Every note a triage search can find in the gallery. */
const triagePlaces = [
  {
    path: 'Home/Boiler and heating.md',
    title: 'Boiler and heating',
    href: '/vault/n/Home/Boiler%20and%20heating.md',
  },
  {
    path: 'Money/Bank accounts and standing orders.md',
    title: 'Bank accounts and standing orders',
    href: '/vault/n/Money/Bank%20accounts%20and%20standing%20orders.md',
  },
  {
    path: 'Work/Projects/Replication/Failover drills we never ran and what they would have caught.md',
    title: 'Failover drills we never ran and what they would have caught',
    href: '/vault/n/Work/Projects/Replication/Failover%20drills.md',
  },
  { path: 'Ideas/On replication lag.md', title: 'On replication lag', href: '/vault/n/Ideas/On%20replication%20lag.md' },
  { path: 'Reading list.md', title: 'Reading list', href: '/vault/n/Reading%20list.md' },
];

/**
 * Quick notes waiting in the Inbox (plan #1729): one with three suggestions
 * and a long place name, one with a long title and body and one suggestion,
 * and one with none and no date.
 */
const triageNotes: TriageNote[] = [
  {
    id: 'triage-1',
    path: 'Inbox/Ask the landlord about the boiler service.md',
    title: 'Ask the landlord about the boiler service',
    body: 'Ask the landlord when the boiler was last serviced. The engineer said the pressure drops overnight and the valve might need replacing before winter.',
    blobSha: 'sha-1',
    written: '9 Oct 2026',
    href: '/vault/n/Inbox/Ask%20the%20landlord%20about%20the%20boiler%20service.md',
    excerpt: 'Ask the landlord when the boiler was last serviced.',
    suggestions: [triagePlaces[0]!, triagePlaces[1]!, triagePlaces[2]!],
  },
  {
    id: 'triage-2',
    path: 'Inbox/Replication lag during the failover test was worse than the dashboards showed.md',
    title: 'Replication lag during the failover test was worse than the dashboards showed',
    body: 'Replication lag during Tuesday’s failover test peaked at forty seconds, but the dashboard averaged it over a minute and showed twelve.\n\nWorth writing up before the next drill: which graph to trust, and whether the alert should read the peak instead of the mean.',
    blobSha: 'sha-2',
    written: '8 Oct 2026',
    href: '/vault/n/Inbox/Replication%20lag.md',
    excerpt: 'Replication lag during Tuesday’s failover test peaked at forty seconds.',
    suggestions: [triagePlaces[3]!],
  },
  {
    id: 'triage-3',
    path: 'Inbox/Buy picture hooks.md',
    title: 'Buy picture hooks',
    body: 'Picture hooks for the hall, the brass ones.',
    blobSha: 'sha-3',
    written: null,
    href: '/vault/n/Inbox/Buy%20picture%20hooks.md',
    excerpt: 'Picture hooks for the hall, the brass ones.',
    suggestions: [],
  },
];

/** Nothing is filed from the gallery; a search finds the fixtures by title. */
const triageActions: TriageActions = {
  file: async () => ({ reason: 'error', error: 'Nothing is filed from the gallery.' }),
  search: async (query) =>
    triagePlaces.filter((place) => place.title.toLowerCase().includes(query.toLowerCase())),
};

export function TriagePreview({ empty = false, writable }: { empty?: boolean; writable: boolean }) {
  return <QuickNoteTriage notes={empty ? [] : triageNotes} writable={writable} actions={triageActions} />;
}
