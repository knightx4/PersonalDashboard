import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ListContext } from '@/lib/ask/filtered-list';
import { answerQuestion } from './ask';
import { listLine, pageLine } from './loop';

/**
 * A filtered list sent with the question (plan #1658): Dash is told which
 * rows "these" means, and a change tool may name exactly those refs without
 * a lookup having returned them first.
 */

const ONE = '00000000-0000-4000-8000-0000000000a1';
const TWO = '00000000-0000-4000-8000-0000000000a2';
const OTHER = '00000000-0000-4000-8000-0000000000b9';

const LIST: ListContext = {
  list: 'inventory',
  label: '2 items from Inventory',
  table: 'public.inventory_items',
  total: 2,
  path: '/shopping/inventory',
  rows: [
    { ref: ONE, title: 'Catan', facts: '$40.00, 2026-03-04' },
    { ref: TWO, title: 'Ticket to Ride', facts: '$55.00, 2026-03-09' },
  ],
};

const PAGE = {
  path: '/shopping/inventory',
  module: 'shopping' as const,
  page: 'Shopping: inventory',
  row: null,
  list: LIST,
};

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const reply = (content: unknown[]) => ({ content, stop_reason: 'tool_use', usage: USAGE, model: 'm' });

function stubClient(replies: unknown[]) {
  const sent: { system: Anthropic.TextBlockParam[] }[] = [];
  const client = {
    messages: {
      create: async (params: { system: Anthropic.TextBlockParam[] }) => {
        sent.push({ system: params.system });
        return replies[sent.length - 1];
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

describe('the filtered list line', () => {
  it('names the rows by ref, with their facts, and says these means only them', () => {
    const line = listLine(LIST);
    expect(line).toContain('2 items from Inventory');
    expect(line).toContain(`${ONE} | Catan | $40.00, 2026-03-04`);
    expect(line).toContain(`${TWO} | Ticket to Ride | $55.00, 2026-03-09`);
    expect(line).toContain('public.inventory_items');
    expect(line).toContain('only');
  });

  it('says how many are past the most one change can touch', () => {
    const line = listLine({ ...LIST, total: 340 });
    expect(line).toContain('first 2 of 340');
    expect(line).toContain('narrow the filter');
  });

  it('says so when nothing matches, and sends no rows', () => {
    const line = listLine({ ...LIST, total: 0, rows: [] });
    expect(line).toContain('nothing matches');
  });

  it('follows the page line in the one line Dash is told', () => {
    const line = pageLine(PAGE);
    expect(line?.startsWith('They asked from the Shopping: inventory page (/shopping/inventory).')).toBe(true);
    expect(line).toContain(ONE);
    expect(pageLine({ ...PAGE, list: null })).toBe('They asked from the Shopping: inventory page (/shopping/inventory).');
  });
});

describe('asking about a list sent from a page', () => {
  it('lets a change name the sent rows, and refuses a row that was not sent', async () => {
    const { client, sent } = stubClient([
      reply([use('w', 'change_items', { change: 'for_sale', item_refs: [ONE, TWO] })]),
      reply([use('x', 'change_items', { change: 'for_sale', item_refs: [OTHER] })]),
      reply([use('a', 'answer', { answer: 'Marked both.', cited: [] })]),
    ]);
    const asked: { refs: string[]; seen: boolean[] }[] = [];
    const result = await answerQuestion({
        turns: [{ role: 'user', body: 'Mark these for sale' }],
        today: '2026-10-09',
        page: PAGE,
        execute: async () => ({ ok: true, rows: [] }),
        write: async (_tool, args, seen) => {
          const refs = (args as { item_refs: string[] }).item_refs;
          asked.push({ refs, seen: refs.map((ref) => seen('public.inventory_items', ref)) });
          return { ok: true, rows: [], note: 'Done.' };
        },
        anthropicApiKey: 'k',
        client,
    });
    expect(result.ok).toBe(true);
    expect(asked).toEqual([
      { refs: [ONE, TWO], seen: [true, true] },
      { refs: [OTHER], seen: [false] },
    ]);
    expect(sent[0].system.at(-1)?.text).toContain('2 items from Inventory');
  });
});
