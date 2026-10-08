import { Bookmark, Search } from 'lucide-react';
import { DetailFacts, DetailPage, ListPage, ListRow } from '@/components/patterns/list-detail';
import { Deck, type DeckItem } from '@/components/patterns/deck';
import { ThreadPanel } from '@/components/patterns/thread';
import { TabbedDetail } from '@/components/patterns/tabbed-detail';
import { MainRail } from '@/components/patterns/main-rail';
import { TabbedSections } from '@/components/patterns/tabbed-sections';
import { Thread } from '@/components/thread/thread';
import { PageHeader } from '@/components/shell/page-header';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Group, SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import type { DevComment } from '@/lib/comments/load';
import type { Deck as DeckDeclaration } from '@/lib/preview/deck';
import { threadRef } from '@/lib/thread/subjects';
import type { Tab } from '@/lib/tabs';
import { OpenTab } from './open-tab';

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
  id: 'list-detail' | 'deck' | 'thread' | 'tabbed-detail' | 'main-rail' | 'tabbed-sections';
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

const FEATURE_TABS: readonly Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'steps', label: 'Steps', count: 10 },
];

const FEATURE_STEPS: readonly { number: number; title: string; state: string }[] = [
  { number: 1661, title: 'Which layout should the feature page and goal page use?', state: 'Answered' },
  { number: 1662, title: 'Use module, feature, step and substep as the level names', state: 'Done' },
  { number: 1663, title: 'Build the shared tabbed detail layout', state: 'In progress' },
  { number: 1664, title: 'Open each feature on its own page with an Overview', state: 'Ready' },
  { number: 1665, title: 'Group the Steps tab by status', state: 'Ready' },
  { number: 1666, title: "Keep Dash's latest update on each feature, with a health", state: 'Ready' },
  { number: 1667, title: 'Show what moved on the Activity tab', state: 'Ready' },
  { number: 1668, title: 'Split progress between you and Dash', state: 'Ready' },
  { number: 1670, title: 'Write an update from the feature page', state: 'Ready' },
  { number: 1671, title: 'Move the goal page onto the same layout', state: 'Ready' },
];

const FEATURE_ACTIVITY: readonly { when: string; what: string }[] = [
  { when: '7 Oct, 4:12 PM', what: 'Dash started #1663, Build the shared tabbed detail layout' },
  { when: '7 Oct, 3:40 PM', what: 'Dash closed #1662, Use module, feature, step and substep as the level names' },
  { when: '7 Oct, 11:05 AM', what: 'You answered #1661: add a fourth pattern, tabbed detail' },
  { when: '7 Oct, 10:20 AM', what: 'You approved the feature' },
];

function FeatureOverview() {
  return (
    <div className="space-y-6">
      <CardSection title="Latest update" meta="Dash · 7 Oct">
        <p className="text-body text-ink">
          On track. The level names are in, and the shared layout is being built now. The feature
          page itself comes next, then the goal page moves onto the same layout.
        </p>
      </CardSection>
      <CardSection title="What it is for">
        <p className="text-body text-ink">
          Each feature on the plan opens to its own page: breadcrumbs at the top, then Overview,
          Activity and Steps tabs, with a column of its properties beside them. The goal page moves
          onto the same layout so the two stay alike.
        </p>
      </CardSection>
    </div>
  );
}

function FeatureActivity() {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {FEATURE_ACTIVITY.map((event) => (
          <li key={event.what} className="card-pad-x row-pad">
            <p className="text-ui text-ink">{event.what}</p>
            <p className="tabular text-small text-ink-muted">{event.when}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FeatureSteps() {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {FEATURE_STEPS.map((step) => (
          <ListRow
            key={step.number}
            href="#"
            title={step.title}
            meta={`#${step.number}`}
            end={step.state}
          />
        ))}
      </ul>
    </Card>
  );
}

function TabbedSurface() {
  return (
    <TabbedDetail
      crumbs={[
        { label: 'Plan', href: '#' },
        { label: 'Dev', href: '#' },
        { label: 'Give each feature its own page with tabs', href: '#' },
      ]}
      title="Give each feature its own page with tabs"
      description="Feature #1660"
      properties={
        <PropertyList>
          <Property label="Status" value="In progress" />
          <Property label="Health" value="On track" />
          <Property label="Steps" value="2 of 10 done" />
          <Property label="Waiting on you" value="None" />
          <Property label="Dash has" value="7 steps" />
          <Property label="Module" value="Dev" />
          <Property label="Size" value="Large" />
          <Property label="Approved" value="7 Oct 2026" />
        </PropertyList>
      }
      tabs={FEATURE_TABS}
      label="Feature"
    >
      <OpenTab
        tabs={FEATURE_TABS}
        panels={{
          overview: <FeatureOverview />,
          activity: <FeatureActivity />,
          steps: <FeatureSteps />,
        }}
      />
    </TabbedDetail>
  );
}

const DAY_ROWS: readonly { title: string; meta: string; end: string }[] = [
  {
    title: 'Return the take-home for the Senior Quantitative Developer role at Jane Street',
    meta: 'Jobs · due tomorrow',
    end: '2h',
  },
  { title: 'Book the boiler service before the first cold week', meta: 'Home · from your notes', end: '15m' },
  { title: 'Read the two chapters before the reading group tonight', meta: 'Learn · Designing Data-Intensive Applications', end: '1h' },
  { title: 'Reply to Priya about the flat viewing', meta: 'Mail · waiting since Monday', end: '5m' },
];

const UPDATES: readonly { what: string; when: string }[] = [
  { what: 'Monzo moved your Platform Engineer application to a second interview', when: '9:12 AM' },
  { what: 'The council confirmed the bin collection moves to Wednesdays from November', when: '8:40 AM' },
  { what: 'Your Ocado order was delivered with one substitution', when: '7:55 AM' },
];

const WATCHING: readonly { what: string; state: string }[] = [
  { what: 'Wise, Backend Engineer, Payments', state: 'No reply in 9 days' },
  { what: 'Refund from the airline for the cancelled Lisbon flight', state: 'Promised by 10 Oct' },
  { what: 'Price of the standing desk you saved', state: 'Down £40' },
];

const DASH_TODAY: readonly string[] = [
  'Filed three receipts from your inbox under Spend',
  'Drafted the follow-up to Wise for you to read',
  'Closed two steps on the plan',
];

const WEEK: readonly { day: string; what: string }[] = [
  { day: 'Thu', what: 'Reading group, 7:00 PM' },
  { day: 'Fri', what: 'Take-home due' },
  { day: 'Sat', what: 'Dentist, 9:30 AM' },
  { day: 'Sun', what: 'Council tax' },
];

const WORKSPACES: readonly { name: string; count: string }[] = [
  { name: 'Jobs', count: '3 waiting' },
  { name: 'Learn', count: '2 due' },
  { name: 'Shopping', count: '1 to sell' },
  { name: 'News', count: '14 unread' },
];

function RailSurface() {
  return (
    <MainRail
      main={
        <>
          <PageHeader title="Thursday 8 October" description="Four things are yours today." />
          <div className="space-y-6">
            <Group title="Today">
              <Card padding="none">
                <ul className="divide-y divide-border">
                  {DAY_ROWS.map((row) => (
                    <ListRow key={row.title} href="#" title={row.title} meta={row.meta} end={row.end} />
                  ))}
                </ul>
              </Card>
            </Group>
            <Group title="Updates">
              <Card padding="none">
                <ul className="divide-y divide-border">
                  {UPDATES.map((update) => (
                    <li key={update.what} className="card-pad-x row-pad flex gap-3">
                      <span className="min-w-0 flex-1 text-ui text-ink">{update.what}</span>
                      <span className="tabular shrink-0 text-small text-ink-muted">{update.when}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </Group>
          </div>
        </>
      }
      rail={
        <>
          <CardSection id="watching" title="Watching" meta={WATCHING.length} className="scroll-mt-bar">
            <ul className="space-y-2">
              {WATCHING.map((item) => (
                <li key={item.what}>
                  <p className="text-ui text-ink">{item.what}</p>
                  <p className="text-small text-ink-muted">{item.state}</p>
                </li>
              ))}
            </ul>
          </CardSection>
          <CardSection title="Dash today" meta={DASH_TODAY.length}>
            <ul className="space-y-1.5">
              {DASH_TODAY.map((line) => (
                <li key={line} className="text-ui text-ink">
                  {line}
                </li>
              ))}
            </ul>
          </CardSection>
          <CardSection title="This week">
            <dl className="space-y-1.5">
              {WEEK.map((day) => (
                <div key={day.day} className="flex gap-3">
                  <dt className="w-9 shrink-0 text-small text-ink-muted">{day.day}</dt>
                  <dd className="min-w-0 text-ui text-ink">{day.what}</dd>
                </div>
              ))}
            </dl>
          </CardSection>
          <CardSection title="Workspaces">
            <ul className="space-y-1.5">
              {WORKSPACES.map((workspace) => (
                <li key={workspace.name} className="flex justify-between gap-3">
                  <span className="text-ui text-ink">{workspace.name}</span>
                  <span className="tabular text-small text-ink-muted">{workspace.count}</span>
                </li>
              ))}
            </ul>
          </CardSection>
        </>
      }
    />
  );
}

/**
 * Account's sections as #1628 may group them, five so the row is wider than
 * a phone. The fixture keeps its tab in `?section=` rather than `?tab=`,
 * because /dev/ui also draws the tabbed detail fixture and the two rows would
 * otherwise open each other's tabs.
 */
const SECTION_PARAM = 'section';

const ACCOUNT_TABS: readonly Tab[] = [
  { id: 'you', label: 'You' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'notifications', label: 'Notifications and spend', count: 2 },
  { id: 'history', label: 'History' },
  { id: 'session', label: 'Session' },
];

const CONNECTED: readonly { name: string; state: string }[] = [
  { name: 'Gmail, sam.okafor.personal@example.com', state: 'Read every morning at 6:00 AM' },
  { name: 'Google Calendar', state: 'Read every hour' },
  { name: 'GitHub', state: 'Token expires 2 Dec' },
];

const ALERTS: readonly { what: string; when: string }[] = [
  { what: 'Spend this month passed £30 of your £40 limit', when: '7 Oct' },
  { what: 'Push to this phone stopped after the browser was updated', when: '5 Oct' },
];

function AccountYou() {
  return (
    <div className="space-y-6">
      <CardSection title="Your details">
        {/* Side by side from sm, the email last so it takes what is left. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[repeat(3,auto)_minmax(0,1fr)] sm:gap-x-8">
          <Property label="Name" value="Sam Okafor" />
          <Property label="Time zone" value="Europe/London" />
          <Property label="Joined" value="14 Mar 2026" />
          <Property label="Email" value="sam.okafor.personal@example.com" />
        </dl>
      </CardSection>
      <SectionFold title="Connected accounts" count={CONNECTED.length}>
        <Card padding="none">
          <ul className="divide-y divide-border">
            {CONNECTED.map((account) => (
              <li key={account.name} className="card-pad-x row-pad">
                <p className="text-ui text-ink">{account.name}</p>
                <p className="text-small text-ink-muted">{account.state}</p>
              </li>
            ))}
          </ul>
        </Card>
      </SectionFold>
    </div>
  );
}

function AccountNotifications() {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {ALERTS.map((alert) => (
          <li key={alert.what} className="card-pad-x row-pad flex gap-3">
            <span className="min-w-0 flex-1 text-ui text-ink">{alert.what}</span>
            <span className="tabular shrink-0 text-small text-ink-muted">{alert.when}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountQuiet({ line }: { line: string }) {
  return (
    <Card>
      <p className="text-ui text-ink-muted">{line}</p>
    </Card>
  );
}

function SectionsSurface() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Account" description="Sam Okafor" />
      <TabbedSections tabs={ACCOUNT_TABS} label="Account" address={{ param: SECTION_PARAM }}>
        <OpenTab
          tabs={ACCOUNT_TABS}
          param={SECTION_PARAM}
          panels={{
            you: <AccountYou />,
            workspaces: <AccountQuiet line="Nine workspaces are on." />,
            notifications: <AccountNotifications />,
            history: <AccountQuiet line="Nothing changed this week." />,
            session: <AccountQuiet line="Signed in on this phone since 2 Oct." />,
          }}
        />
      </TabbedSections>
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
  {
    id: 'tabbed-detail',
    name: 'tabbed detail',
    label: 'Tabbed detail',
    when: 'One thing with several views of itself and a set of facts, such as a feature on the plan or a goal.',
    rule: 'Breadcrumbs first, then the title, then the tabs, then the open tab. Each tab is a link that puts the tab in the address, so a reload, the back button and a pasted link open the same tab, and the first tab is the plain address. The properties sit in a column on the right from laptop width and stay in view while the tab scrolls; on a phone they are a grid of facts between the title and the tabs. The row of tabs stays on one line at every width.',
    component: {
      path: 'components/patterns/tabbed-detail.tsx',
      exports: ['TabbedDetail'],
    },
    surfaces: [{ id: 'pattern-tabbed', label: 'A feature', render: () => <TabbedSurface /> }],
  },
  {
    id: 'main-rail',
    name: 'main plus rail',
    label: 'Main plus rail',
    when: 'An overview page with status worth keeping beside the work, such as Home.',
    rule: 'From laptop width a narrow column on the right holds what you glance at: counts, what is running, what Dash did, what is due soon. The column you work in sits on the left at its reading width. On a phone the rail follows the main column, and each is drawn once. The rail never holds the thing you came to act on, and never sits on a detail page, which stays one column.',
    component: { path: 'components/patterns/main-rail.tsx', exports: ['MainRail'] },
    surfaces: [{ id: 'pattern-rail', label: 'An overview', render: () => <RailSurface /> }],
  },
  {
    id: 'tabbed-sections',
    name: 'tabbed sections',
    label: 'Tabbed sections',
    when: 'A page of peer sections looked at one at a time, such as Account or a company. A page read top to bottom stays stacked, and two or three modes of one view, such as a board and a list, are a segmented control.',
    rule: 'The tabs sit under the page header, in one column, and only the open tab is drawn. Each tab is a link that puts it in the address, so a reload, the back button and a pasted link return to it, and old links and anchors land on the tab that holds them. A tab with something waiting in it carries the count. The row stays on one line, scrolling sideways on a phone with every tab a full press target. Folds may sit inside a tab.',
    component: { path: 'components/patterns/tabbed-sections.tsx', exports: ['TabbedSections'] },
    surfaces: [{ id: 'pattern-sections', label: 'Account', render: () => <SectionsSurface /> }],
  },
];
