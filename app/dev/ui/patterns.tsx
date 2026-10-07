import { Bookmark, Search } from 'lucide-react';
import { DetailFacts, DetailPage, ListPage, ListRow } from '@/components/patterns/list-detail';
import { Deck, type DeckItem } from '@/components/patterns/deck';
import { ThreadPanel } from '@/components/patterns/thread';
import { Thread } from '@/components/thread/thread';
import { PageHeader } from '@/components/shell/page-header';
import { Property } from '@/components/shell/detail-layout';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import type { DevComment } from '@/lib/comments/load';
import type { Deck as DeckDeclaration } from '@/lib/preview/deck';
import { threadRef } from '@/lib/thread/subjects';

/**
 * The page patterns (docs/UI-QUALITY-SPEC.md, Part 4), as data: each one's
 * name, its rule, the component a new screen starts from, and the gallery
 * surfaces that draw it.
 *
 * /dev/ui shows every entry under "Page patterns" with its rule and its
 * surfaces framed at 390 and 1280, the same way as the anatomies. The gallery
 * (app/preview/surfaces.tsx) registers the surfaces from this list, so a
 * pattern cannot be on /dev/ui without its picture. A plan step that makes a
 * screen names one of these by `name` ("Pattern: list and detail"), and the
 * design critic is given the pattern's rule to judge against.
 *
 * A screen that fits none of them is a new pattern, and the person decides
 * on it, because every later screen of that kind will follow it.
 */
export type PatternSurface = {
  /** Its id in /preview. */
  id: string;
  label: string;
  render: () => React.ReactNode;
  /** Declared to the phone checks when the surface is a deck (lib/preview/deck.ts). */
  deck?: DeckDeclaration;
};

export type PagePattern = {
  /** The fragment on /dev/ui. */
  id: 'list-detail' | 'deck' | 'thread';
  /** What a step's "Pattern:" line says, lower case. */
  name: string;
  /** The heading on /dev/ui. */
  label: string;
  /** The rule, as /dev/ui prints it and the critic reads it. */
  rule: string;
  /** Which screens it is for. */
  when: string;
  /** The file a new screen imports, and what it exports. */
  component: { path: string; exports: readonly string[] };
  surfaces: readonly PatternSurface[];
};

const ROLES: readonly { title: string; meta: string; when: string }[] = [
  {
    title: 'Senior Quantitative Developer, Systematic Trading Research Infrastructure',
    meta: 'Jane Street · London · Hybrid',
    when: '4 Oct',
  },
  { title: 'Platform Engineer', meta: 'Monzo · Remote', when: '3 Oct' },
  { title: 'Data Engineer', meta: 'Ocado Technology · Hatfield', when: '2 Oct' },
  { title: 'Backend Engineer, Payments', meta: 'Wise · London', when: '1 Oct' },
  { title: 'Research Engineer', meta: 'DeepMind · London', when: '30 Sep' },
  { title: 'Site Reliability Engineer', meta: 'Cloudflare · Lisbon', when: '29 Sep' },
  { title: 'Software Engineer II', meta: 'Spotify · Stockholm', when: '27 Sep' },
  { title: 'Machine Learning Engineer', meta: 'Faculty · London', when: '25 Sep' },
];

function ListSurface() {
  return (
    <ListPage
      header={
        <PageHeader
          title="Roles"
          actions={<Button size="sm">Add role</Button>}
        />
      }
      tools={
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input aria-label="Search the roles" placeholder="Search roles…" className="min-h-11 pl-9" />
        </div>
      }
      foot={`${ROLES.length} roles`}
    >
      {ROLES.map((role) => (
        <ListRow key={role.title} href="#" title={role.title} meta={role.meta} end={role.when} />
      ))}
    </ListPage>
  );
}

const POSTING = `We are looking for a quantitative developer to work alongside our systematic trading teams. You will build and maintain the research tooling that turns an idea into a backtest and a backtest into a live strategy.

You will own the data pipelines the researchers read from, and the simulator they test against. Most of the work is in Python, with the hot paths in C++.

The full posting is at https://example.com/jobs/quant-dev and the team's write-up of the simulator is at https://example.com/blog/simulator.`;

const TIMELINE: readonly { when: string; what: string }[] = [
  { when: '4 Oct', what: 'Take-home sent, two days to return it' },
  { when: '28 Sep', what: 'Screen with the hiring manager' },
  { when: '21 Sep', what: 'First reply from the recruiter' },
  { when: '18 Sep', what: 'Applied through the company board' },
];

function DetailSurface() {
  return (
    <DetailPage
      header={
        <PageHeader
          title={ROLES[0]!.title}
          description={ROLES[0]!.meta}
          actions={
            <Button size="sm" variant="secondary">
              Original posting
            </Button>
          }
        />
      }
      details={
        <DetailFacts>
          <Property label="Status" value="Take-home" />
          <Property label="Applied" value="18 Sep 2026" />
          <Property label="First reply" value="21 Sep 2026" />
          <Property label="Source" value="Company board" />
          <Property label="Pay" value="£120k to £160k" />
          <Property label="Posting" value="Open" />
          <Property label="Excitement" value="High" />
          <Property label="Referrer" value="None yet" />
        </DetailFacts>
      }
      text={
        <CardSection title="The posting">
          <p className="whitespace-pre-line text-body text-ink">
            <LinkedText text={POSTING} />
          </p>
        </CardSection>
      }
    >
      <Group title="Timeline">
        <Card padding="none">
          <ul className="divide-y divide-border">
            {TIMELINE.map((event) => (
              <li key={event.what} className="card-pad-x row-pad flex gap-3">
                <span className="tabular w-14 shrink-0 text-small text-ink-muted">
                  {event.when}
                </span>
                <span className="min-w-0 text-ui text-ink">{event.what}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Group>
    </DetailPage>
  );
}

const STORIES: readonly { headline: string; from: string; body: string }[] = [
  {
    headline: 'The EU agrees a common charger for laptops from 2027',
    from: 'The Verge · 6 Oct, 7:14 AM',
    body: 'Laptops sold in the EU will need a USB-C port that charges them, extending the rule phones have followed since last year. Makers have until spring 2027, and the rule covers fast-charging protocols too, so a charger from one brand runs another at full speed.',
  },
  {
    headline: 'Why the Bank of England held rates for a third month',
    from: 'Financial Times · 6 Oct, 6:30 AM',
    body: 'Services inflation stayed above four per cent, and the committee split six to three. The minutes say a cut in November is likely if wage growth keeps slowing, which the markets had already priced in.',
  },
  {
    headline: 'A small team rebuilt a 1970s synthesiser from the original schematics',
    from: 'Hackaday · 5 Oct, 9:02 PM',
    body: 'Three engineers spent two years tracing the boards of an instrument only forty were made of. Their build is open, parts list included, and costs about four hundred pounds to make at home.',
  },
];

const DECK_ITEMS: readonly DeckItem[] = STORIES.map((story) => ({
  key: story.headline,
  body: (
    <Card padding="standard" className="space-y-2">
      <p className="text-small text-ink-muted">{story.from}</p>
      <h2 className="text-title font-semibold text-ink">{story.headline}</h2>
      <p className="text-body text-ink">{story.body}</p>
    </Card>
  ),
  actions: (
    <Button size="lg" variant="secondary">
      <Bookmark className="size-4" strokeWidth={2} aria-hidden />
      Save
    </Button>
  ),
}));

function DeckSurface() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Quick read" />
      <Deck
        items={DECK_ITEMS}
        forward="Next story"
        done={
          <EmptyState
            tone="finished"
            title="That is everything"
            description="Every story from today's newsletters has been read or passed."
          />
        }
      />
    </div>
  );
}

const TURNS: DevComment[] = [
  {
    id: 'turn-1',
    author: 'me',
    body: '@dash the count on Home says three and the list shows four. Which one is wrong?',
    createdAt: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
  },
  {
    id: 'turn-2',
    author: 'claude',
    body: 'The list is right. The count leaves out steps that are waiting on you, and the fourth one is: it needs a key set in Vercel before it can start. I have reworded the count to say "ready" so the two read as different things.',
    createdAt: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
  },
  {
    id: 'turn-3',
    author: 'me',
    body: 'Good. Leave the key step where it is, I will set it tonight.',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
];

function ThreadSurface() {
  return (
    <div className="mx-auto max-w-2xl">
      <ThreadPanel title="Show the count on Home" href="#" meta="Step #412 · In progress · Dash">
        <Thread
          subject={threadRef('step', '00000000-0000-4000-8000-000000000415')}
          turns={TURNS}
          onCard
        />
      </ThreadPanel>
    </div>
  );
}

export const PATTERNS: readonly PagePattern[] = [
  {
    id: 'list-detail',
    name: 'list and detail',
    label: 'List and detail',
    when: 'A list you work through, and the page each row opens.',
    rule: 'Both pages are one column at every width. The list is the header with its one action, what the list is narrowed by, one surface of rows, then the count; pressing a row opens it. The item page is the header, then its details as a grid of facts, then its long text, then everything else.',
    component: {
      path: 'components/patterns/list-detail.tsx',
      exports: ['ListPage', 'ListRow', 'DetailPage', 'DetailFacts'],
    },
    surfaces: [
      { id: 'pattern-list', label: 'The list', render: () => <ListSurface /> },
      { id: 'pattern-detail', label: 'The item', render: () => <DetailSurface /> },
    ],
  },
  {
    id: 'deck',
    name: 'deck',
    label: 'Deck',
    when: 'Anything worked through one item at a time, as Quick read and Learn now are.',
    rule: 'One item on screen. The forward action is in the same place on every item, held above the tab bar on a phone. The next item is drawn before it is asked for, so forward shows it at once, and a swipe left brings it in as the current one leaves. When the last is passed the deck says so.',
    component: { path: 'components/patterns/deck.tsx', exports: ['Deck', 'DeckItem'] },
    surfaces: [
      {
        id: 'pattern-deck',
        label: 'A deck',
        render: () => <DeckSurface />,
        deck: { next: '[data-deck-next]', item: '[data-deck-item]' },
      },
    ],
  },
  {
    id: 'thread',
    name: 'thread',
    label: 'Thread',
    when: "A row's comments and Dash's replies.",
    rule: "The thread sits on one card with the row it is about. The row's name comes first and opens the row, then its state, then the turns oldest first on the card's own ground, Dash's on a recessed ground of their own, and the box last, closed until it is pressed.",
    component: { path: 'components/patterns/thread.tsx', exports: ['ThreadPanel'] },
    surfaces: [{ id: 'pattern-thread', label: 'A thread', render: () => <ThreadSurface /> }],
  },
];
