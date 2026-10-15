import { describe, expect, it } from 'vitest';
import { chatCostMicros, chatFiles, chatLookups, chatReadRows, chatSpan } from './chat-trail';
import type { TalkTurn } from './talk';

const at = (minute: number) => `2026-10-14T09:${String(minute).padStart(2, '0')}:00Z`;

const turns: TalkTurn[] = [
  {
    id: 'q1',
    role: 'user',
    body: 'What did I spend on eBay?',
    createdAt: at(0),
    files: [{ id: 'f1', name: 'receipt.pdf', contentType: 'application/pdf', size: 1200, href: '/f/1' }],
  },
  {
    id: 'a1',
    role: 'assistant',
    body: 'About $400.',
    createdAt: at(1),
    toolCalls: [
      {
        name: 'search',
        input: { query: 'ebay' },
        result: {
          ok: true,
          rows: [
            { table: 'shopping.orders', ref: 'o1', title: 'Catan lot', href: '/shopping/orders/o1' },
            { table: 'shopping.orders', ref: 'o2', title: 'Penguin bundle', href: '/shopping/orders/o2' },
          ],
        },
      },
      {
        name: 'add_todo',
        input: { title: 'List it' },
        result: { ok: true, rows: [{ table: 'todo.tasks', ref: 't9', title: 'List it', href: '/todo/t/t9' }] },
      },
    ],
    citations: [
      { table: 'shopping.orders', ref: 'o1', title: 'Catan lot', href: '/shopping/orders/o1' },
      { table: 'core.mail', ref: 'm1', title: 'Your eBay receipt', href: 'https://mail.google.com/x' },
    ],
  },
  { id: 'q2', role: 'user', body: 'And the bundle?', createdAt: at(5) },
  {
    id: 'a2',
    role: 'assistant',
    body: '$142.60.',
    createdAt: at(6),
    toolCalls: [{ name: 'search', input: { query: 'bundle' }, result: { ok: false, error: 'no' } }],
  },
];

describe('chatReadRows', () => {
  it('lists each row a lookup gave back or an answer cited once, leaving out what a write gave back', () => {
    const rows = chatReadRows(turns);
    expect(rows.map((row) => row.ref)).toEqual(['o1', 'o2', 'm1']);
    expect(rows.map((row) => row.workspace)).toEqual(['shopping', 'shopping', null]);
  });
});

describe('chatLookups', () => {
  it('lists the reads of every answer in order, with ids unique across answers', () => {
    const lines = chatLookups(turns);
    expect(lines.map((line) => line.state)).toEqual(['done', 'failed']);
    expect(new Set(lines.map((line) => line.id)).size).toBe(2);
  });
});

describe('chatFiles', () => {
  it('lists the files sent', () => {
    expect(chatFiles(turns).map((file) => file.name)).toEqual(['receipt.pdf']);
  });
});

describe('chatCostMicros', () => {
  it('adds what was spent between each question and its answer', () => {
    const spend = [
      { createdAt: '2026-10-14T09:00:30Z', costMicros: 30_000 },
      { createdAt: '2026-10-14T09:03:00Z', costMicros: 99_000 }, // another chat, between answers
      { createdAt: '2026-10-14T09:05:40Z', costMicros: 12_000 },
      { createdAt: '2026-10-14T09:05:50Z', costMicros: null },
    ];
    expect(chatCostMicros(turns, spend)).toBe(42_000);
  });

  it('is null when the ledger holds nothing for the chat', () => {
    expect(chatCostMicros(turns, [])).toBeNull();
  });
});

describe('chatSpan', () => {
  it('runs from the first turn to the last', () => {
    expect(chatSpan(turns)).toEqual({ from: at(0), to: at(6) });
    expect(chatSpan([])).toBeNull();
  });
});
