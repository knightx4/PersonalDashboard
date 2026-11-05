import { SessionThreadView, type PendingSend } from '@/app/chat/dash/session-view';
import type { SessionMessage, SessionThread } from '@/lib/core/session-threads-model';
import { DashPageSurface } from './ask-surfaces';

/**
 * A conversation with a Claude Code session on Chat's Dash tab (plan
 * #2789.7), in the gallery: the thread open beside the list, which shows
 * session threads above the chats with Dash, and each of the thread's hidden
 * parts: the working line, a question's buttons, the attach sheet, a new
 * thread's empty state and a send that failed.
 */

const NOW = Date.parse('2026-10-14T11:00:00Z');
const at = (h: number, m = 0) => `2026-10-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

const THREAD_ID = '00000000-0000-4000-8000-0000000000b1';

export const SESSION_THREADS: SessionThread[] = [
  {
    id: THREAD_ID,
    title: 'Let the jam tracker export a season as CSV',
    projectId: 'jam-tracker',
    projectLabel: 'Jam tracker',
    sessionId: 'cse_01JAMEXPORTPREVIEW',
    state: 'idle',
    lastAt: at(10, 42),
  },
  {
    id: '00000000-0000-4000-8000-0000000000b2',
    title: 'Why does the Money page take four seconds to open on a phone with a long transaction list?',
    projectId: null,
    projectLabel: 'This app',
    sessionId: 'cse_01MONEYSLOW',
    state: 'waiting',
    lastAt: at(9, 15),
  },
  {
    id: '00000000-0000-4000-8000-0000000000b3',
    title: 'Tidy the recipe cards',
    projectId: 'recipes',
    projectLabel: 'Recipes',
    sessionId: null,
    state: 'queued',
    lastAt: '2026-10-12T16:00:00Z',
  },
];

function message(fields: Partial<SessionMessage> & Pick<SessionMessage, 'id' | 'author' | 'createdAt'>): SessionMessage {
  return {
    kind: 'text',
    body: '',
    options: null,
    artifactUrl: null,
    attachment: null,
    answer: null,
    answeredAt: null,
    ...fields,
  };
}

const OPENING: SessionMessage[] = [
  message({
    id: 'm1',
    author: 'person',
    createdAt: at(10, 2),
    body: 'Add an export to the season page: one CSV with every jam, the date it was made, the fruit and how many jars. The sheet I keep now is attached.',
    attachment: { name: 'jams-2026-season.csv', href: '#' },
  }),
  message({
    id: 'm2',
    author: 'session',
    createdAt: at(10, 9),
    body: 'I read the season page and your sheet. The jars column in your sheet counts half jars, so I will keep the count as a decimal. Here is the button where I would put it:',
  }),
  message({
    id: 'm3',
    author: 'session',
    kind: 'mockup',
    createdAt: at(10, 9),
    body: 'Season page with Export CSV beside the season name',
    artifactUrl: 'https://claude.ai/artifact/preview-jam-export',
  }),
];

const QUESTION = message({
  id: 'm4',
  author: 'session',
  kind: 'question',
  createdAt: at(10, 12),
  body: 'Should the export include jams you marked as gifts?',
  options: ['Include them, marked as gifts', 'Leave them out', 'Ask me each time'],
});

const ANSWERED: SessionMessage[] = [
  ...OPENING,
  { ...QUESTION, answer: 'Include them, marked as gifts', answeredAt: at(10, 20) },
  message({
    id: 'm5',
    author: 'session',
    createdAt: at(10, 42),
    body: 'Done. **Export CSV** is on the season page and the file has a `gift` column. The tests pass and the change is on main.',
  }),
];

const NEW_PROJECTS = [
  { id: 'jam-tracker', label: 'Jam tracker' },
  { id: 'recipes', label: 'Recipes' },
];

export type SessionSurfacePart = 'open' | 'working' | 'question' | 'attach' | 'empty' | 'failed' | 'comment' | 'picked';

export function SessionThreadSurface({ part = 'open' }: { part?: SessionSurfacePart }) {
  const thread = SESSION_THREADS[0];
  let view: React.ReactNode;
  if (part === 'empty') {
    view = (
      <SessionThreadView
        thread={null}
        messages={[]}
        projects={NEW_PROJECTS}
        projectId="jam-tracker"
        live={false}
        now={NOW}
      />
    );
  } else if (part === 'working') {
    view = (
      <SessionThreadView
        thread={{ ...thread, state: 'working' }}
        messages={[
          ...OPENING,
          message({ id: 'm6', author: 'person', createdAt: at(10, 50), body: 'Put the button under the season name instead.' }),
          message({
            id: 'm7',
            author: 'session',
            kind: 'status',
            createdAt: at(10, 51),
            body: 'Moving the button and photographing the season page at phone width',
          }),
        ]}
        live={false}
        now={NOW}
      />
    );
  } else if (part === 'question') {
    view = (
      <SessionThreadView
        thread={{ ...thread, state: 'waiting' }}
        messages={[...OPENING, QUESTION]}
        live={false}
        now={NOW}
      />
    );
  } else if (part === 'comment') {
    // The mockup's Comment pressed, before anything is typed.
    view = (
      <SessionThreadView
        thread={{ ...thread, state: 'waiting' }}
        messages={[...OPENING, QUESTION]}
        initialCommentOn="m3"
        live={false}
        now={NOW}
      />
    );
  } else if (part === 'picked') {
    // Pick pressed: the card carries the mark and your pick follows it as a turn.
    view = (
      <SessionThreadView
        thread={{ ...thread, state: 'working' }}
        messages={[
          ...OPENING,
          message({
            id: 'm6',
            author: 'person',
            createdAt: at(10, 14),
            body: 'Picked the mockup \u201cSeason page with Export CSV beside the season name\u201d',
            artifactUrl: 'https://claude.ai/artifact/preview-jam-export',
          }),
          message({
            id: 'm7',
            author: 'person',
            createdAt: at(10, 15),
            body: 'About the mockup \u201cSeason page with Export CSV beside the season name\u201d: Make the button the accent colour, it is the main thing on that page.',
            artifactUrl: 'https://claude.ai/artifact/preview-jam-export',
          }),
        ]}
        live={false}
        now={NOW}
      />
    );
  } else if (part === 'failed') {
    const failed: PendingSend = {
      id: 'pending-1',
      text: 'One more thing: name the file after the season, like jams-2026.csv.',
      file: null,
      failed: 'Not sent. Check your connection.',
    };
    view = (
      <SessionThreadView thread={thread} messages={ANSWERED} initialPending={[failed]} live={false} now={NOW} />
    );
  } else {
    view = (
      <SessionThreadView
        thread={thread}
        messages={ANSWERED}
        initialAttachOpen={part === 'attach'}
        initialFile={
          part === 'attach'
            ? { path: 'preview/season-labels.pdf', name: 'season-labels.pdf', contentType: 'application/pdf', size: 182_000 }
            : null
        }
        live={false}
        now={NOW}
      />
    );
  }
  return (
    <DashPageSurface
      sessions={SESSION_THREADS}
      session={{ id: part === 'empty' ? 'new' : thread.id, view }}
      usedOpen={false}
    />
  );
}
