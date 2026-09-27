'use client';

import { useEffect } from 'react';
import { AskDashProvider, useAskDash, type AskSource } from '@/components/shell/ask-dash';
import type { ConversationSummary } from '@/lib/talk/store';
import type { TalkTurn } from '@/lib/talk/talk';

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

const FIXTURES: AskSource = {
  ask: async (question) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
      conversation: { ref: '00000000-0000-4000-8000-000000000009', title: question },
      turns: answerTo(question),
      stop: 'answered',
    };
  },
  recent: async () => ({ conversations: RECENT }),
  open: async () => ({ turns: answerTo(RECENT[0].title ?? '') }),
  costs: async () => ({
    'app/ask/actions.ts#askDashQuestion': {
      lowMicros: 20_000,
      medianMicros: 45_000,
      highMicros: 110_000,
      runs: 0,
      basis: 'guess',
      per: 'run',
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
  children,
}: {
  open?: boolean;
  question?: string;
  children: React.ReactNode;
}) {
  return (
    <AskDashProvider source={FIXTURES}>
      {children}
      {open && <OpenOnArrival question={question} />}
    </AskDashProvider>
  );
}
