import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { VaultHomeView, type NoteFolderGroup } from '@/app/vault/home-view';
import { VaultMapView } from '@/app/vault/map/map-view';
import { ThemeView } from '@/app/vault/map/[id]/theme-view';
import { MayaListView } from '@/app/vault/maya/maya-view';
import { MayaThreadView } from '@/app/vault/maya/[id]/thread-view';
import { VaultSettingsView } from '@/app/vault/settings/settings-view';
import type { VaultConnectionSummary } from '@/lib/vault/notes/load';
import type { WeekConnection } from '@/lib/vault/notes/connections-load';
import type { ThemeListRow, ThemeMap } from '@/lib/vault/map/read';
import type { MergeLogPage } from '@/lib/vault/map/merge-log';
import type { SweepView } from '@/lib/vault/map/sweep-read';
import type { MayaThreadDetail, MayaThreadNote, MayaThreadRow } from '@/lib/vault/maya/store';
import { syncProgress, type SyncRunSummary } from '@/lib/vault/sync/progress';
import { noteHref } from '@/lib/vault/paths';

/**
 * The Vault pages that had no picture (plan #1605), each drawn by the view
 * its page hands its reads to, from fixtures shaped like the live rows.
 */

const connection: VaultConnectionSummary = {
  id: 'c1',
  repoOwner: 'sam-okafor',
  repoName: 'obsidian-vault',
  branch: 'main',
  subpath: '',
  status: 'active',
  lastSyncedAt: '2026-10-07T05:10:00Z',
  lastError: null,
  backfillCompletedAt: '2026-08-14T09:40:00Z',
  syncCursor: 'a41c9e2',
};

function note(path: string, excerpt: string) {
  const slash = path.lastIndexOf('/');
  return {
    id: path,
    path,
    title: path.slice(slash + 1).replace(/\.md$/, ''),
    folder: slash < 0 ? '' : path.slice(0, slash),
    gitUpdatedAt: null,
    excerpt,
  };
}

// ---- Notes -----------------------------------------------------------------

const noteGroups: NoteFolderGroup[] = [
  {
    folder: '',
    notes: [
      note('Inbox.md', 'Things to file: the article on four-day weeks, the lift-share idea, a book Priya mentioned.'),
    ],
  },
  {
    folder: 'Housing',
    notes: [
      note('Housing/Rent control in my city.md', 'The cap went in two years ago. What I expected to happen, and what the listings say did happen instead.'),
      note('Housing/Why I stopped wanting to buy.md', 'For ten years the plan was a flat by forty. Somewhere in the last two it stopped being the plan, and I want to know why.'),
    ],
  },
  {
    folder: 'Reading/Books',
    notes: [
      note('Reading/Books/The Death and Life of Great American Cities.md', 'Jacobs on sidewalks, mixed uses and the eyes on the street. Notes chapter by chapter, with where I disagree.'),
      note('Reading/Books/Seeing Like a State.md', 'Legibility: the state simplifies what it wants to manage, and then the simplification becomes the thing.'),
      note('Reading/Books/Thinking in Systems.md', 'Stocks, flows and the delays between them. Most of what I called bad decisions at work were delays.'),
    ],
  },
  {
    folder: 'Work',
    notes: [
      note('Work/Failover drills we never ran.md', 'We wrote the runbook in March and never once rehearsed it. The outage in June was the rehearsal.'),
      note('Work/Nightly close.md', 'What the nightly close actually does, step by step, and the two places it can silently skip a day.'),
      note('Work/On-call handover template.md', ''),
    ],
  },
];

const weekConnections: WeekConnection[] = [
  {
    id: 'w1',
    sentence: 'Both come back to the cost of a plan nobody rehearses: the runbook in June, and the flat-by-forty plan.',
    older: {
      noteId: 'n-flat',
      title: 'Why I stopped wanting to buy',
      href: noteHref('Housing/Why I stopped wanting to buy.md'),
    },
    recent: [
      {
        noteId: 'n-failover',
        title: 'Failover drills we never ran',
        href: noteHref('Work/Failover drills we never ran.md'),
      },
    ],
  },
];

export function VaultHomeSurface() {
  return <VaultHomeView connection={connection} search="" groups={noteGroups} connections={weekConnections} />;
}

// ---- Map: the themes -------------------------------------------------------

const themes: ThemeListRow[] = [
  {
    id: 't1',
    name: 'Housing and who it is for',
    about: 'Rent, ownership and what a city owes the people who keep it running, from the rent cap to the flat I stopped wanting.',
    notes: 14,
    positions: 6,
  },
  {
    id: 't2',
    name: 'Rehearsal over planning',
    about: 'Why a plan nobody has practised is a wish, at work and outside it.',
    notes: 9,
    positions: 4,
  },
  {
    id: 't3',
    name: 'Legibility',
    about: 'What gets simplified so it can be managed, and what the simplification costs.',
    notes: 6,
    positions: 3,
  },
  { id: 't4', name: 'Delays in systems', about: 'Stocks, flows and the lag between them.', notes: 4, positions: 2 },
  { id: 't5', name: 'Walking', about: 'Cities on foot.', notes: 1, positions: 1 },
];

const sweep: SweepView = {
  id: 's1',
  status: 'done',
  notesTotal: 412,
  startedAt: '2026-10-02T21:00:00Z',
  finishedAt: '2026-10-03T03:25:00Z',
  lastError: null,
  outcomes: { read: 138, nothing: 61, record: 22, unchanged: 140, journal: 31, too_short: 18, failed: 2 },
  reached: 412,
  cutShort: 3,
  sectionsFailed: 1,
  positions: 41,
  newPositions: 9,
  failures: [
    { title: 'Reading/Books/Seeing Like a State', detail: 'The model’s answer did not parse.' },
    { title: 'Work/Nightly close', detail: 'Timed out after 60 seconds.' },
  ],
};

const mergeLog: MergeLogPage = {
  rows: [
    {
      id: 'm1',
      kind: 'theme',
      mergedAt: '2026-10-03T03:20:00Z',
      undoneAt: null,
      survivorId: 't1',
      absorbed: {
        name: 'Renting in the city',
        items: [{ title: 'Rent control in my city', path: 'Housing/Rent control in my city.md', quote: null }],
        count: 1,
      },
      survivor: {
        name: 'Housing',
        items: [
          { title: 'Why I stopped wanting to buy', path: 'Housing/Why I stopped wanting to buy.md', quote: null },
          {
            title: 'The Death and Life of Great American Cities',
            path: 'Reading/Books/The Death and Life of Great American Cities.md',
            quote: null,
          },
        ],
        count: 13,
      },
      survivorNameNow: 'Housing and who it is for',
      reason: 'Both are about who a city’s housing serves; the rent cap note is one case of it.',
    },
    {
      id: 'm2',
      kind: 'position',
      mergedAt: '2026-09-28T19:02:00Z',
      undoneAt: '2026-09-29T08:15:00Z',
      survivorId: 'p2',
      absorbed: {
        name: 'Runbooks rot',
        items: [{ title: 'Failover drills we never ran', path: 'Work/Failover drills we never ran.md', quote: 'A runbook nobody has run is a story about the system, not the system.' }],
        count: 1,
      },
      survivor: {
        name: 'Practice is the plan',
        items: [{ title: 'Nightly close', path: 'Work/Nightly close.md', quote: 'The only version of the close I trust is the one we ran last night.' }],
        count: 2,
      },
      survivorNameNow: 'Practice is the plan',
      reason: null,
    },
  ],
  counts: { theme: 1, position: 1, undone: 1 },
  page: 1,
  pages: 1,
};

export function VaultMapSurface() {
  return <VaultMapView themes={themes} capped={false} sweep={sweep} mergeLog={mergeLog} />;
}

// ---- Map: one theme --------------------------------------------------------

const themeMap: ThemeMap = {
  theme: {
    id: 't1',
    name: 'Housing and who it is for',
    about: 'Rent, ownership and what a city owes the people who keep it running, from the rent cap to the flat I stopped wanting.',
    firstSeen: '2024-03-02T00:00:00Z',
    lastSeen: '2026-09-30T00:00:00Z',
  },
  positions: [
    {
      id: 'p1',
      name: 'Caps protect the people already housed',
      statement: 'A rent cap protects the tenants it covers and does little for anyone still looking, because landlords stop listing.',
      basis: 'Argued in two notes, from the listings data and from Jacobs.',
      kind: 'claim',
      stance: 'held',
      ungrounded: false,
      sources: [
        {
          quote: 'The cap did exactly what it promised for the people in the flats, and nothing at all for the people outside them.',
          note: { path: 'Housing/Rent control in my city.md', title: 'Rent control in my city' },
        },
        {
          quote: 'Listings in the capped postcodes fell by a third in eighteen months.',
          note: { path: 'Housing/Rent control in my city.md', title: 'Rent control in my city' },
        },
      ],
    },
    {
      id: 'p2',
      name: 'Owning is a bet on staying',
      statement: 'Buying a flat is mostly a bet that you will want to live in one place for a decade, and that bet got worse.',
      basis: 'Your own reasoning in one note.',
      kind: 'position',
      stance: 'held',
      ungrounded: false,
      sources: [
        {
          quote: 'What I wanted was not the flat, it was to stop moving, and I can have that without a mortgage.',
          note: { path: 'Housing/Why I stopped wanting to buy.md', title: 'Why I stopped wanting to buy' },
        },
      ],
    },
    {
      id: 'p3',
      name: 'Mixed uses keep a street safe',
      statement: 'A street stays safe when it has reasons for people to be on it at every hour.',
      basis: 'From your reading notes on Jacobs.',
      kind: 'claim',
      stance: 'encountered',
      ungrounded: true,
      sources: [],
    },
  ],
  notes: [
    { path: 'Housing/Rent control in my city.md', title: 'Rent control in my city', basis: 'Argues two positions here.' },
    { path: 'Housing/Why I stopped wanting to buy.md', title: 'Why I stopped wanting to buy', basis: 'Argues one position here.' },
    {
      path: 'Reading/Books/The Death and Life of Great American Cities.md',
      title: 'The Death and Life of Great American Cities',
      basis: 'About the subject without arguing a position.',
    },
  ],
};

export function VaultThemeSurface() {
  return <ThemeView map={themeMap} />;
}

// ---- Maya: the threads -----------------------------------------------------

const mayaNotes: Record<string, MayaThreadNote> = {
  flat: { id: 'n-flat', path: 'Housing/Why I stopped wanting to buy.md', title: 'Why I stopped wanting to buy' },
  rent: { id: 'n-rent', path: 'Housing/Rent control in my city.md', title: 'Rent control in my city' },
  failover: { id: 'n-failover', path: 'Work/Failover drills we never ran.md', title: 'Failover drills we never ran' },
  systems: { id: 'n-systems', path: 'Reading/Books/Thinking in Systems.md', title: 'Thinking in Systems' },
};

const threads: MayaThreadRow[] = [
  {
    id: 'th1',
    question: 'Did I stop wanting to buy, or did I stop believing I could?',
    summary: 'You think it is the first; the money note from 2023 suggests the second came first.',
    origin: 'asked',
    createdAt: '2026-10-05T20:12:00Z',
    updatedAt: '2026-10-06T21:40:00Z',
    note: mayaNotes.flat,
  },
  {
    id: 'th2',
    question: 'Is a rent cap a housing policy or a tenant-protection policy, and does the difference matter for who gets housed next?',
    summary: null,
    origin: 'automatic',
    createdAt: '2026-10-03T06:00:00Z',
    updatedAt: '2026-10-03T06:00:00Z',
    note: mayaNotes.rent,
  },
  {
    id: 'th3',
    question: 'Why do we write runbooks we never rehearse?',
    summary: 'Agreed it is about who gets credit; still open on whether drills can be made cheap enough.',
    origin: 'asked',
    createdAt: '2026-09-21T13:30:00Z',
    updatedAt: '2026-09-24T08:05:00Z',
    note: mayaNotes.failover,
  },
  {
    id: 'th4',
    question: 'What did I mean by “delays are decisions”?',
    summary: null,
    origin: 'asked',
    createdAt: '2026-08-30T10:00:00Z',
    updatedAt: '2026-08-30T10:00:00Z',
    note: null,
  },
];

export function VaultMayaSurface() {
  return <MayaListView threads={threads} limit={200} />;
}

// ---- Maya: one thread ------------------------------------------------------

const thread: MayaThreadDetail = {
  ...threads[0],
  noteId: 'n-flat',
  summaryAt: '2026-10-06T21:40:00Z',
  messages: [
    {
      id: 'mm1',
      role: 'maya',
      kind: 'thought',
      body: '',
      createdAt: '2026-10-05T20:12:00Z',
      thought: {
        points: [
          {
            kind: 'point',
            rank: 1,
            claim: 'Your money note from 2023 already reads like someone talking themselves out of it.',
            argument:
              'This note dates the change to the last two years. But two years before it you were writing that the deposit “keeps moving away faster than I save”. That reads less like a change of mind and more like a goal you could no longer reach, renamed.',
            notes: [
              {
                noteId: 'n-money',
                title: 'Money in 2023',
                quote: 'The deposit keeps moving away faster than I save, and I am tired of chasing it.',
                point: 'Written two years earlier, about the same flat.',
              },
            ],
            sources: [
              {
                author: 'Jon Elster',
                work: 'Sour Grapes',
                gist: 'People often stop wanting what they have come to believe they cannot have, and then experience it as a free change of taste.',
                exactText: null,
              },
            ],
          },
          {
            kind: 'point',
            rank: 2,
            claim: 'What you say you wanted, not moving, is a different thing from owning.',
            argument:
              'Your own line is that you wanted to stop moving. A long tenancy under the rent cap you wrote about gives you that, so the note may be right on its own terms.',
            notes: [
              {
                noteId: 'n-rent',
                title: 'Rent control in my city',
                quote: 'The cap did exactly what it promised for the people in the flats.',
                point: 'You are one of the people in the flats.',
              },
            ],
            sources: [],
          },
        ],
        synthesis: {
          kind: 'synthesis',
          positionIds: ['p1', 'p2'],
          positionNames: ['Caps protect the people already housed', 'Owning is a bet on staying'],
          resolution:
            'Both can hold: the cap makes staying cheap for you, which is what makes the bet on owning worse. They conflict only if you count yourself among the people still looking.',
        },
      },
    },
    {
      id: 'mm2',
      role: 'person',
      kind: 'reply',
      body: 'Fair on the 2023 note. But I think both happened, and the second one is the one I would still choose today.',
      createdAt: '2026-10-06T21:30:00Z',
      thought: null,
    },
    {
      id: 'mm3',
      role: 'maya',
      kind: 'reply',
      body: 'Then the test is whether you would buy if the deposit appeared tomorrow. Your note says no, and nothing else in the vault argues otherwise.',
      createdAt: '2026-10-06T21:40:00Z',
      thought: null,
    },
  ],
};

const cited = new Map<string, MayaThreadNote>([
  ['n-money', { id: 'n-money', path: 'Money/Money in 2023.md', title: 'Money in 2023' }],
  ['n-rent', mayaNotes.rent],
]);

/* The vault layout hands every paid press its estimate; the gallery has no
 * layout, so a reply to Maya gets a typical figure here and its hint draws. */
export function VaultMayaThreadSurface() {
  return (
    <PaidCostsProvider
      costs={{
        'app/vault/maya/actions.ts#replyToMaya': {
          lowMicros: 8_000,
          medianMicros: 14_000,
          highMicros: 31_000,
          runs: 12,
          basis: 'measured',
          per: 'run',
        },
      }}
    >
      <MayaThreadView thread={thread} cited={cited} />
    </PaidCostsProvider>
  );
}

// ---- Settings --------------------------------------------------------------

const runs: SyncRunSummary[] = [
  {
    id: 'r1',
    type: 'incremental',
    status: 'completed',
    notesSeen: 6,
    notesWritten: 4,
    notesDeleted: 1,
    notesSkipped: 1,
    startedAt: '2026-10-07T05:09:00Z',
    finishedAt: '2026-10-07T05:10:00Z',
    error: null,
  },
  {
    id: 'r2',
    type: 'incremental',
    status: 'failed',
    notesSeen: 0,
    notesWritten: 0,
    notesDeleted: 0,
    notesSkipped: 0,
    startedAt: '2026-10-06T05:09:00Z',
    finishedAt: '2026-10-06T05:09:00Z',
    error: 'GitHub answered 502 Bad Gateway.',
  },
  {
    id: 'r3',
    type: 'backfill',
    status: 'completed',
    notesSeen: 412,
    notesWritten: 412,
    notesDeleted: 0,
    notesSkipped: 0,
    startedAt: '2026-08-14T09:02:00Z',
    finishedAt: '2026-08-14T09:40:00Z',
    error: null,
  },
];

export function VaultSettingsSurface() {
  return (
    <VaultSettingsView
      connection={connection}
      count={412}
      runs={runs}
      writeAccess="yes"
      progress={syncProgress({ mirrored: 412, backfillCompletedAt: connection.backfillCompletedAt, runs })}
    />
  );
}
