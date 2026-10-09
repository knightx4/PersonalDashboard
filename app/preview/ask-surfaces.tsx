'use client';

import { useEffect } from 'react';
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

const FIXTURES: AskSource = {
  ask: async (question, _ref, _page, onLookup) => {
    // The lookups appear one by one while the answer is written (plan #1438).
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
    if (/^(add|remind)/i.test(question)) {
      return { conversation, ...proposalTo(question), stop: 'answered' };
    }
    return { conversation, turns: answerTo(question), stop: 'answered' };
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
function OpenOnArrival({ question }: { question?: string }) {
  const handle = useAskDash();
  useEffect(() => {
    handle?.open(question);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function AskDashSurface({
  open = false,
  question,
  page = '/jobs',
  children,
}: {
  open?: boolean;
  question?: string;
  /** The page the sheet opens over; the gallery's own address says nothing. */
  page?: string;
  children: React.ReactNode;
}) {
  return (
    <AskDashProvider source={FIXTURES} page={page}>
      {children}
      {open && <OpenOnArrival question={question} />}
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
      <div className="mx-auto max-w-3xl py-4">
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
      </div>
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
    <div className="mx-auto max-w-3xl py-4">
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
    </div>
  );
}
