'use client';

import { useEffect } from 'react';
import type { AskRows } from '@/lib/ask/list-filter';
import { AskDashProvider, AskThread, useAskDash, type AskSource } from '@/components/shell/ask-dash';
import type { ChangeOutcome } from '@/lib/ask/changes';
import { PageHeader } from '@/components/shell/page-header';
import { MadeChanges } from '@/components/talk/made-changes';
import { SectionFold } from '@/components/ui/disclosure';
import type { DashChange, MadeChange } from '@/lib/talk/changes';
import type { ConversationSummary } from '@/lib/talk/store';
import type { TalkTurn } from '@/lib/talk/talk';
import { DashCredit } from '@/components/ui/dash-mark';
import { SONNET } from '@/lib/core/models';
import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { AppShell } from '@/components/shell/app-shell';
import { Conversation, ConversationChat } from '@/components/patterns/conversation';
import { AskChats } from '@/app/ask/chats';
import { CHATS_BACK, NewDashChat, USED_LABEL, USED_SHORT } from '@/app/ask/view';
import { ChatUsed } from '@/app/ask/used';
import { chatFiles, chatLookups, chatReadRows } from '@/lib/talk/chat-trail';
import type { AskChat } from '@/lib/talk/ask-chats';
import type { SearchHit } from '@/lib/search/sources';
import type { ModuleId } from '@/lib/modules';
import type { AskBoxStart } from '@/components/talk/ask-box';
import { stoppedBody } from '@/lib/talk/talk';

/**
 * The Ask Dash sheet in the surface gallery (plan #1090), fed with typed
 * fixtures in place of the server actions, since the gallery cannot sign in.
 * Wraps the whole shell, whose own provider then stands down in favour of
 * this one.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const RECENT: ConversationSummary[] = [
  {
    id: 'c1',
    kind: 'ask',
    ref: '00000000-0000-4000-8000-000000000001',
    title: 'Which companies have I heard nothing from in a month?',
    createdAt: ago(2 * DAY),
    lastAt: ago(2 * DAY),
    turnCount: 2,
  },
  {
    id: 'c2',
    kind: 'ask',
    ref: '00000000-0000-4000-8000-000000000002',
    title: 'What have I written about leaving my job?',
    createdAt: ago(5 * DAY),
    lastAt: ago(4 * DAY),
    turnCount: 4,
  },
  {
    id: 'c3',
    kind: 'ask',
    ref: '00000000-0000-4000-8000-000000000003',
    title: 'How many todos did I finish last week?',
    createdAt: ago(9 * DAY),
    lastAt: ago(9 * DAY),
    turnCount: 2,
  },
];

/** The coming Friday, as the todo's own YYYY-MM-DD, so the card agrees with the answer. */
function nextFriday(): string {
  const now = new Date();
  const at = new Date(Date.now() + (((5 - now.getDay() + 7) % 7) || 7) * DAY);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

const CHANGE_BASE = {
  conversationId: '00000000-0000-4000-8000-000000000009',
  subjectRef: null,
  writtenTable: null,
  writtenRef: null,
  undo: null,
  createdAt: ago(0),
  doneAt: null,
  declinedAt: null,
  undoneAt: null,
} as const;

/** The two changes an "add these" question proposes: a todo and a goal step. */
function proposals(turnId: string): DashChange[] {
  return [
    {
      ...CHANGE_BASE,
      id: `${turnId}-todo`,
      turnId,
      status: 'proposed',
      kind: 'add_todo',
      input: { title: 'Call the dentist', body: null, dueOn: nextFriday(), dueTime: null, pinned: false },
    },
    {
      ...CHANGE_BASE,
      id: `${turnId}-step`,
      turnId,
      status: 'proposed',
      kind: 'add_goal_step',
      input: {
        parentId: 'g1',
        goalTitle: 'Get my teeth sorted before the new job',
        title: 'Book the hygienist',
        kind: 'mine',
      },
    },
  ];
}

/** The gallery's answer to asking for a change: said in words, with its cards. */
function proposalTo(question: string): { turns: TalkTurn[]; changes: DashChange[] } {
  return {
    turns: [
      { id: 'pq', role: 'user', body: question, createdAt: new Date().toISOString() },
      {
        id: 'pa',
        role: 'assistant',
        body:
          'I can add the todo "Call the dentist" due on Friday, and a step "Book the hygienist" under your goal to get your teeth sorted. Confirm each one below and I will write it.',
        createdAt: new Date().toISOString(),
      },
    ],
    changes: proposals('pa'),
  };
}

/** A todo or a note made from an answer with the presses under it (plan #1899.7), as the server keeps it. */
function savedChange(turnId: string, to: 'todo' | 'vault', at: string): DashChange {
  const base = { ...CHANGE_BASE, turnId, status: 'done' as const, createdAt: at, doneAt: at };
  return to === 'todo'
    ? {
        ...base,
        id: `${turnId}-saved-todo`,
        kind: 'add_todo',
        input: { title: 'You spent $412.60 on eBay flips this quarter across three orders.', body: null, dueOn: null, dueTime: null, pinned: false },
        subjectRef: 'todo.tasks:saved-todo',
        writtenTable: 'todo.tasks',
        writtenRef: 'saved-todo',
      }
    : {
        ...base,
        id: `${turnId}-saved-note`,
        kind: 'add_quick_note',
        input: {
          noteId: 'saved-note',
          title: 'What did I spend on eBay flips this quarter',
          path: 'Inbox/What did I spend on eBay flips this quarter.md',
          body: 'You spent $412.60 on eBay flips this quarter across three orders.',
        },
        subjectRef: 'obsidian.notes:saved-note',
        writtenTable: 'obsidian.notes',
        writtenRef: 'saved-note',
      };
}

/** What a press does in the gallery: the change moved on, as the server would move it. */
function pressed(status: DashChange['status']) {
  return async (id: string): Promise<ChangeOutcome> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const kind = id.endsWith('-step') ? 'step' : 'todo';
    const base = proposals(id.replace(/-(todo|step)$/, ''))[kind === 'step' ? 1 : 0];
    const at = new Date().toISOString();
    return {
      ok: true,
      change: {
        ...base,
        status,
        subjectRef: status === 'declined' ? null : `${kind === 'step' ? 'goals.items' : 'todo.tasks'}:${kind}-written`,
        writtenTable: status === 'declined' ? null : kind === 'step' ? 'goals.items' : 'todo.tasks',
        writtenRef: status === 'declined' ? null : `${kind}-written`,
        doneAt: status === 'declined' ? null : at,
        declinedAt: status === 'declined' ? at : null,
        undoneAt: status === 'undone' ? at : null,
      },
    };
  };
}

function answerTo(question: string): TalkTurn[] {
  return [
    { id: 'q', role: 'user', body: question, createdAt: new Date().toISOString() },
    {
      id: 'a',
      role: 'assistant',
      body:
        'You spent $412.60 on eBay flips this quarter across three orders: the Catan lot ($186.00), the Penguin Classics bundle ($142.60) and the Ticket to Ride Europe ($84.00). Two of them are still unsold in your inventory, and your todo to list the Catan lot is five days overdue.',
      createdAt: new Date().toISOString(),
      citations: [
        { table: 'shopping.orders', ref: 'o1', title: 'Catan lot, eBay', href: '/shopping/orders/o1' },
        { table: 'shopping.orders', ref: 'o2', title: 'Penguin Classics bundle, eBay', href: '/shopping/orders/o2' },
        { table: 'shopping.orders', ref: 'o3', title: 'Ticket to Ride Europe, eBay', href: '/shopping/orders/o3' },
        { table: 'todo.tasks', ref: 't1', title: 'List the Catan lot', href: '/todo/t/t1' },
      ],
    },
  ];
}

/** A goal's page, which the sheet names by the goal's title (plan #1272). */
export const TRIP_GOAL = '/goals/00000000-0000-4000-8000-0000000000a1';

/**
 * The question the gallery's fixture fails to answer (plan #1337): the
 * question is kept and the answer is not, as when the deployment has no key,
 * so the sheet shows the failed mark with the error beside it.
 */
export const FAILING_QUESTION = 'How much did I spend on flights this year?';

/**
 * The question the gallery's fixture is caught answering (plan #1902): its
 * lookups are done and the answer has got a few words into its second
 * sentence, where it stays, so the sheet shows an answer being written.
 */
export const WRITING_QUESTION = 'What did I spend on eBay flips this quarter, and what is still unsold?';

/** Hands `body` to `onText` a few words at a time, as the route's text lines arrive. */
async function writeOut(body: string, onText: ((piece: string) => void) | undefined, wait: (ms: number) => Promise<unknown>) {
  if (!onText) return;
  const pieces = body.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < pieces.length; i += 3) {
    onText(pieces.slice(i, i + 3).join(''));
    await wait(40);
  }
}

/** The workspaces the box's chip offers in the gallery (plan #1899.5). */
const BOX_WORKSPACES: readonly ModuleId[] = ['shopping', 'jobs', 'todo', 'vault', 'learn', 'news', 'goals'];

/** The rows @ finds in the gallery, as the top bar's search would list them. */
const BOX_HITS: readonly SearchHit[] = [
  { module: 'shopping', kind: 'order', id: 'o1', ref: 'public.orders:o1', title: 'Catan lot, eBay', subtitle: 'Order · Shopping', href: '/shopping/orders/o1' },
  { module: 'shopping', kind: 'inventory', id: 'i1', ref: 'public.inventory_items:i1', title: 'Catan: Seafarers expansion', subtitle: 'Inventory · Shopping', href: '/shopping/inventory/i1' },
  { module: 'shopping', kind: 'saved', id: 's1', ref: 'public.saved_items:s1', title: 'Catan 3D edition', subtitle: 'Saved · Shopping', href: '/shopping/saved' },
  { module: 'todo', kind: 'task', id: 't1', ref: 'todo.tasks:t1', title: 'List the Catan lot', subtitle: 'Todo', href: '/todo/t/t1' },
  { module: 'jobs', kind: 'company', id: 'c1', ref: 'job_search.companies:c1', title: 'Catalyst Health', subtitle: 'Company · Job search', href: '/jobs/companies/c1' },
  { module: 'learn', kind: 'reading', id: 'r1', ref: 'learn.readings:r1', title: 'The Settlers of Catan and the economics of trade', subtitle: 'Reading · Learn', href: '/learn/readings/r1' },
];

/** What the gallery's question carried with @. */
const BOX_ROWS = [
  { kind: 'order' as const, id: 'o1', title: 'Catan lot, eBay', href: '/shopping/orders/o1' },
  { kind: 'task' as const, id: 't1', title: 'List the Catan lot', href: '/todo/t/t1' },
];

const FIXTURES: AskSource = {
  ask: async (question, _ref, _page, onLookup, _files, _list, onText, more) => {
    // The lookups appear one by one, then the answer as it is written (plans #1438, #1902).
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const search = { id: 'l1', index: 0, name: 'search', input: { query: question.slice(0, 40) } };
    onLookup?.({ phase: 'started', ...search });
    await wait(300);
    onLookup?.({ phase: 'finished', ...search, ok: true, found: 2 });
    await wait(300);
    const conversation = { ref: '00000000-0000-4000-8000-000000000009', title: question };
    if (question === FAILING_QUESTION) {
      return {
        conversation,
        turns: [{ id: 'fq', role: 'user', body: question, createdAt: new Date().toISOString() }],
        error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot answer.',
      };
    }
    if (question === WRITING_QUESTION) {
      const body = answerTo(question)[1].body;
      const written = `${body.split('. ')[0]}. Two of them are still`;
      await writeOut(written, onText, wait);
      // Held here, mid-answer, for the gallery's photograph, until Stop is
      // pressed: then kept as far as it got (plan #1899.5).
      return new Promise((resolve) => {
        more?.signal?.addEventListener('abort', () =>
          resolve({
            conversation,
            stop: 'stopped',
            turns: [
              { id: 'wq', role: 'user', body: question, createdAt: new Date().toISOString() },
              { id: 'wa', role: 'assistant', body: stoppedBody(written), createdAt: new Date().toISOString() },
            ],
          }),
        );
      });
    }
    if (/^(add|remind)/i.test(question)) {
      const proposal = proposalTo(question);
      await writeOut(proposal.turns[1].body, onText, wait);
      return { conversation, ...proposal, stop: 'answered' };
    }
    const turns = answerTo(question);
    await writeOut(turns[1].body, onText, wait);
    return { conversation, turns, stop: 'answered' };
  },
  recent: async () => ({ conversations: RECENT }),
  // A goal's page names the goal; every other page keeps the sheet's own
  // name for it, the workspace.
  label: async (page) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return page === TRIP_GOAL ? 'Trip ideas' : null;
  },
  open: async () => ({ turns: answerTo(RECENT[0].title ?? ''), changes: [] }),
  poll: async () => ({ turns: [], open: 0 }),
  save: async (_ref, turnId, to) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { ok: true, change: savedChange(turnId, to, new Date().toISOString()) };
  },
  confirm: pressed('done'),
  decline: pressed('declined'),
  undo: pressed('undone'),
  costs: async () => ({
    'app/api/ask/route.ts#POST': {
      lowMicros: 20_000,
      medianMicros: 45_000,
      highMicros: 110_000,
      runs: 0,
      basis: 'guess',
      per: 'run',
      models: [SONNET],
    },
  }),
};

/** Opens the sheet as the page arrives, sending `question` when given. */
function OpenOnArrival({ question, rows }: { question?: string; rows?: AskRows }) {
  const handle = useAskDash();
  useEffect(() => {
    // A tick after hydration, as a press would: a question sent from inside
    // the hydrating render showed nothing until its answer landed, so the
    // lookups and the answer being written never drew (plan #1902).
    const timer = setTimeout(() => handle?.open(question, rows), 0);
    return () => clearTimeout(timer);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function AskDashSurface({
  open = false,
  question,
  rows,
  page = '/jobs',
  children,
}: {
  open?: boolean;
  question?: string;
  /** A filtered list sent with the question (plan #1658). */
  rows?: AskRows;
  /** The page the sheet opens over; the gallery's own address says nothing. */
  page?: string;
  children: React.ReactNode;
}) {
  return (
    <AskDashProvider source={FIXTURES} page={page} account="preview" workspaces={BOX_WORKSPACES} searchHits={BOX_HITS}>
      {children}
      {open && <OpenOnArrival question={question} rows={rows} />}
    </AskDashProvider>
  );
}

/**
 * Dash's box with what plan #1899.5 adds, on the chat's card at reading
 * width: a question that carried two rows added with @, an answer stopped
 * part way and kept as far as it got, and the box open on `draft` with the
 * menu its @ or / opens, or the scope chip's menu open.
 */
export function AskBoxSurface({ open }: { open: 'rows' | 'commands' | 'scope' }) {
  const draft = open === 'rows' ? 'How much did the @Cat' : open === 'commands' ? '/' : '';
  const start: AskBoxStart | undefined =
    open === 'rows'
      ? { rows: [BOX_ROWS[0]], scope: 'shopping' }
      : open === 'scope'
        ? { scope: 'learn', scopeOpen: true }
        : undefined;
  const at = '2026-10-14T09:00:00Z';
  const turns: TalkTurn[] = [
    {
      id: 'b-q',
      role: 'user',
      body: 'What did I pay for these, and is the todo still open?',
      createdAt: at,
      citations: [
        { table: 'public.orders', ref: 'o1', title: 'Catan lot, eBay', href: '/shopping/orders/o1' },
        { table: 'todo.tasks', ref: 't1', title: 'List the Catan lot', href: '/todo/t/t1' },
      ],
    },
    {
      id: 'b-a',
      role: 'assistant',
      body: stoppedBody('You paid $186.00 for the Catan lot on 2 August, postage included. The todo to list it is'),
      createdAt: at,
    },
  ];
  return (
    <AskDashProvider source={FIXTURES} account="preview" workspaces={BOX_WORKSPACES} searchHits={BOX_HITS}>
      <PageColumn className="py-4">
        <Card padding="standard" className="mx-auto w-full max-w-prose pt-72">
          <AskThread
            id="ask-box-preview"
            conversationRef="00000000-0000-4000-8000-000000000031"
            turns={turns}
            label="Ask a follow-up"
            placeholder="Ask Dash. @ adds a row, / a command"
            startWriting
            initialDraft={draft}
            boxStart={start}
          />
        </Card>
      </PageColumn>
    </AskDashProvider>
  );
}


/**
 * A reopened question whose answers proposed changes (plan #1190), each card
 * in a state it can end in: done with its link and Undo, declined, undone,
 * and one still waiting. The /ask page and the sheet draw the same thread.
 */
export function AskChangesSurface() {
  // Fixed times, so the server's render and the browser's agree.
  const at = (hour: number) => `2026-09-28T${String(hour).padStart(2, '0')}:00:00Z`;
  const done = (change: DashChange, status: DashChange['status']): DashChange => ({
    ...change,
    createdAt: at(9),
    status,
    subjectRef: status === 'declined' ? null : `${change.kind === 'add_todo' ? 'todo.tasks' : 'goals.items'}:written`,
    writtenTable: status === 'declined' ? null : change.kind === 'add_todo' ? 'todo.tasks' : 'goals.items',
    writtenRef: status === 'declined' ? null : 'written',
    doneAt: status === 'declined' ? null : at(9),
    declinedAt: status === 'declined' ? at(9) : null,
    undoneAt: status === 'undone' ? at(11) : null,
  });
  const todo = (turnId: string): DashChange => ({
    ...CHANGE_BASE,
    id: `${turnId}-todo`,
    turnId,
    status: 'proposed',
    kind: 'add_todo',
    input: { title: 'Call the dentist', body: null, dueOn: '2026-10-02', dueTime: null, pinned: false },
  });
  const step = (turnId: string) => proposals(turnId)[1];
  const turns: TalkTurn[] = [
    {
      id: 'pa',
      role: 'user',
      body: 'Add a todo to call the dentist on Friday, and a step to book the hygienist',
      createdAt: at(9),
    },
    {
      id: 'ra',
      role: 'assistant',
      body:
        'I can add the todo "Call the dentist" due on Friday, and a step "Book the hygienist" under your goal to get your teeth sorted. Confirm each one below and I will write it.',
      createdAt: at(9),
    },
    { id: 'pb', role: 'user', body: 'Add the same again for Sam', createdAt: at(10) },
    {
      id: 'rb',
      role: 'assistant',
      body: 'I can add the todo and the step again. Confirm each one below.',
      createdAt: at(10),
    },
  ];
  return (
    <AskDashProvider source={FIXTURES}>
      <PageColumn className="py-4">
        <AskThread
          id="ask-changes-preview"
          conversationRef="00000000-0000-4000-8000-000000000009"
          turns={turns}
          changes={[
            done(todo('ra'), 'done'),
            done(step('ra'), 'declined'),
            done(todo('rb'), 'undone'),
            { ...step('rb'), createdAt: at(10) },
          ]}
          label="Ask a follow-up"
          placeholder="Ask more about this"
        />
      </PageColumn>
    </AskDashProvider>
  );
}

/**
 * The Ask page's list of the changes Dash made (plan #1191): one of each
 * kind, newest first, with one already undone. Undo on the todo or the
 * return puts it back; Undo on the step is refused, since it was worked on
 * since, and the reason shows under its row.
 */
function madeTable(change: DashChange): string {
  return change.kind === 'add_todo' ? 'todo.tasks' : change.kind === 'add_goal_step' ? 'goals.items' : 'shopping.returns';
}

export function AskMadeChangesSurface() {
  // Fixed times, so the server's render and the browser's agree.
  const at = (hour: number) => `2026-09-28T${String(hour).padStart(2, '0')}:00:00Z`;
  const made = (change: DashChange, hour: number, n: number, question: string | null): MadeChange => ({
    ...change,
    conversationId: `00000000-0000-4000-8000-00000000001${n}`,
    status: 'done',
    subjectRef: `${madeTable(change)}:${change.id}-row`,
    writtenTable: madeTable(change),
    writtenRef: `${change.id}-row`,
    createdAt: at(hour),
    doneAt: at(hour),
    question,
  });
  const todo = (id: string, title: string, dueOn: string | null): DashChange => ({
    ...CHANGE_BASE,
    id,
    turnId: 'm',
    status: 'proposed',
    kind: 'add_todo',
    input: { title, body: null, dueOn, dueTime: null, pinned: false },
  });
  const changes: MadeChange[] = [
    made(
      {
        ...CHANGE_BASE,
        id: 'm-ret',
        turnId: 'm',
        status: 'proposed',
        kind: 'mark_returned',
        input: { id: 'i1', itemTitle: 'Stanley flask, 1L' },
      },
      14,
      1,
      'I sent the flask back',
    ),
    made(todo('m-todo', 'Call the dentist', '2026-10-02'), 12, 2, 'Add a todo to call the dentist on Friday'),
    made(proposals('m')[1], 11, 3, 'Add a step to my teeth goal to book the hygienist'),
    { ...made(todo('m-old', 'Renew the car tax', null), 9, 4, null), status: 'undone', undoneAt: at(10) },
  ];
  const refuse = async (): Promise<ChangeOutcome> => ({ ok: false, error: 'You have already confirmed this change.', change: null });
  const presses = {
    confirm: refuse,
    decline: refuse,
    undo: async (id: string): Promise<ChangeOutcome> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const change = changes.find((c) => c.id === id);
      if (!change) return { ok: false, error: 'That change is not there any more.', change: null };
      if (change.kind === 'add_goal_step') {
        return { ok: false, error: 'That step has been worked on since, so Dash will not archive it.', change };
      }
      return { ok: true, change: { ...change, status: 'undone', undoneAt: new Date().toISOString() } };
    },
  };
  return (
    <PageColumn className="py-4">
      <PageHeader title="Questions to Dash" />
      <div className="space-y-6">
        <SectionFold title={<><DashCredit className="text-ink-muted" />Changes Dash made</>} count={changes.length}>
          <div className="mt-2">
            <MadeChanges changes={changes} presses={presses} today="2026-09-28" />
          </div>
        </SectionFold>
        <SectionFold title="Questions" count={RECENT.length}>
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {RECENT.map((conversation) => (
              <li key={conversation.id} className="px-1 py-2.5 text-body text-ink">
                {conversation.title}
              </li>
            ))}
          </ul>
        </SectionFold>
      </div>
    </PageColumn>
  );
}

/**
 * Dash's page (plan #1899.2): the chats on the left, grouped by day with the
 * workspaces each used, and the open chat beside them. `chat` says what the
 * middle holds: a chat opened from the list, or a new one. `listOpen: false`
 * draws the list hidden to its strip.
 */
const CHAT_TODAY = '2026-10-14';
const chatAt = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`;

export const DASH_CHATS: AskChat[] = [
  {
    id: 'd1',
    ref: '00000000-0000-4000-8000-000000000021',
    title: 'What did I spend on eBay flips this quarter?',
    lastAt: chatAt(CHAT_TODAY, 9),
    day: CHAT_TODAY,
    workspaces: ['shopping', 'todo'],
  },
  {
    id: 'd2',
    ref: '00000000-0000-4000-8000-000000000022',
    title: 'Which applications have gone quiet for two weeks or more, and who wrote to me last?',
    lastAt: chatAt(CHAT_TODAY, 8),
    day: CHAT_TODAY,
    workspaces: ['jobs'],
  },
  {
    id: 'd3',
    ref: '00000000-0000-4000-8000-000000000023',
    title: 'What should I read next on databases?',
    lastAt: chatAt('2026-10-13', 18),
    day: '2026-10-13',
    workspaces: ['learn'],
  },
  {
    id: 'd4',
    ref: '00000000-0000-4000-8000-000000000024',
    title: 'Am I on track for the half marathon?',
    lastAt: chatAt('2026-10-11', 7),
    day: '2026-10-11',
    workspaces: ['goals', 'todo'],
  },
  {
    id: 'd5',
    ref: '00000000-0000-4000-8000-000000000025',
    title: 'What have I written about burnout?',
    lastAt: chatAt('2026-10-02', 21),
    day: '2026-10-02',
    workspaces: ['vault'],
  },
  {
    id: 'd6',
    ref: '00000000-0000-4000-8000-000000000026',
    title: 'How many todos did I finish last week?',
    lastAt: chatAt('2026-09-28', 12),
    day: '2026-09-28',
    workspaces: [],
  },
];

const DASH_MADE_CHANGE: MadeChange = {
  ...CHANGE_BASE,
  id: 'dm1',
  turnId: 'm',
  kind: 'add_todo',
  input: { title: 'List the Catan lot', body: null, dueOn: '2026-10-16', dueTime: null, pinned: false },
  conversationId: '00000000-0000-4000-8000-000000000021',
  status: 'done',
  subjectRef: 'todo.tasks:dm1-row',
  writtenTable: 'todo.tasks',
  writtenRef: 'dm1-row',
  createdAt: chatAt(CHAT_TODAY, 9),
  doneAt: chatAt(CHAT_TODAY, 9),
  question: 'What did I spend on eBay flips this quarter?',
};
const DASH_MADE: MadeChange[] = [DASH_MADE_CHANGE];

const DASH_PRESSES = {
  confirm: pressed('done'),
  decline: pressed('declined'),
  undo: pressed('undone'),
};

/**
 * The open chat's turns for the page (plan #1899.4): the eBay answer with
 * the lookups behind it, a receipt sent with the follow-up, and the todo
 * Dash added, so the column beside it has something in every part.
 */
function dashPageTurns(question: string): TalkTurn[] {
  const [asked, answered] = answerTo(question);
  const orders = answered.citations!.slice(0, 3);
  return [
    { ...asked, createdAt: chatAt(CHAT_TODAY, 9) },
    {
      ...answered,
      createdAt: chatAt(CHAT_TODAY, 9),
      toolCalls: [
        { name: 'spend_by_merchant', input: { merchant: 'eBay' }, result: { ok: true, rows: orders } },
        {
          name: 'search',
          input: { query: 'unsold eBay flips' },
          result: {
            ok: true,
            rows: [{ table: 'shopping.inventory', ref: 'i1', title: 'Catan lot, still unsold in your inventory', href: '/shopping/inventory/i1' }],
          },
        },
        { name: 'todos', input: {}, result: { ok: true, rows: [answered.citations![3]] } },
      ],
    },
    {
      id: 'q2',
      role: 'user',
      body: 'Add a todo to list the Catan lot by Friday. The receipt is attached.',
      createdAt: chatAt(CHAT_TODAY, 10),
      files: [{ id: 'f1', name: 'ebay-receipt-catan-lot.pdf', contentType: 'application/pdf', size: 48_000, href: '#' }],
    },
    {
      id: 'a2',
      role: 'assistant',
      body: 'Done: I added "List the Catan lot" to your todos, due Friday.',
      createdAt: chatAt(CHAT_TODAY, 10),
      toolCalls: [{ name: 'add_todo', input: { title: 'List the Catan lot' }, result: { ok: true, rows: [] } }],
    },
  ];
}

const DASH_CHAT_CHANGES: DashChange[] = [{ ...DASH_MADE_CHANGE, turnId: 'a2' }];

export function DashPageSurface({
  chat = 'open',
  listOpen = true,
  usedOpen,
  sheetOpen = false,
}: {
  chat?: 'open' | 'new';
  listOpen?: boolean;
  /** The column of what Dash used, shown or folded. */
  usedOpen?: boolean;
  /** The column opened as a sheet, as it opens where there is no room for it. */
  sheetOpen?: boolean;
}) {
  const open = DASH_CHATS[0];
  const turns = dashPageTurns(open.title ?? '');
  return (
    <AskDashProvider source={FIXTURES}>
      <AppShell
        account="preview"
        module={null}
        sections={[]}
        displayName="Chris"
        email="chris@example.com"
        isOwner
        counts={{ jobs: '3', todo: '8', shopping: '1' }}
        theme={{ kind: 'written', id: 'paper' }}
        brief={null}
        pathname={chat === 'open' ? `/ask/${open.ref}` : '/ask'}
      >
        <Conversation
          label="Chats"
          open={chat === 'open'}
          initialListOpen={listOpen}
          newChat={{ href: '/ask', label: 'New chat' }}
          list={
            <AskChats
              chats={DASH_CHATS}
              today={CHAT_TODAY}
              made={DASH_MADE}
              presses={DASH_PRESSES}
              active={chat === 'open' ? open.ref : null}
            />
          }
        >
          {chat === 'open' ? (
            <ConversationChat
              title={open.title ?? 'A question'}
              back={CHATS_BACK}
              initialGlanceOpen={usedOpen ?? true}
              initialSheetOpen={sheetOpen}
              glance={{
                label: USED_LABEL,
                short: USED_SHORT,
                content: (
                  <ChatUsed
                    used={{
                      rows: chatReadRows(turns),
                      changes: DASH_CHAT_CHANGES,
                      lookups: chatLookups(turns),
                      files: chatFiles(turns),
                      costMicros: 41_000,
                    }}
                    presses={DASH_PRESSES}
                    today={CHAT_TODAY}
                  />
                ),
              }}
            >
              <AskThread
                id="dash-page-preview"
                conversationRef={open.ref}
                turns={turns}
                changes={DASH_CHAT_CHANGES}
                label="Ask a follow-up"
                placeholder="Ask more about this"
                startWriting
              />
            </ConversationChat>
          ) : (
            <NewDashChat />
          )}
        </Conversation>
      </AppShell>
    </AskDashProvider>
  );
}

/**
 * An answer kept elsewhere with the presses under it (plan #1899.7): the
 * first answer made a todo and saved to the vault, each card with Undo, and
 * Edit pressed on the second, so its question is back in the box to change.
 */
export function AskAnswerActionsSurface() {
  const at = (hour: number) => `2026-10-14T${String(hour).padStart(2, '0')}:00:00Z`;
  const first = answerTo('What did I spend on eBay flips this quarter?').map((turn) => ({
    ...turn,
    id: `s1-${turn.id}`,
    createdAt: at(9),
  }));
  const turns: TalkTurn[] = [
    ...first,
    { id: 's2-q', role: 'user', body: 'Which of them are still unsold?', createdAt: at(10) },
    {
      id: 's2-a',
      role: 'assistant',
      body: 'Two are still unsold: the Catan lot, listed at $210.00, and the Penguin Classics bundle, which is not listed yet.',
      createdAt: at(10),
    },
  ];
  return (
    <AskDashProvider source={FIXTURES}>
      {/* On the chat's card at reading width, as Dash's page draws it. */}
      <PageColumn className="py-4">
        <Card padding="standard" className="mx-auto w-full max-w-prose">
          <AskThread
            id="ask-actions-preview"
            conversationRef="00000000-0000-4000-8000-000000000021"
            turns={turns}
            changes={[savedChange('s1-a', 'todo', at(9)), savedChange('s1-a', 'vault', at(9))]}
            label="Ask a follow-up"
            placeholder="Ask more about this"
            startWriting
            initialDraft="Which of them are still unsold, and for how long?"
          />
        </Card>
      </PageColumn>
    </AskDashProvider>
  );
}
