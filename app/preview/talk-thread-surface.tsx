'use client';

import { Thread, type TalkSend } from '@/components/thread/thread';
import type { DashChart } from '@/lib/talk/chart';
import { Card } from '@/components/ui/card';
import { CostHint } from '@/components/ui/cost-hint';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import { sumEstimates, type CostEstimate } from '@/lib/core/spend/estimate-types';
import { filesEstimate } from '@/lib/dash/file-cost';
import { DASH_MODELS } from '@/lib/dash/models';
import type { TalkToolCall, TalkTurn } from '@/lib/talk/talk';
import { PageColumn } from '@/components/shell/page-width';
import { AskDashProvider, AskThread, type AskSource } from '@/components/shell/ask-dash';

/**
 * The Ask Dash thread on its own (plan #1708): components/thread/thread.tsx
 * with nothing of the sheet or a page around it, which is where a change to
 * the thread is looked at (COMPONENT_SURFACES in lib/preview/routes.ts)
 * instead of on every page that imports it.
 *
 * One conversation runs through each kind of answer the thread draws: a short
 * one with the rows it used, a long one written in markdown, one that drew
 * bars and one that drew a table. The last two carry their charts as kept
 * `show_chart` calls, in the shape lib/talk/chart.ts reads (plan #1655), so
 * the thread draws them as soon as it draws charts; until then their words
 * stand alone, and are written to.
 *
 * It is drawn on a card, and Dash's turns take the recessed ground of his
 * voice (taste `no-bare-text`), as they do on every thread (plan #1964.3).
 */

// Fixed times, so the server's render and the browser's agree.
const at = (hour: number, minute = 0) =>
  `2026-09-28T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;

/** A `show_chart` call as a kept turn holds it: the tool's result is the chart. */
function chartCall(chart: Omit<DashChart, 'reference'> & { reference?: DashChart['reference'] }): TalkToolCall {
  const kept = { reference: null, ...chart };
  return { name: 'show_chart', input: kept, result: { ok: true, chart: kept } };
}

/** Twelve shops, the most a chart draws, with the longest name a shop is given. */
const SPEND: [string, number][] = [
  ['Amazon', 1843.2],
  ['eBay', 412.6],
  ['The Very Long Named Independent Bookshop & Coffee House', 286.45],
  ['Uniqlo', 214],
  ['Apple', 199],
  ['Steam', 96.37],
  ['IKEA', 89.99],
  ['Etsy', 64.5],
  ['Target', 52.18],
  ['Best Buy', 49.99],
  ['Patagonia', 39],
  ['Everything else', 118.74],
];

const LONG_REPLY = [
  'You have three ways to get the Kyoto trip under $2,400, and the first does most of the work.',
  '',
  '**Fly midweek.** The return you saved for Friday 14 November is $1,180. The same flights leaving on the Tuesday are $865, and your calendar is clear that week apart from the dentist on the Thursday morning, which you could move.',
  '',
  '**Swap two hotel nights for the ryokan you bookmarked.** It is $40 a night less than the Gion hotel and includes breakfast, which you had budgeted at about $25 a day.',
  '',
  '**Drop the rail pass.** Your plan only leaves Kyoto twice, to Nara and to Osaka, and the two return tickets come to $46 against $210 for the seven-day pass.',
  '',
  'Together that is:',
  '',
  '- flights: $315 less',
  '- hotel: $160 less over four nights',
  '- rail: $164 less',
  '',
  'which takes the total from $2,890 to $2,251. The flights are the only part with a deadline: the Tuesday fare has gone up twice since you saved it, so it is worth deciding on this week.',
].join('\n');

/** A small picture standing in for a photo, as a data link since the gallery has no storage. */
const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="lightsteelblue"/><circle cx="44" cy="46" r="14" fill="khaki"/><path d="M0 128 L50 70 L84 104 L104 86 L128 112 V128 Z" fill="seagreen"/></svg>',
  );

const TURNS: TalkTurn[] = [
  {
    id: 'q1',
    role: 'user',
    body: 'How much did I spend on eBay flips this quarter? The receipts are attached.',
    createdAt: at(9),
    files: [
      { id: 'f1', name: 'catan-lot-receipt.png', contentType: 'image/png', size: 214_000, href: PHOTO },
      { id: 'f2', name: 'ebay-orders-quarter-three.pdf', contentType: 'application/pdf', size: 1_480_000, href: '#' },
      {
        id: 'f3',
        name: 'Penguin Classics bundle and the Ticket to Ride Europe listing notes, final version.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 48_000,
        href: '#',
      },
    ],
  },
  {
    id: 'a1',
    role: 'assistant',
    body:
      'You spent $412.60 on eBay flips this quarter across three orders. Two of them are still unsold in your inventory, and your todo to list the Catan lot is five days overdue.',
    createdAt: at(9),
    citations: [
      { table: 'shopping.orders', ref: 'o1', title: 'Catan lot, eBay', href: '/shopping/orders/o1' },
      { table: 'shopping.orders', ref: 'o2', title: 'Penguin Classics bundle, eBay', href: '/shopping/orders/o2' },
      { table: 'todo.tasks', ref: 't1', title: 'List the Catan lot', href: '/todo/t/t1' },
    ],
  },
  { id: 'q2', role: 'user', body: 'How could I get the Kyoto trip under budget?', createdAt: at(9, 20) },
  { id: 'a2', role: 'assistant', body: LONG_REPLY, createdAt: at(9, 20) },
  { id: 'q3', role: 'user', body: 'Where did my money go this year?', createdAt: at(10) },
  {
    id: 'a3',
    role: 'assistant',
    body:
      'You spent $3,466.02 across 41 orders this year. Amazon is over half of it at $1,843.20, and eBay is a distant second at $412.60.',
    createdAt: at(10),
    toolCalls: [
      chartCall({
        kind: 'bar',
        title: 'Spending by shop, 2026',
        rows: SPEND.map(([label, value]) => ({ label, value })),
        currency: 'USD',
        unit: null,
        columns: null,
      }),
    ],
  },
  { id: 'q4', role: 'user', body: 'Where are my applications stuck?', createdAt: at(10, 30) },
  {
    id: 'a4',
    role: 'assistant',
    body:
      'Most of the wait is after the first interview: roles at that stage have gone a median of 23 days without word, against 9 for the ones still at applied.',
    createdAt: at(10, 30),
    citations: [
      {
        table: 'job_search.applications',
        ref: 'a1',
        title: 'Senior Product Designer at Northwind',
        href: '/jobs/roles/r1',
      },
    ],
    toolCalls: [
      chartCall({
        kind: 'table',
        title: 'Days without word, by stage',
        rows: [
          { label: 'Applied', value: 9 },
          { label: 'Recruiter screen', value: 14 },
          { label: 'First interview', value: 23 },
          { label: 'Final round', value: 6 },
        ],
        currency: null,
        unit: 'days',
        columns: ['Stage', 'Median days'],
      }),
    ],
  },
  { id: 'q5', role: 'user', body: 'What did I spend on food delivery in September?', createdAt: at(11) },
  {
    id: 'a5',
    role: 'assistant',
    body:
      'You spent $412.80 on food delivery in September across 19 orders. That is 38% more than your June to August average of $299 a month, and the first month this year over your $300 budget.',
    createdAt: at(11),
    toolCalls: [
      chartCall({
        kind: 'figure',
        title: 'Food delivery, September',
        rows: [{ label: 'September, 19 orders', value: 412.8 }],
        currency: 'USD',
        unit: null,
        columns: null,
        reference: { label: 'Jun to Aug average', value: 299 },
      }),
      chartCall({
        kind: 'columns',
        title: 'Food delivery by month, 2026',
        rows: [
          { label: 'Apr', value: 262.4 },
          { label: 'May', value: 281 },
          { label: 'Jun', value: 305 },
          { label: 'Jul', value: 276 },
          { label: 'Aug', value: 316 },
          { label: 'Sep', value: 412.8 },
        ],
        currency: 'USD',
        unit: null,
        columns: null,
        reference: { label: 'Budget', value: 300 },
      }),
    ],
  },
];

/** The gallery cannot ask: a follow-up is answered with a fixed line after a moment. */
const send: TalkSend = async (body) => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const now = new Date().toISOString();
  return {
    turns: [
      { id: `q-${now}`, role: 'user', body, createdAt: now },
      {
        id: `a-${now}`,
        role: 'assistant',
        body: 'The gallery cannot ask Dash, so this is a fixed reply.',
        createdAt: now,
      },
    ],
  };
};

export function TalkThreadSurface() {
  return (
    <PageColumn className="py-4">
      {/* The figure an answer costs, as the ledger would give it, so the $
          beside "Ask a follow-up" draws as it does in the sheet. */}
      <PaidCostsProvider costs={{ [ASK_ACTION]: ANSWER_COST }}>
        <Card padding="standard">
          <Thread
            id="talk-thread-preview"
            turns={TURNS}
            send={send}
            label="Ask a follow-up"
            placeholder="Ask more about this"
            withFiles
            cost={{ action: ASK_ACTION, what: 'Cost of each answer from Dash' }}
          />
        </Card>
      </PaidCostsProvider>
    </PageColumn>
  );
}

/** The action an Ask Dash answer is priced by (app/api/ask/route.ts). */
const ASK_ACTION = 'app/api/ask/route.ts#POST';

/** A bill photographed and its PDF, added to a question before it is sent. */
const BILL_FILES: UploadedAttachment[] = [
  {
    path: 'preview/electricity-bill-october.jpg',
    name: 'electricity-bill-october.jpg',
    contentType: 'image/jpeg',
    size: 2_100_000,
  },
  {
    path: 'preview/Octopus Energy statement 2026-10.pdf',
    name: 'Octopus Energy statement 2026-10.pdf',
    contentType: 'application/pdf',
    size: 380_000,
  },
];

/** What an answer costs before any file, as the Ask Dash sheet's fixture has it. */
const ANSWER_COST: CostEstimate = {
  lowMicros: 20_000,
  medianMicros: 45_000,
  highMicros: 110_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [DASH_MODELS.ask],
};

/**
 * A question with files added, before it is sent (plan #1716): the $ beside
 * Send is open and includes reading the two files, which is what rises as
 * files are added. The live hint finds the answer's figure by its action
 * (PaidHint); the gallery has no ledger, so the same sum is drawn from a
 * fixture.
 */
export function TalkThreadFilesSurface() {
  return (
    <PageColumn className="py-4">
      <Card padding="standard">
        <Thread
          id="talk-thread-files-preview"
          turns={[]}
          send={send}
          label="Ask a question"
          placeholder="What did I spend on eBay this month?"
          withFiles
          startWriting
          initialDraft="What is the due date on this bill, and how much is it?"
          initialFiles={BILL_FILES}
          sendHint={(files) => {
            const reading = filesEstimate(files, DASH_MODELS.ask);
            const estimate = sumEstimates(reading ? [ANSWER_COST, reading] : [ANSWER_COST]);
            return estimate ? (
              <CostHint
                estimate={estimate}
                what="Cost of this answer from Dash, reading the files"
                align="end"
                defaultOpen
              />
            ) : null;
          }}
        />
      </Card>
    </PageColumn>
  );
}

/** Nothing in the gallery answers: every call waits, so the chat stays mid-answer. */
const never = () => new Promise<never>(() => {});
const WAITING_SOURCE: AskSource = {
  ask: never,
  recent: never,
  open: never,
  poll: never,
  costs: never,
  label: never,
  confirm: never,
  decline: never,
  undo: never,
  save: never,
  rate: never,
};

/**
 * A chat in the middle of an answer (plan #2262.2): Dash's earlier message
 * once, the follow-up just sent, and the loading line under it. The loading
 * state is the surface itself; nothing is hovered or open.
 */
export function TalkThreadWaitingSurface() {
  return (
    <AskDashProvider source={WAITING_SOURCE}>
      <PageColumn className="py-4">
        <Card padding="standard">
          <AskThread
            id="talk-thread-waiting-preview"
            conversationRef="00000000-0000-4000-8000-000000000062"
            turns={[
              { id: 'q1', role: 'user', body: 'What did I spend on food delivery in July?', createdAt: at(11) },
              {
                id: 'a1',
                role: 'assistant',
                body: 'You spent $299.40 on food delivery in July across 14 orders, which is close to your usual $300 a month.',
                createdAt: at(11),
              },
            ]}
            label="Ask a follow-up"
            pendingQuestion="And in August?"
          />
        </Card>
      </PageColumn>
    </AskDashProvider>
  );
}
