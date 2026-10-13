'use client';

import { Timeline, type TimelineEntry } from '@/components/ui/timeline';

/**
 * The timeline as /dev/ui draws it: every kind of mark, a gap of days, of
 * weeks and of months, the longest title and body a row gets, a link, an
 * action, and the empty state. A client file because an entry's action is a
 * function and the kit page is a server component.
 */

const ENTRIES: TimelineEntry[] = [
  {
    id: 'a',
    time: '2026-10-13T09:40:00Z',
    kind: 'done',
    title: 'Sent the cover letter to the research platform team',
    body: 'Attached the revised CV and the two-page project summary.',
    link: { href: '/jobs', label: 'Open the role' },
    action: { label: 'Undo', onSelect: () => {} },
  },
  { id: 'b', time: '2026-10-13T08:05:00Z', kind: 'started', title: 'Started the cover letter' },
  {
    id: 'c',
    time: '2026-10-10T16:20:00Z',
    kind: 'question',
    title: 'Asked which salary band to quote',
    body: 'Waiting on the recruiter to say whether the band in the advert is the whole range or only its floor, which changes what the letter should say about expectations.',
  },
  {
    id: 'd',
    time: '2026-10-09T12:00:00Z',
    kind: 'blocked',
    title: 'Reference form needs a signature',
    link: { href: 'https://example.com/form', label: 'Open the form' },
  },
  { id: 'e', time: '2026-09-18T10:00:00Z', kind: 'waiting', title: 'Waiting on the portfolio review' },
  { id: 'f', time: '2026-06-02T10:00:00Z', kind: 'dropped', title: 'Dropped the second role at the same company' },
  { id: 'g', time: '2026-06-01T10:00:00Z', kind: 'note', title: 'Found the role on the careers page' },
];

export function TimelineDemo() {
  return (
    <div className="space-y-5">
      <Timeline entries={ENTRIES} />
      <Timeline entries={[]} />
    </div>
  );
}
