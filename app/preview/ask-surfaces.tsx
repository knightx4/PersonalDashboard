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
import { AskChats, type ChatEdits } from '@/app/ask/chats';
import { ArchivedNote, CHATS_BACK, NewDashChat, USED_LABEL, USED_SHORT } from '@/app/ask/view';
import { ChatUsed } from '@/app/ask/used';
import { chatFiles, chatLookups, chatReadRows } from '@/lib/talk/chat-trail';
import type { AskChat } from '@/lib/talk/ask-chats';
import type { SearchHit } from '@/lib/search/sources';
import type { ModuleId } from '@/lib/modules';
import type { AskBoxStart } from '@/components/talk/ask-box';
import { stoppedBody } from '@/lib/talk/talk';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';

/**
 * The Ask Dash sheet in the surface gallery (plan #1090), fed with typed
 * fixtures in place of the server actions, since the gallery cannot sign in.
 * Wraps the whole shell, whose own provider then stands down in favour of
 * this one.
 */

const DAY = 24 * 60 * 60 * 1000;

/** What an answer costs, as the sheet reads it and the Dash page's shell provides it. */
const ASK_COSTS: PaidCosts = {
  'app/api/ask/route.ts#POST': {
    lowMicros: 20_000,
    medianMicros: 45_000,
    highMicros: 110_000,
    runs: 0,
    basis: 'guess',
    per: 'run',
    models: [SONNET],
  },
};
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

/**
 * The question the at-work strips send (plan #1899.8). Its fixture answers at
 * the pace the recorder can show in a second: two lookups one after the
 * other, then a short answer written out, so the strip runs from the press
 * to the mark at rest.
 */
export const AT_WORK_QUESTION = 'How much did I spend on eBay this quarter?';

const AT_WORK_ANSWER = 'You spent $412.60 on eBay this quarter, across three orders.';

/** Hands `body` to `onText` a few words at a time, as the route's text lines arrive. */
async function writeOut(
  body: string,
  onText: ((piece: string) => void) | undefined,
  wait: (ms: number) => Promise<unknown>,
  every = 40,
) {
  if (!onText) return;
  const pieces = body.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < pieces.length; i += 3) {
    onText(pieces.slice(i, i + 3).join(''));
    await wait(every);
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
    // The recorder's strip runs timers four times faster than its own clock, so
    // the at-work fixture is paced to be read at that speed (plan #1899.8).
    const pace = question === AT_WORK_QUESTION ? 500 : 300;
    const search = { id: 'l1', index: 0, name: 'search', input: { query: question.slice(0, 40) } };
    onLookup?.({ phase: 'started', ...search });
    await wait(pace);
    onLookup?.({ phase: 'finished', ...search, ok: true, found: 2 });
    await wait(question === AT_WORK_QUESTION ? 0 : 300);
    const conversation = { ref: '00000000-0000-4000-8000-000000000009', title: question };
    if (question === FAILING_QUESTION) {
      return {
        conversation,
        turns: [{ id: 'fq', role: 'user', body: question, createdAt: new Date().toISOString() }],
        error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot answer.',
      };
    }
    if (question === AT_WORK_QUESTION) {
      const spend = { id: 'l2', index: 1, name: 'spend_by_merchant', input: { merchant: 'eBay' } };
      onLookup?.({ phase: 'started', ...spend });
      await wait(500);
      onLookup?.({ phase: 'finished', ...spend, ok: true, found: 3 });
      await writeOut(AT_WORK_ANSWER, onText, wait, 160);
      const at = new Date().toISOString();
      return {
        conversation,
        turns: [
          { id: 'tq', role: 'user', body: question, createdAt: at },
          {
            id: 'ta',
            role: 'assistant',
            body: AT_WORK_ANSWER,
            createdAt: at,
            toolCalls: [
              { name: 'search', input: { query: question.slice(0, 40) }, result: { ok: true, rows: [] } },
              { name: 'spend_by_merchant', input: { merchant: 'eBay' }, result: { ok: true, rows: [] } },
            ],
          },
        ],
        stop: 'answered',
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
  rate: async (_ref, _turnId, rating, note) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { ok: true, rating, note: rating === null ? null : (note ?? null) };
  },
  confirm: pressed('done'),
  decline: pressed('declined'),
  undo: pressed('undone'),
  costs: async () => ASK_COSTS,
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
  draft,
  rows,
  page = '/jobs',
  modelStart,
  children,
}: {
  /** The model chip's list open, or a pick that could not be saved (plan #2458.3). */
  modelStart?: 'open' | 'failed';
  open?: boolean;
  question?: string;
  /** Words in the sheet's box, unsent, for a strip that presses Send (plan #1899.8). */
  draft?: string;
  /** A filtered list sent with the question (plan #1658). */
  rows?: AskRows;
  /** The page the sheet opens over; the gallery's own address says nothing. */
  page?: string;
  children: React.ReactNode;
}) {
  return (
    <AskDashProvider
      source={FIXTURES}
      page={page}
      account="preview"
      workspaces={BOX_WORKSPACES}
      searchHits={BOX_HITS}
      draft={draft}
      modelStart={modelStart}
    >
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
    pinnedAt: chatAt(CHAT_TODAY, 7),
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
  {
    id: 'd7',
    ref: '00000000-0000-4000-8000-000000000027',
    title: 'Which flights to Lisbon did I look at in August?',
    lastAt: chatAt('2026-09-14', 20),
    day: '2026-09-14',
    workspaces: ['goals'],
    archivedAt: chatAt('2026-10-01', 9),
  },
];

/** What the list's presses do in the gallery: each lands, after a moment. */
const DASH_EDITS: ChatEdits = {
  pin: async () => ({ ok: true }),
  rename: async () => ({ ok: true }),
  archive: async () => ({ ok: true }),
  search: async (text) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { hits: SEARCH_HITS.filter((hit) => hit.snippet.toLowerCase().includes(text.toLowerCase())) };
  },
};

/** What a search for "Catan" finds said inside two chats, one of them only in an answer. */
const SEARCH_HITS = [
  {
    ref: '00000000-0000-4000-8000-000000000021',
    snippet: '…Two of them are still unsold in your inventory, and your todo to list the Catan lot is five days overdue.',
  },
  {
    ref: '00000000-0000-4000-8000-000000000024',
    snippet: '…a long run on Sunday, then the board game night with the Catan crowd on Tuesday, so keep Monday easy…',
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
  list,
  draft,
  modelStart,
}: {
  /** The model chip's list open, or a pick that could not be saved (plan #2458.3). */
  modelStart?: 'open' | 'failed';
  chat?: 'open' | 'new' | 'archived';
  /** Words in the open chat's box, unsent, for a strip that presses Send (plan #1899.8). */
  draft?: string;
  /** The list's hidden parts (plan #1899.6): a search, a menu, a rename or Archived open. */
  list?: 'search' | 'menu' | 'rename' | 'archived';
  listOpen?: boolean;
  /** The column of what Dash used, shown or folded. */
  usedOpen?: boolean;
  /** The column opened as a sheet, as it opens where there is no room for it. */
  sheetOpen?: boolean;
}) {
  const open = chat === 'archived' ? DASH_CHATS[DASH_CHATS.length - 1] : DASH_CHATS[0];
  const turns: TalkTurn[] =
    chat === 'archived'
      ? [
          { id: 'lq', role: 'user', body: open.title ?? '', createdAt: open.lastAt },
          {
            id: 'la',
            role: 'assistant',
            body: 'Three: TAP from Heathrow on 3 October for $212, easyJet from Gatwick on 4 October for $164, and British Airways on 5 October for $298. You saved the easyJet one to your Lisbon trip goal.',
            createdAt: open.lastAt,
          },
        ]
      : dashPageTurns(open.title ?? '');
  const opened = chat !== 'new';
  return (
    // The shell's cost hints, as app/ask/layout.tsx reads them for the box.
    <PaidCostsProvider costs={ASK_COSTS}>
    <AskDashProvider source={FIXTURES} modelStart={modelStart}>
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
        pathname={opened ? `/ask/${open.ref}` : '/ask'}
      >
        <Conversation
          label="Chats"
          fill
          open={opened}
          initialListOpen={listOpen}
          newChat={{ href: '/ask?chat=new', label: 'New chat' }}
          list={
            <AskChats
              chats={DASH_CHATS}
              today={CHAT_TODAY}
              made={DASH_MADE}
              presses={DASH_PRESSES}
              edits={DASH_EDITS}
              active={opened ? open.ref : null}
              initialQuery={list === 'search' ? 'Catan' : undefined}
              initialHits={list === 'search' ? SEARCH_HITS : undefined}
              initialMenu={list === 'menu' ? DASH_CHATS[1].ref : null}
              initialRenaming={list === 'rename' ? DASH_CHATS[1].ref : null}
              initialArchivedOpen={list === 'archived' || chat === 'archived'}
            />
          }
        >
          {opened ? (
            <ConversationChat
              title={open.title ?? 'A question'}
              back={CHATS_BACK}
              fill
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
              {chat === 'archived' && <ArchivedNote conversationRef={open.ref} restore={DASH_EDITS.archive} />}
              <AskThread
                id="dash-page-preview"
                conversationRef={open.ref}
                turns={turns}
                changes={DASH_CHAT_CHANGES}
                label="Ask a follow-up"
                placeholder="Ask more about this"
                dock
                initialDraft={draft}
              />
            </ConversationChat>
          ) : (
            <NewDashChat />
          )}
        </Conversation>
      </AppShell>
    </AskDashProvider>
    </PaidCostsProvider>
  );
}

/**
 * An answer kept elsewhere with the presses under it (plan #1899.7): the
 * first answer made a todo and saved to the vault, each card with Undo, and
 * Edit pressed on the second, so its question is back in the box to change.
 *
 * The thumbs under each answer (plan #2285.2) draw unpressed here, and each
 * hidden part has its own `thumbs` moment: `rated` with the first answer up
 * and the second down with what went wrong, `note` with thumbs down just
 * pressed on the second and What went wrong? open, `error` with a refused
 * thumbs up put back and the line saying why, and `tip` with the tooltip
 * held on the second answer's thumbs down.
 */
export type AnswerThumbsMoment = 'rated' | 'note' | 'error' | 'tip';

const RATING_REFUSED = 'That was not kept. Check your connection and try again.';

export function AskAnswerActionsSurface({ thumbs }: { thumbs?: AnswerThumbsMoment } = {}) {
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
      ...(thumbs === 'rated'
        ? { rating: 'down' as const, ratingNote: 'It left out the board games I sold on Vinted last month' }
        : {}),
    },
  ];
  if (thumbs === 'rated') turns[1] = { ...turns[1], rating: 'up' };
  const source: AskSource =
    thumbs === 'error' ? { ...FIXTURES, rate: async () => ({ ok: false, error: RATING_REFUSED }) } : FIXTURES;
  return (
    <AskDashProvider source={source}>
      {thumbs === 'note' && <ActOnArrival label="Thumbs down" />}
      {thumbs === 'error' && <ActOnArrival label="Thumbs up" />}
      {thumbs === 'tip' && <ActOnArrival label="Thumbs down" focus />}
      {/* On the chat's card at reading width, as Dash's page draws it. */}
      <PageColumn className="py-4">
        <Card padding="standard" className="mx-auto w-full max-w-prose">
          <AskThread
            id={`ask-actions-preview${thumbs ? `-${thumbs}` : ''}`}
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

/** Which moment of the paid card a surface draws (plan #2228.2). */
export type AskPaidMoment = 'pending' | 'running' | 'done' | 'failed' | 'declined';

const PAID_ASKED =
  'Write up this year, and draft my answers on the Northwind Analytics application and the Fernhill Labs one';
const PAID_ANSWER =
  'I have queued three things that cost money: the review of 2026, and drafts of the answers on both applications. Nothing runs until you accept them on the card below.';

/**
 * The approval card for what costs money (plan #2228.2): three queued
 * presses with a cost each and the total, one Accept all and Decline.
 * `running` presses Accept all and holds the first line running; `done`,
 * `failed` and `declined` draw the card as it is once each has come back.
 */
export function AskPaidSurface({ moment = 'pending' }: { moment?: AskPaidMoment }) {
  const at = (minute: number) => `2026-10-16T09:${String(minute).padStart(2, '0')}:00Z`;
  const priced = (medianMicros: number) => ({
    lowMicros: Math.round(medianMicros * 0.7),
    medianMicros,
    highMicros: Math.round(medianMicros * 1.6),
    runs: 9,
    basis: 'measured' as const,
    per: 'run' as const,
    models: [SONNET],
  });
  const press = (id: string, line: string, medianMicros: number | null, paths: string[]): DashChange => ({
    ...CHANGE_BASE,
    id,
    turnId: 'paid-a',
    status: 'proposed',
    kind: 'paid_action',
    createdAt: at(1),
    input: {
      tool: 'write_year_review',
      action: 'app/timeline/actions.ts#writeYearReview',
      args: {},
      line,
      estimate: medianMicros == null ? null : priced(medianMicros),
      workspace: null,
      paths,
    },
  });
  const ran = (change: DashChange, summary: string): DashChange => ({
    ...change,
    status: 'done',
    doneAt: at(3),
    summary,
    undo: { none: 'Dash ran this and the money is spent, so it cannot be undone.' },
  });
  const review = press('paid-1', 'Write the review of 2026.', 62_000, ['/timeline']);
  const northwind = press(
    'paid-2',
    'Draft the answers on the Northwind Analytics application, Senior Data Analyst.',
    148_000,
    ['/jobs/pipeline'],
  );
  const fernhill = press('paid-3', 'Draft the answers on the Fernhill Labs application.', 131_000, ['/jobs/pipeline']);
  const wrote = 'Dash wrote the review of 2026: 6 paragraphs from 84 events.';
  const drafted = 'Dash drafted answers to the 5 questions on it.';
  const changes: DashChange[] =
    moment === 'done'
      ? [ran(review, wrote), ran(northwind, 'Dash drafted answers to the 7 questions on it.'), ran(fernhill, drafted)]
      : moment === 'failed'
        ? [
            ran(review, wrote),
            {
              ...northwind,
              undo: { failed: 'The application has no questions on it yet. Paste them in on its page, then run this again.' },
            },
            ran(fernhill, drafted),
          ]
        : moment === 'declined'
          ? [review, northwind, fernhill].map((change) => ({ ...change, status: 'declined' as const, declinedAt: at(3) }))
          : [review, northwind, fernhill];
  const turns: TalkTurn[] = [
    { id: 'paid-q', role: 'user', body: PAID_ASKED, createdAt: at(0) },
    { id: 'paid-a', role: 'assistant', body: PAID_ANSWER, createdAt: at(1) },
  ];
  // Running: the first press never comes back, so its line holds the spinner.
  const source: AskSource =
    moment === 'running' ? { ...FIXTURES, confirm: () => new Promise<ChangeOutcome>(() => undefined) } : FIXTURES;
  return (
    <AskDashProvider source={source}>
      <PageColumn className="py-4">
        {moment === 'running' && <PressOnArrival label="Accept all" />}
        {/* On the chat's card at reading width, as Dash's page draws it. */}
        <Card padding="standard" className="mx-auto w-full max-w-prose">
          <AskThread
            id={`ask-paid-preview-${moment}`}
            conversationRef="00000000-0000-4000-8000-000000000031"
            turns={turns}
            changes={changes}
            label="Ask a follow-up"
            placeholder="Ask more about this"
          />
        </Card>
      </PageColumn>
    </AskDashProvider>
  );
}

const BUILD_TITLE = 'Show a Confirm card when Ask Dash is asked to build a step';
const BUILD_ASKED = 'I can start this one.';

/**
 * Asking Ask Dash to build plan steps (plan #2106.1): a card naming the step
 * with Confirm and Decline, one whose last run has gone quiet, and a step
 * that cannot be built, refused in words with no card. `refused` draws the
 * card after a Confirm the server turned down, with the reason under it.
 */
export function AskBuildSurface({ refused = false }: { refused?: boolean }) {
  // Fixed times, so the server's render and the browser's agree.
  const at = (minute: number) => `2026-10-15T09:${String(minute).padStart(2, '0')}:00Z`;
  const build = (turnId: string, number: number, outline: string, title: string, quiet: boolean): DashChange => ({
    ...CHANGE_BASE,
    id: `${turnId}-build`,
    turnId,
    status: 'proposed',
    kind: 'start_build',
    createdAt: at(1),
    input: { stepId: `${turnId}-step`, number, outline, title, quiet },
  });
  const first = build('ra', 2110, '2106.1', BUILD_TITLE, false);
  const asked: TalkTurn[] = [
    { id: 'pa', role: 'user', body: 'Build #2106.1', createdAt: at(0) },
    { id: 'ra', role: 'assistant', body: BUILD_ASKED, createdAt: at(1) },
  ];
  const turns: TalkTurn[] = refused
    ? asked
    : [
        ...asked,
        { id: 'pb', role: 'user', body: 'Restart #1894.6.9, it looks stuck', createdAt: at(2) },
        {
          id: 'rb',
          role: 'assistant',
          body: 'Its last run has pushed nothing for 40 minutes.',
          createdAt: at(3),
        },
        { id: 'pc', role: 'user', body: 'And build #2106.2 too', createdAt: at(4) },
        {
          id: 'rc',
          role: 'assistant',
          body: 'I cannot start #2106.2 yet. #2106.1 under the same feature is already underway, and a feature takes one session at a time. Ask again once that step is closed.',
          createdAt: at(5),
        },
      ];
  const changes = refused
    ? [first]
    : [first, build('rb', 2045, '1894.6.9', 'Let Ask Dash edit the interviews on a role', true)];
  const source: AskSource = refused
    ? {
        ...FIXTURES,
        confirm: async () => ({
          ok: false,
          error:
            '#2106.2 under the same feature was claimed four minutes ago, and a feature takes one session at a time. Wait for it to finish, or put it back to not started.',
          change: first,
        }),
      }
    : FIXTURES;
  return (
    <AskDashProvider source={source}>
      <PageColumn className="py-4">
        {refused && <PressOnArrival label="Confirm" />}
        <AskThread
          id="ask-build-preview"
          conversationRef="00000000-0000-4000-8000-000000000019"
          turns={turns}
          changes={changes}
          label="Ask a follow-up"
          placeholder="Ask more about this"
        />
      </PageColumn>
    </AskDashProvider>
  );
}

const ANSWERS = [
  'Why do you want to work at Northwind?',
  'Why us?',
  'Why are you interested in this role?',
  'What draws you to Northwind Logistics?',
  'Tell us about a time you led a project under a tight deadline and had to change the plan halfway through',
  'Describe your biggest strength',
  'What is your biggest strength?',
  'Where do you see yourself in five years?',
  'Why this role?',
  'What would you bring to the team?',
  'What are you looking for in your next role?',
  'Why now?',
];

/**
 * The "Are you sure?" popup for a proposed delete (plan #2232.2): Confirm on
 * the card opens it over the thread, listing the answers with Cancel and
 * Delete. `refused` presses Delete too, for the popup after the server turned
 * the delete down, with the reason inside it and the rows kept; `deleting`
 * presses it and leaves the delete running, for the pending buttons.
 */
export function AskDeleteSurface({ mode = 'open' }: { mode?: 'open' | 'refused' | 'deleting' }) {
  const at = (minute: number) => `2026-10-15T09:${String(minute).padStart(2, '0')}:00Z`;
  const change: DashChange = {
    ...CHANGE_BASE,
    id: 'rd-delete',
    turnId: 'rd',
    status: 'proposed',
    kind: 'delete_rows',
    createdAt: at(1),
    input: {
      table: 'job_search.application_answers',
      count: ANSWERS.length,
      titles: ANSWERS,
      href: '/jobs/answers',
      rows: [],
    },
  };
  const turns: TalkTurn[] = [
    { id: 'pd', role: 'user', body: 'Remove my duplicate application answers', createdAt: at(0) },
    { id: 'rd', role: 'assistant', body: 'These answer the same questions as ones you kept.', createdAt: at(1) },
  ];
  const source: AskSource =
    mode === 'refused'
      ? {
          ...FIXTURES,
          confirm: async () => ({
            ok: false,
            error: '“Why us?” was edited after Dash found it. Nothing was deleted; ask again to see the current list.',
            change,
          }),
        }
      : mode === 'deleting'
        ? { ...FIXTURES, confirm: () => new Promise<ChangeOutcome>(() => {}) }
        : FIXTURES;
  return (
    <AskDashProvider source={source}>
      <PageColumn className="py-4">
        <PressInOrder labels={mode === 'open' ? ['Confirm'] : ['Confirm', 'Delete']} />
        <AskThread
          id="ask-delete-preview"
          conversationRef="00000000-0000-4000-8000-000000000021"
          turns={turns}
          changes={[change]}
          label="Ask a follow-up"
          placeholder="Ask more about this"
        />
      </PageColumn>
    </AskDashProvider>
  );
}

/** Presses the buttons reading `labels` in turn once the page has arrived. */
function PressInOrder({ labels }: { labels: string[] }) {
  useEffect(() => {
    const timers = labels.map((label, index) =>
      setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        buttons.find((b) => b.textContent?.trim() === label)?.click();
      }, 100 * index),
    );
    return () => timers.forEach(clearTimeout);
  }, [labels]);
  return null;
}

/** Presses the first button reading `label` once the page has arrived: a state only a press reaches. */
function PressOnArrival({ label }: { label: string }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
      button?.click();
    }, 0);
    return () => clearTimeout(timer);
  }, [label]);
  return null;
}

/**
 * Presses, or with `focus` rests the mouse on, the last button named
 * `label` once the surface has drawn: the thumbs under the newest answer.
 */
function ActOnArrival({ label, focus = false }: { label: string; focus?: boolean }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      const named = Array.from(document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`));
      const button = named[named.length - 1];
      // A mouse resting on it, which is what opens a tooltip.
      if (focus) button?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      else button?.click();
    }, 0);
    return () => clearTimeout(timer);
  }, [label, focus]);
  return null;
}
