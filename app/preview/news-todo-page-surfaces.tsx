import { NewsListView } from '@/app/news/all/list-view';
import { StoryView } from '@/app/news/i/[id]/s/[index]/story-view';
import { NewsSettingsView } from '@/app/news/settings/settings-view';
import { AllTasksView } from '@/app/todo/all/all-view';
import { agendaSourceGroups, TodoSettingsView } from '@/app/todo/settings/settings-view';
import { WaitingView } from '@/app/todo/waiting/waiting-view';
import type { NewsIssue, NewsSender, UnreadStories } from '@/lib/news/issues/list';
import type { NewsStory } from '@/lib/news/issues/stories';
import type { Anchor } from '@/lib/todo/agenda/anchors';
import type { Feed } from '@/lib/todo/feeds/load';
import type { Task } from '@/lib/todo/tasks/model';
import type { Waiting } from '@/lib/todo/waiting/load';

/**
 * The News and Todo pages that had no picture (plan #1603), each drawn by the
 * view its page hands its reads to, from fixtures shaped like the live rows.
 */

const ZONE = 'Europe/London';

// ---- News: the newsletter list ---------------------------------------------

const senders: NewsSender[] = [
  { id: 's1', email: 'hello@morningbrew.com', name: 'Morning Brew', muted: false },
  { id: 's2', email: 'newsletter@theeconomist.com', name: 'The Economist this week', muted: false },
  { id: 's3', email: 'dispatch@localpaper.co.uk', name: 'Hackney Citizen weekly dispatch', muted: false },
  { id: 's4', email: 'noreply@substack-writer-with-a-long-name.substack.com', name: null, muted: true },
];

function issue(over: Partial<NewsIssue> & Pick<NewsIssue, 'id' | 'senderId' | 'receivedAt'>): NewsIssue {
  return { subject: null, readAt: null, summaryLine: null, ...over };
}

const issues: NewsIssue[] = [
  issue({
    id: 'i1',
    senderId: 's1',
    subject: 'Markets slip as the Fed keeps rates where they are for a third month running',
    receivedAt: '2026-10-07T06:02:00Z',
    summaryLine: 'Rates held, a chip maker’s results and why airline fares are falling.',
  }),
  issue({
    id: 'i2',
    senderId: 's3',
    subject: 'The council votes on the Mare Street cycle lane',
    receivedAt: '2026-10-06T17:30:00Z',
    summaryLine: 'A vote on Thursday, two new cafés and the library’s winter hours.',
  }),
  issue({
    id: 'i3',
    senderId: 's2',
    subject: 'The world this week',
    receivedAt: '2026-10-04T09:00:00Z',
    readAt: '2026-10-04T12:00:00Z',
    summaryLine: 'Elections in Europe, a ceasefire that held and the price of cocoa.',
  }),
  issue({
    id: 'i4',
    senderId: 's1',
    subject: 'Confirm your subscription',
    receivedAt: '2026-09-29T08:15:00Z',
    readAt: '2026-09-29T08:20:00Z',
  }),
  issue({ id: 'i5', senderId: 's4', subject: 'Notes from the garden, part 12', receivedAt: '2026-09-28T19:00:00Z' }),
];

const unread: UnreadStories[] = [
  {
    senderId: 's1',
    stories: [
      { headline: 'Rates held', summary: 'The Fed waited.', topic: 'Business' },
      { headline: 'Fares fall', summary: 'Airlines cut prices.', topic: 'World' },
    ],
  },
  {
    senderId: 's3',
    stories: [{ headline: 'Cycle lane vote', summary: 'Thursday.', topic: 'Local' }],
  },
];

export function NewsAllSurface() {
  return (
    <NewsListView
      timezone={ZONE}
      senders={senders}
      issues={issues}
      unread={unread}
      from={undefined}
      topic={null}
      viewParam={undefined}
      gap={null}
    />
  );
}

// ---- News: one story -------------------------------------------------------

const story: NewsStory = {
  headline: 'The council votes on Thursday on whether the Mare Street cycle lane becomes permanent',
  summary:
    'After an eighteen-month trial the council will decide whether to keep the lane, take it out or move it to Morning Lane. Traders want the loading bays back; the cycling campaign has a petition with four thousand names.',
  link: 'https://example.com/hackney/mare-street-lane',
  text: 'The trial began in April last year, when the council took out one lane of traffic between the Narrow Way and Well Street and put in a kerbed lane in each direction.\n\nCounts taken by the council show about 2,400 bicycles a day now use the street, up from 900 before the trial. Bus journey times through the stretch rose by about a minute at the evening peak.\n\nThe meeting is at 7pm at the town hall and is open to the public. Anyone who wants to speak has to register by noon on Wednesday.',
  topic: 'Local',
};

export function NewsStorySurface() {
  return (
    <StoryView
      back={{ href: '/news', label: 'News' }}
      issue={{ id: 'i2', receivedAt: '2026-10-06T17:30:00Z', sender: senders[2] }}
      story={story}
      storyIndex={0}
      timezone={ZONE}
      saved={false}
      sent={undefined}
    />
  );
}

// ---- News: settings --------------------------------------------------------

export function NewsSettingsSurface() {
  return (
    <NewsSettingsView
      address="reader-7k2m9q4x@news.example.com"
      gap={null}
      hidden={['Sport', 'Lifestyle']}
      localArea="Hackney, London"
    />
  );
}

// ---- Todo: all tasks -------------------------------------------------------

function task(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    body: null,
    status: 'open',
    dueOn: null,
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-10-01T09:00:00Z',
    position: null,
    parentId: null,
    ...over,
  };
}

const tasks: Task[] = [
  task({ id: 't1', title: 'Book the dentist', dueOn: '2026-10-07' }),
  task({
    id: 't2',
    title: 'Send Dana the paper on columnar storage she asked about at the end of the second interview',
    dueOn: '2026-10-09',
  }),
  task({ id: 't3', title: 'Return the kettle to Argos before the 30 days are up', dueOn: '2026-10-12' }),
  task({ id: 't4', title: 'Print the boarding passes', parentId: 't9', dueOn: '2026-10-15' }),
  task({ id: 't5', title: 'Renew the house insurance', pinned: true }),
  task({ id: 't6', title: 'Read the chapter on elasticity' }),
];

const anchors = new Map<string, Anchor>([
  ['t2', { label: 'Quant developer at D. E. Shaw', href: '/jobs/roles/r1' }],
  ['t3', { label: 'Kettle, Argos order 1182-4410', href: '/shopping/returns' }],
]);

const parents = new Map<string, string>([['t4', 'Get ready for Lisbon']]);

export function TodoAllSurface() {
  return (
    <AllTasksView
      status="open"
      search=""
      focus=""
      tasks={tasks}
      timezone={ZONE}
      working={[]}
      threads={new Map()}
      anchors={anchors}
      parents={parents}
      seed="preview:2026-10-07:todo-all"
    />
  );
}

// ---- Todo: settings --------------------------------------------------------

const feeds: Feed[] = [
  {
    id: 'f1',
    name: 'Work',
    hint: 'calendar.google.com/…/basic.ics',
    shown: true,
    lastReadAt: '2026-10-07T08:55:00Z',
    lastError: null,
    createdAt: '2026-08-12T10:00:00Z',
  },
  {
    id: 'f2',
    name: 'Climbing club fixtures and socials',
    hint: 'outlook.office365.com/…/calendar.ics',
    shown: true,
    lastReadAt: '2026-10-05T08:55:00Z',
    lastError: 'The calendar answered 404: the address may have been reset.',
    createdAt: '2026-09-01T10:00:00Z',
  },
];

export function TodoSettingsSurface() {
  return (
    <TodoSettingsView
      groups={agendaSourceGroups(() => true)}
      enabled={['job_reminders', 'job_interviews', 'goal_steps', 'appointments', 'bills']}
      horizonDays={14}
      feeds={feeds}
      timezone={ZONE}
    />
  );
}

// ---- Todo: waiting ---------------------------------------------------------

const waiting: Waiting = {
  timezone: ZONE,
  failed: [],
  groups: [
    {
      key: 'name:d. e. shaw',
      name: 'D. E. Shaw',
      entries: [
        {
          key: 'a1',
          ref: 'jobs.applications:a1',
          module: 'jobs',
          title: 'Quantitative developer, systematic trading tooling',
          detail: 'Applied',
          why: 'They have your application and have not replied.',
          since: '2026-09-22T10:00:00Z',
          link: { href: '/jobs/roles/r1', label: 'Open the role' },
        },
      ],
    },
    {
      key: 'name:argos',
      name: 'Argos',
      entries: [
        {
          key: 'r1',
          ref: 'shopping.returns:r1',
          module: 'shopping',
          title: 'Kettle refund',
          detail: '£34.99',
          why: 'The parcel was handed in; the refund has not arrived.',
          since: '2026-10-02T15:00:00Z',
          link: { href: '/shopping/returns', label: 'Open the return' },
        },
        {
          key: 'r2',
          ref: 'shopping.returns:r2',
          module: 'shopping',
          title: 'Bedside lamp with a fabric shade, the wrong colour',
          detail: null,
          why: 'Waiting for the courier to collect it.',
          since: null,
          link: null,
        },
      ],
    },
  ],
};

export function TodoWaitingSurface() {
  return <WaitingView waiting={waiting} />;
}
